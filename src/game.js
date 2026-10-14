'use strict';

const path = require('path');
const store = require('./store');
const rules = require(path.join(__dirname, '..', 'public', 'js', 'rules.js'));

const NICK_RE = /^[\p{L}\p{N} _.-]{2,16}$/u;
const ROOM_RE = /^[A-Z0-9]{3,8}$/;
const MAX_LOG = 40;

const state = store.load();

function persist() {
  store.save(state);
}

function nowIso() {
  return new Date().toISOString();
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let n = 0; n < 20; n++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!state.rooms[code]) return code;
  }
  return generateId().slice(0, 6).toUpperCase();
}

function addLog(room, text, kind) {
  room.log.push({ ts: Date.now(), text, kind: kind || 'info' });
  if (room.log.length > MAX_LOG) room.log.splice(0, room.log.length - MAX_LOG);
}

function createRoom(code) {
  const room = {
    code,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    seats: { w: null, b: null },
    players: {},
    chess: rules.startState(),
    lastMove: null,
    moves: [],
    log: []
  };
  state.rooms[code] = room;
  persist();
  return room;
}

function getRoom(code) {
  return state.rooms[code] || null;
}

function publicSeat(seat, onlineIds) {
  if (!seat) return null;
  return {
    id: seat.id,
    nickname: seat.nickname,
    online: onlineIds.has(seat.id)
  };
}

function snapshot(room, onlineIds, youId) {
  const spectators = Object.values(room.players).filter((p) => p.role === 's');
  let youRole = 's';
  if (room.seats.w && room.seats.w.id === youId) youRole = 'w';
  else if (room.seats.b && room.seats.b.id === youId) youRole = 'b';
  const chess = room.chess;
  return {
    board: chess.board,
    turn: chess.turn,
    moveNumber: chess.moveNumber,
    status: chess.status,
    winner: chess.winner,
    check: !!chess.check,
    lastMove: room.lastMove,
    moves: room.moves,
    castling: chess.castling,
    ep: chess.ep,
    seats: {
      w: publicSeat(room.seats.w, onlineIds),
      b: publicSeat(room.seats.b, onlineIds)
    },
    spectators: spectators.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      online: onlineIds.has(p.id)
    })),
    log: room.log.slice(-MAX_LOG),
    youRole
  };
}

function validateNick(nickname) {
  if (typeof nickname !== 'string' || !NICK_RE.test(nickname.trim())) {
    return { error: 'Ник: 2–16 символов (буквы, цифры, пробел, _.-)' };
  }
  return { nick: nickname.trim() };
}

function joinRoom({ nickname, roomCode, seat, playerId }, onlineIds) {
  const v = validateNick(nickname);
  if (v.error) return { error: v.error };

  let code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
  if (code && !ROOM_RE.test(code)) {
    return { error: 'Код комнаты: 3–8 символов A–Z и 0–9' };
  }

  const room = code ? (getRoom(code) || createRoom(code)) : createRoom(generateRoomCode());
  const nickKey = v.nick.toLowerCase();
  const safeId = typeof playerId === 'string' && playerId.length >= 8 && playerId.length <= 32
    ? playerId
    : null;

  let player = (safeId && room.players[safeId]) ||
    Object.values(room.players).find((p) => p.nickname.toLowerCase() === nickKey) ||
    null;

  if (player && onlineIds.has(player.id) && player.id !== safeId) {
    return { error: 'Этот ник уже занят в комнате' };
  }

  const isNew = !player;
  if (!player) {
    player = {
      id: generateId(),
      nickname: v.nick,
      role: 's',
      lastSeen: nowIso()
    };
    room.players[player.id] = player;
  } else {
    player.nickname = v.nick;
    player.lastSeen = nowIso();
  }

  const want = seat === 'w' || seat === 'b' ? seat : null;
  if (room.seats.w && room.seats.w.id === player.id) player.role = 'w';
  else if (room.seats.b && room.seats.b.id === player.id) player.role = 'b';
  else {
    const take = (side) => {
      if (!room.seats[side]) {
        room.seats[side] = { id: player.id, nickname: player.nickname };
        player.role = side;
        return true;
      }
      return false;
    };
    if (want) {
      if (!take(want)) take(want === 'w' ? 'b' : 'w');
    } else if (!take('w')) {
      take('b');
    }
    if (player.role !== 'w' && player.role !== 'b') player.role = 's';
  }

  if (player.role === 'w' && room.seats.w) room.seats.w.nickname = player.nickname;
  if (player.role === 'b' && room.seats.b) room.seats.b.nickname = player.nickname;

  if (isNew) {
    addLog(room, player.role === 's'
      ? `${player.nickname} смотрит партию`
      : `${player.nickname} сел за ${player.role === 'w' ? 'белых' : 'чёрных'}`);
    persist();
  }
  room.updatedAt = nowIso();
  return { room, player };
}

