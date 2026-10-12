'use strict';

/**
 * HTTP + WebSocket на одном порту.
 * Клиент → сервер: join | move {from,to,expectedMoveNumber,requestId} | resign | ping | leave
 * Сервер → клиент: welcome (snapshot) | moved | conflict | players | log | pong | error
 *
 * Конфликт: expectedMoveNumber !== chess.moveNumber → «Конфликт: ход уже сделан».
 * Persist: data/game.json после каждого изменения комнаты.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const game = require('./game');
const store = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

function sendJson(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function onlineIds(roomCode, wss) {
  const ids = new Set();
  wss.clients.forEach((c) => {
    if (c.roomCode === roomCode && c.playerId) ids.add(c.playerId);
  });
  return ids;
}

function broadcast(wss, roomCode, payload, except) {
  const raw = JSON.stringify(payload);
  wss.clients.forEach((c) => {
    if (c !== except && c.roomCode === roomCode && c.readyState === 1) c.send(raw);
  });
}

function roomState(wss, room, youId) {
  return game.snapshot(room, onlineIds(room.code, wss), youId);
}

function serveFile(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = urlPath === '/' ? '/index.html' : urlPath;
  const abs = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(abs).pipe(res);
  });
}

const httpServer = http.createServer(serveFile);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.playerId = null;
  ws.roomCode = null;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch {
      sendJson(ws, { type: 'error', code: 'BAD_JSON', message: 'Ожидался JSON' });
      return;
    }
    if (!msg || typeof msg.type !== 'string') {
      sendJson(ws, { type: 'error', code: 'BAD_MSG', message: 'Нет поля type' });
      return;
    }
    handle(ws, msg);
  });
  ws.on('close', () => {
    if (!ws.roomCode || !ws.playerId) return;
    const room = game.getRoom(ws.roomCode);
    const player = room && room.players[ws.playerId];
    game.leaveRoom(room, player);
    if (room) {
      broadcast(wss, room.code, { type: 'state', snapshot: roomState(wss, room, null) });
    }
  });
});

function handle(ws, msg) {
  if (msg.type === 'ping') {
    sendJson(ws, { type: 'pong' });
    return;
  }

  if (msg.type === 'join') {
    const ids = new Set();
    wss.clients.forEach((c) => { if (c.playerId) ids.add(c.playerId); });
    const result = game.joinRoom({
      nickname: msg.nickname,
      roomCode: msg.roomCode,
      seat: msg.seat,
      playerId: msg.playerId
    }, ids);
    if (result.error) {
      sendJson(ws, { type: 'error', code: 'JOIN', message: result.error });
      return;
    }
    ws.playerId = result.player.id;
    ws.roomCode = result.room.code;
    sendJson(ws, {
      type: 'welcome',
      playerId: result.player.id,
      roomCode: result.room.code,
      snapshot: roomState(wss, result.room, result.player.id)
    });
    broadcast(wss, result.room.code, {
      type: 'state',
      snapshot: roomState(wss, result.room, null)
    }, ws);
    return;
  }

  if (!ws.playerId || !ws.roomCode) {
    sendJson(ws, { type: 'error', code: 'NOT_JOINED', message: 'Сначала войдите в комнату' });
    return;
  }

  const room = game.getRoom(ws.roomCode);
  const player = room && room.players[ws.playerId];
  if (!room || !player) {
    sendJson(ws, { type: 'error', code: 'NOT_JOINED', message: 'Комната недоступна' });
    return;
  }

  if (msg.type === 'leave') {
    ws.playerId = null;
    ws.roomCode = null;
    game.leaveRoom(room, player);
    broadcast(wss, room.code, { type: 'state', snapshot: roomState(wss, room, null) });
    return;
  }

  if (msg.type === 'resign') {
    const result = game.resign(room, player);
    if (result.error) {
      sendJson(ws, { type: 'error', code: result.code, message: result.error });
      return;
    }
    const payload = { type: 'state', snapshot: roomState(wss, room, null), logEntry: result.logEntry };
    sendJson(ws, payload);
    broadcast(wss, room.code, payload, ws);
    return;
  }

  if (msg.type === 'move') {
    const requestId = typeof msg.requestId === 'string' ? msg.requestId.slice(0, 64) : null;
    const result = game.playMove(room, player, msg);
    if (result.conflict) {
      sendJson(ws, {
        type: 'conflict',
        requestId,
        message: result.message,
        snapshot: roomState(wss, room, player.id)
      });
      return;
    }
    if (result.error) {
      sendJson(ws, {
        type: 'error',
        code: result.code || 'MOVE',
        message: result.error,
        requestId,
        snapshot: roomState(wss, room, player.id)
      });
      return;
    }
    const payload = {
      type: 'moved',
      requestId,
      snapshot: roomState(wss, room, null)
    };
    sendJson(ws, payload);
    broadcast(wss, room.code, payload, ws);
    return;
  }

  sendJson(ws, { type: 'error', code: 'UNKNOWN', message: 'Неизвестное сообщение' });
}

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
wss.on('close', () => clearInterval(heartbeat));

function shutdown() {
  store.flush();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

httpServer.listen(PORT, HOST, () => {
  console.log(`Шахматы: http://localhost:${PORT}`);
  console.log(`Партии: ${store.DATA_FILE}`);
});
