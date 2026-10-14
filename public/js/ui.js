(function (CH) {
  'use strict';

  var FILES = 'abcdefgh';
  var selected = null;
  var legal = [];
  var els = {};
  var squares = [];
  var lastFlip = null;

  function $(id) { return document.getElementById(id); }

  function init() {
    els.lobby = $('lobby');
    els.game = $('game');
    els.board = $('board');
    els.ranks = $('ranks');
    els.files = $('files');
    els.nick = $('nickInput');
    els.room = $('roomInput');
    els.conn = $('connStatus');
    els.lobbyStatus = $('lobbyStatus');
    els.you = $('youLabel');
    els.roomLabel = $('roomCodeLabel');
    els.turn = $('turnLine');
    els.seatW = $('seatWhite');
    els.seatB = $('seatBlack');
    els.specs = $('specs');
    els.moves = $('moveList');
    els.log = $('logList');
    els.queue = $('queueNote');
    els.toasts = $('toasts');
  }

  function joinForm() {
    var seatEl = document.querySelector('input[name="seat"]:checked');
    return {
      nickname: els.nick.value.trim(),
      roomCode: els.room.value.trim().toUpperCase(),
      seat: seatEl ? seatEl.value : ''
    };
  }

  function fillForm(session) {
    if (!session) return;
    if (session.nickname) els.nick.value = session.nickname;
    if (session.roomCode) els.room.value = session.roomCode;
  }

  function showGame() {
    els.lobby.classList.add('hidden');
    els.game.classList.remove('hidden');
  }

  function showLobby() {
    els.game.classList.add('hidden');
    els.lobby.classList.remove('hidden');
  }

  function setConnection(state) {
    var text = 'Нет сети';
    var cls = 'status off';
    if (state === 'online') { text = 'Онлайн'; cls = 'status on'; }
    else if (state === 'connecting') { text = 'Подключение…'; cls = 'status wait'; }
    else if (state === 'reconnect') { text = 'Нет связи, нажмите «Войти»'; cls = 'status wait'; }
    if (els.conn) { els.conn.className = cls; els.conn.textContent = text; }
    if (els.lobbyStatus) { els.lobbyStatus.className = cls; els.lobbyStatus.textContent = text; }
  }

  function roleName(role) {
    if (role === 'w') return 'белые';
    if (role === 'b') return 'чёрные';
    return 'наблюдатель';
  }

  function statusText(snap, youRole) {
    if (snap.status === 'checkmate') {
      return 'Мат. Победили ' + (snap.winner === 'w' ? 'белые' : 'чёрные');
    }
    if (snap.status === 'stalemate') return 'Пат. Ничья';
    if (snap.status === 'resign') {
      return 'Сдались. Победили ' + (snap.winner === 'w' ? 'белые' : 'чёрные');
    }
    var turn = snap.turn === 'w' ? 'белых' : 'чёрных';
    var extra = snap.check ? ' · шах' : '';
    if (youRole === 's') return 'Ход ' + turn + extra;
    if (youRole === snap.turn) return 'Ваш ход' + extra;
    return 'Ход соперника' + extra;
  }

  function seatLine(label, seat) {
    if (!seat) return label + ': свободно';
    return label + ': ' + seat.nickname + (seat.online ? '' : ' (офлайн)');
  }

  function renderMeta(snap, youRole, roomCode) {
    els.roomLabel.textContent = roomCode || '—';
    els.you.textContent = 'вы: ' + roleName(youRole);
    els.turn.textContent = statusText(snap, youRole);
    els.seatW.textContent = seatLine('Белые', snap.seats && snap.seats.w);
    els.seatB.textContent = seatLine('Чёрные', snap.seats && snap.seats.b);
    var specs = (snap.spectators || []).filter(function (s) { return s.online; });
    els.specs.textContent = specs.length
      ? 'Наблюдатели: ' + specs.map(function (s) { return s.nickname; }).join(', ')
      : 'Наблюдатели: нет';
    els.moves.innerHTML = '';
    (snap.moves || []).forEach(function (m, i) {
      var li = document.createElement('li');
      li.textContent = (i % 2 === 0 ? (Math.floor(i / 2) + 1) + '. ' : '') + m.san;
      els.moves.appendChild(li);
    });
    els.log.innerHTML = '';
    (snap.log || []).slice().reverse().forEach(function (e) {
      var li = document.createElement('li');
      li.className = e.kind || '';
      li.textContent = e.text;
      els.log.appendChild(li);
    });
  }

  function renderCoords(flip) {
    els.ranks.innerHTML = '';
    els.files.innerHTML = '';
    var r, f;
    for (r = 0; r < 8; r++) {
      var rs = document.createElement('span');
      rs.textContent = String(flip ? r + 1 : 8 - r);
      els.ranks.appendChild(rs);
    }
    for (f = 0; f < 8; f++) {
      var fs = document.createElement('span');
      fs.textContent = FILES[flip ? 7 - f : f];
      els.files.appendChild(fs);
    }
  }

  function isLegalTo(i) {
    return legal.some(function (m) { return m.to === i; });
  }

  function ensureBoard(flip) {
    if (squares.length === 64 && lastFlip === flip) return;
    lastFlip = flip;
    renderCoords(flip);
    els.board.innerHTML = '';
    squares = [];
    var r, f, vis, idx, sq;
    vis = 0;
    for (r = 0; r < 8; r++) {
      for (f = 0; f < 8; f++) {
        idx = flip ? (7 - r) * 8 + (7 - f) : r * 8 + f;
        sq = document.createElement('button');
        sq.type = 'button';
        sq.className = 'sq ' + ((vis % 8 + Math.floor(vis / 8)) % 2 === 0 ? 'light' : 'dark');
        sq.dataset.i = String(idx);
        els.board.appendChild(sq);
        squares.push(sq);
        vis++;
      }
    }
  }

  function setPieceImg(sq, p) {
    var file = window.ChessRules.pieceFile(p);
    var img = sq._img;
    if (!file) {
      if (img) { img.remove(); sq._img = null; }
      return;
    }
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      sq.appendChild(img);
      sq._img = img;
    }
    if (img.getAttribute('data-p') !== p) {
      img.src = '/pieces/' + file + '.svg';
      img.alt = p;
      img.setAttribute('data-p', p);
    }
  }

  function renderBoard(snap, youRole) {
    var flip = youRole === 'b';
    var last = snap.lastMove;
    ensureBoard(flip);
    var vis, sq, i, p, dot;
    for (vis = 0; vis < 64; vis++) {
      sq = squares[vis];
      i = Number(sq.dataset.i);
      sq.classList.toggle('selected', selected === i);
      sq.classList.toggle('last', !!(last && (last.from === i || last.to === i)));
      p = snap.board[i];
      setPieceImg(sq, p);
      sq.classList.toggle('capture', isLegalTo(i) && !!(p && p !== '.'));
      dot = sq._dot;
      if (isLegalTo(i) && (!p || p === '.')) {
        if (!dot) {
          dot = document.createElement('span');
          dot.className = 'dot';
          sq.appendChild(dot);
          sq._dot = dot;
        }
      } else if (dot) {
        dot.remove();
        sq._dot = null;
      }
    }
  }

  function setSelection(from, moves) {
    selected = from;
    legal = moves || [];
  }

  function clearSelection() {
    selected = null;
    legal = [];
  }

  function getSelected() { return selected; }

  function toast(text) {
    var div = document.createElement('div');
    div.className = 'toast';
    div.textContent = text;
    els.toasts.appendChild(div);
    setTimeout(function () { div.remove(); }, 3200);
  }

  function setQueue(on) {
    els.queue.classList.toggle('hidden', !on);
  }

  CH.ui = {
    init: init,
    joinForm: joinForm,
    fillForm: fillForm,
    showGame: showGame,
    showLobby: showLobby,
    setConnection: setConnection,
    renderMeta: renderMeta,
    renderBoard: renderBoard,
    setSelection: setSelection,
    clearSelection: clearSelection,
    getSelected: getSelected,
    toast: toast,
    setQueue: setQueue
  };
})(window.CH = window.CH || {});