function leaveRoom(room, player) {
  if (!room || !player) return;
  player.lastSeen = nowIso();
  addLog(room, `${player.nickname} отключился`);
  room.updatedAt = nowIso();
  persist();
}

/**
 * Оптимистическая блокировка хода: клиент шлёт expectedMoveNumber.
 * Несовпадение → конфликт, доска с сервера побеждает. Первый валидный ход
 * в этом ходе (ply) принимается; повтор/лаг отвергается.
 */
function playMove(room, player, payload) {
  if (!room || !player) {
    return { error: 'Сначала войдите в комнату', code: 'NOT_JOINED' };
  }
  if (room.chess.status !== 'playing') {
    return { error: 'Партия уже окончена', code: 'OVER' };
  }

  const side = player.role;
  if (side !== 'w' && side !== 'b') {
    return { error: 'Наблюдатели не ходят', code: 'SPECTATOR' };
  }

  const expected = Number(payload && payload.expectedMoveNumber);
  if (!Number.isInteger(expected) || expected < 0) {
    return { error: 'Некорректный номер хода', code: 'BAD_MOVE' };
  }
  if (expected !== room.chess.moveNumber) {
    return {
      conflict: true,
      message: 'Конфликт: ход уже сделан',
      chess: room.chess,
      lastMove: room.lastMove,
      moves: room.moves
    };
  }
  if (room.chess.turn !== side) {
    return {
      conflict: true,
      message: 'Конфликт: ход уже сделан',
      chess: room.chess,
      lastMove: room.lastMove,
      moves: room.moves
    };
  }

  const from = rules.parseAlg(payload.from);
  const to = rules.parseAlg(payload.to);
  if (from < 0 || to < 0) {
    return { error: 'Некорректные поля хода', code: 'BAD_MOVE' };
  }

  const piece = room.chess.board[from];
  if (!piece || piece === '.' || rules.colorOf(piece) !== side) {
    return { error: 'Это не ваша фигура', code: 'BAD_MOVE' };
  }

  const result = rules.applyMove(room.chess, from, to);
  if (result.error) {
    return { error: result.error, code: 'ILLEGAL' };
  }

  room.chess = result.state;
  room.lastMove = { from: result.move.from, to: result.move.to };
  room.moves.push({
    san: result.san,
    from: rules.alg(from),
    to: rules.alg(to),
    ply: room.chess.moveNumber
  });

  let text = `${player.nickname}: ${result.san}`;
  if (room.chess.status === 'checkmate') {
    text += ' — мат';
    addLog(room, text, 'end');
  } else if (room.chess.status === 'stalemate') {
    text += ' — пат';
    addLog(room, text, 'end');
  } else {
    addLog(room, text, 'move');
  }

  room.updatedAt = nowIso();
  persist();
  return {
    ok: true,
    move: room.moves[room.moves.length - 1],
    chess: room.chess,
    lastMove: room.lastMove,
    logEntry: room.log[room.log.length - 1]
  };
}

function resign(room, player) {
  if (!room || !player) {
    return { error: 'Сначала войдите в комнату', code: 'NOT_JOINED' };
  }
  if (player.role !== 'w' && player.role !== 'b') {
    return { error: 'Наблюдатели не сдаются', code: 'SPECTATOR' };
  }
  if (room.chess.status !== 'playing') {
    return { error: 'Партия уже окончена', code: 'OVER' };
  }
  room.chess.status = 'resign';
  room.chess.winner = player.role === 'w' ? 'b' : 'w';
  room.chess.moveNumber += 1;
  addLog(room, `${player.nickname} сдался`, 'end');
  room.updatedAt = nowIso();
  persist();
  return { ok: true, chess: room.chess, logEntry: room.log[room.log.length - 1] };
}

module.exports = {
  state,
  persist,
  snapshot,
  joinRoom,
  leaveRoom,
  playMove,
  resign,
  getRoom
};
