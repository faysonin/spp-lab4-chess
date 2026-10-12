(function (CH) {
  'use strict';

  var SESSION = 'ch_session';
  var PENDING = 'ch_pending';
  var joined = false;
  var youRole = 's';
  var roomCode = '';
  var playerId = null;
  var snap = null;
  var pending = null;
  var rules = window.ChessRules;

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch (e) { return null; }
  }
  function saveSession(part) {
    var cur = loadSession() || {};
    localStorage.setItem(SESSION, JSON.stringify(Object.assign(cur, part)));
  }
  function loadPending() {
    try { pending = JSON.parse(localStorage.getItem(PENDING) || 'null'); } catch (e) { pending = null; }
  }
  function savePending() {
    if (pending) localStorage.setItem(PENDING, JSON.stringify(pending));
    else localStorage.removeItem(PENDING);
    CH.ui.setQueue(!!pending);
  }

  function applySnap(next, keepRole) {
    snap = next;
    if (!keepRole && next.youRole) youRole = next.youRole;
    CH.ui.renderMeta(snap, youRole, roomCode);
    CH.ui.renderBoard(snap, youRole);
  }

  function sendJoin() {
    var form = CH.ui.joinForm();
    var session = loadSession() || {};
    var payload = {
      type: 'join',
      nickname: form.nickname || session.nickname,
      roomCode: form.roomCode || session.roomCode || '',
      seat: form.seat || session.seat || '',
      playerId: session.playerId || undefined
    };
    if (!payload.nickname || payload.nickname.length < 2) {
      CH.ui.toast('Введите ник');
      return;
    }
    saveSession({ nickname: payload.nickname, roomCode: payload.roomCode, seat: payload.seat });
    joined = true;
    CH.net.send(payload);
  }

  function tryMove(from, to) {
    if (!snap || snap.status !== 'playing') return;
    if (youRole !== snap.turn) {
      CH.ui.toast('Сейчас ход соперника');
      return;
    }
    pending = {
      from: rules.alg(from),
      to: rules.alg(to),
      expectedMoveNumber: snap.moveNumber,
      requestId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    };
    savePending();
    CH.ui.clearSelection();
    flushPending();
  }

  function flushPending() {
    CH.ui.setQueue(!!pending);
    if (!pending || !CH.net.isOpen() || !playerId) return;
    CH.net.send({
      type: 'move',
      from: pending.from,
      to: pending.to,
      expectedMoveNumber: pending.expectedMoveNumber,
      requestId: pending.requestId
    });
  }

  function onSquare(i) {
    if (!snap || youRole === 's' || snap.status !== 'playing') return;
    if (youRole !== snap.turn) {
      CH.ui.toast('Сейчас ход соперника');
      return;
    }
    var selected = CH.ui.getSelected();
    if (selected === i) {
      CH.ui.clearSelection();
      CH.ui.renderBoard(snap, youRole);
      return;
    }
    if (selected !== null) {
      var dests = rules.movesFrom(asState(), selected);
      var hit = dests.some(function (m) { return m.to === i; });
      if (hit) {
        tryMove(selected, i);
        return;
      }
    }
    var piece = snap.board[i];
    if (!piece || piece === '.' || rules.colorOf(piece) !== youRole) {
      CH.ui.clearSelection();
      CH.ui.renderBoard(snap, youRole);
      return;
    }
    var st = asState();
    CH.ui.setSelection(i, rules.movesFrom(st, i));
    CH.ui.renderBoard(snap, youRole);
  }

  function asState() {
    return {
      board: snap.board.slice(),
      turn: snap.turn,
      castling: snap.castling || { K: true, Q: true, k: true, q: true },
      ep: snap.ep == null ? null : snap.ep,
      moveNumber: snap.moveNumber,
      status: snap.status,
      winner: snap.winner,
      check: snap.check
    };
  }

  function onMessage(msg) {
    if (msg.type === 'welcome') {
      joined = true;
      playerId = msg.playerId;
      roomCode = msg.roomCode;
      youRole = msg.snapshot.youRole;
      saveSession({ playerId: playerId, roomCode: roomCode });
      CH.ui.showGame();
      applySnap(msg.snapshot, true);
      if (pending && pending.expectedMoveNumber !== snap.moveNumber) {
        pending = null;
        savePending();
        CH.ui.toast('Конфликт: ход уже сделан');
      }
      flushPending();
      return;
    }
    if (msg.type === 'moved' || msg.type === 'state') {
      if (msg.requestId && pending && pending.requestId === msg.requestId) {
        pending = null;
        savePending();
      }
      if (msg.snapshot) {
        if (msg.snapshot.youRole && msg.type === 'welcome') youRole = msg.snapshot.youRole;
        applySnap(msg.snapshot, true);
      }
      return;
    }
    if (msg.type === 'conflict') {
      pending = null;
      savePending();
      CH.ui.toast(msg.message || 'Конфликт: ход уже сделан');
      if (msg.snapshot) applySnap(msg.snapshot, true);
      CH.ui.clearSelection();
      CH.ui.renderBoard(snap, youRole);
      return;
    }
    if (msg.type === 'error') {
      if (msg.code === 'JOIN') {
        joined = false;
        CH.ui.toast(msg.message);
        return;
      }
      if (msg.requestId && pending && pending.requestId === msg.requestId) {
        pending = null;
        savePending();
      }
      if (msg.snapshot) applySnap(msg.snapshot, true);
      CH.ui.toast(msg.message || 'Ошибка');
    }
  }

  CH.ui.init();
  CH.ChessRules = rules;
  loadPending();
  CH.ui.fillForm(loadSession());
  CH.ui.setConnection(navigator.onLine ? 'connecting' : 'offline');
  CH.ui.setQueue(!!pending);

  CH.net.on('message', onMessage);
  CH.net.on('status', function (info) { CH.ui.setConnection(info.state); });
  CH.net.on('open', function () {
    var session = loadSession();
    if (joined || (session && session.playerId && session.roomCode)) sendJoin();
  });

  document.getElementById('joinForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    joined = true;
    if (CH.net.isOpen()) sendJoin();
    else {
      saveSession(CH.ui.joinForm());
      CH.net.connect();
    }
  });

  document.getElementById('leaveBtn').addEventListener('click', function () {
    CH.net.send({ type: 'leave' });
    joined = false;
    playerId = null;
    localStorage.removeItem(SESSION);
    localStorage.removeItem(PENDING);
    pending = null;
    CH.ui.showLobby();
    CH.net.disconnect();
  });

  document.getElementById('resignBtn').addEventListener('click', function () {
    CH.net.send({ type: 'resign' });
  });

  document.getElementById('copyRoomBtn').addEventListener('click', function () {
    if (!roomCode || !navigator.clipboard) return;
    navigator.clipboard.writeText(roomCode).then(function () { CH.ui.toast('Код скопирован'); });
  });

  document.getElementById('board').addEventListener('click', function (ev) {
    var sq = ev.target.closest('.sq');
    if (!sq) return;
    onSquare(Number(sq.dataset.i));
  });

  document.getElementById('roomInput').addEventListener('input', function (ev) {
    ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  CH.net.connect();
})(window.CH = window.CH || {});
