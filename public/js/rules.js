/**
 * Правила шахмат (легальные ходы, шах/мат/пат, рокировка, взятие на проходе,
 * превращение в ферзя). Один файл и для Node, и для браузера.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChessRules = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FILES = 'abcdefgh';
  var START =
    'rnbqkbnr' +
    'pppppppp' +
    '........' +
    '........' +
    '........' +
    '........' +
    'PPPPPPPP' +
    'RNBQKBNR';

  function fileOf(i) { return i & 7; }
  function rankOf(i) { return i >> 3; }

  function alg(i) {
    return FILES[fileOf(i)] + String(8 - rankOf(i));
  }

  function parseAlg(s) {
    if (typeof s !== 'string' || s.length !== 2) return -1;
    var f = FILES.indexOf(s[0].toLowerCase());
    var r = 8 - Number(s[1]);
    if (f < 0 || r < 0 || r > 7) return -1;
    return r * 8 + f;
  }

  function colorOf(p) {
    if (!p || p === '.') return null;
    return p === p.toUpperCase() ? 'w' : 'b';
  }

  function enemy(c) { return c === 'w' ? 'b' : 'w'; }

  function clone(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      castling: {
        K: state.castling.K,
        Q: state.castling.Q,
        k: state.castling.k,
        q: state.castling.q
      },
      ep: state.ep,
      moveNumber: state.moveNumber,
      status: state.status,
      winner: state.winner,
      check: state.check
    };
  }

  function startState() {
    return {
      board: START.split(''),
      turn: 'w',
      castling: { K: true, Q: true, k: true, q: true },
      ep: null,
      moveNumber: 0,
      status: 'playing',
      winner: null,
      check: false
    };
  }

  function findKing(board, color) {
    var k = color === 'w' ? 'K' : 'k';
    for (var i = 0; i < 64; i++) {
      if (board[i] === k) return i;
    }
    return -1;
  }

  function addDelta(from, dr, df) {
    var r = rankOf(from) + dr;
    var f = fileOf(from) + df;
    if (r < 0 || r > 7 || f < 0 || f > 7) return -1;
    return r * 8 + f;
  }

  function knightSquares(from) {
    var d = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    var out = [];
    for (var i = 0; i < d.length; i++) {
      var t = addDelta(from, d[i][0], d[i][1]);
      if (t >= 0) out.push(t);
    }
    return out;
  }

  function kingSquares(from) {
    var d = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    var out = [];
    for (var i = 0; i < d.length; i++) {
      var t = addDelta(from, d[i][0], d[i][1]);
      if (t >= 0) out.push(t);
    }
    return out;
  }

  function ray(from, dr, df) {
    var out = [];
    var t = addDelta(from, dr, df);
    while (t >= 0) {
      out.push(t);
      t = addDelta(t, dr, df);
    }
    return out;
  }

  function isAttacked(board, sq, byColor) {
    var i, t, p, raySq, piece;
    var pawnDir = byColor === 'w' ? 1 : -1;
    t = addDelta(sq, pawnDir, -1);
    if (t >= 0) {
      p = board[t];
      if (p && colorOf(p) === byColor && p.toLowerCase() === 'p') return true;
    }
    t = addDelta(sq, pawnDir, 1);
    if (t >= 0) {
      p = board[t];
      if (p && colorOf(p) === byColor && p.toLowerCase() === 'p') return true;
    }

    var kn = knightSquares(sq);
    for (i = 0; i < kn.length; i++) {
      p = board[kn[i]];
      if (p && colorOf(p) === byColor && p.toLowerCase() === 'n') return true;
    }

    var kg = kingSquares(sq);
    for (i = 0; i < kg.length; i++) {
      p = board[kg[i]];
      if (p && colorOf(p) === byColor && p.toLowerCase() === 'k') return true;
    }

    var bishopDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (i = 0; i < bishopDirs.length; i++) {
      raySq = ray(sq, bishopDirs[i][0], bishopDirs[i][1]);
      for (t = 0; t < raySq.length; t++) {
        piece = board[raySq[t]];
        if (!piece || piece === '.') continue;
        if (colorOf(piece) === byColor && (piece.toLowerCase() === 'b' || piece.toLowerCase() === 'q')) {
          return true;
        }
        break;
      }
    }

    var rookDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (i = 0; i < rookDirs.length; i++) {
      raySq = ray(sq, rookDirs[i][0], rookDirs[i][1]);
      for (t = 0; t < raySq.length; t++) {
        piece = board[raySq[t]];
        if (!piece || piece === '.') continue;
        if (colorOf(piece) === byColor && (piece.toLowerCase() === 'r' || piece.toLowerCase() === 'q')) {
          return true;
        }
        break;
      }
    }
    return false;
  }

  function inCheck(state, color) {
    var k = findKing(state.board, color);
    if (k < 0) return true;
    return isAttacked(state.board, k, enemy(color));
  }

  function pushMove(list, from, to, promo) {
    list.push({ from: from, to: to, promo: promo || null });
  }

  function pseudoMoves(state) {
    var board = state.board;
    var color = state.turn;
    var list = [];
    var i, p, t, dest, cap, rays, d, empty;

    for (i = 0; i < 64; i++) {
      p = board[i];
      if (!p || p === '.' || colorOf(p) !== color) continue;
      var typ = p.toLowerCase();

      if (typ === 'p') {
        var dir = color === 'w' ? -1 : 1;
        var startRank = color === 'w' ? 6 : 1;
        var lastRank = color === 'w' ? 0 : 7;
        dest = addDelta(i, dir, 0);
        if (dest >= 0 && (!board[dest] || board[dest] === '.')) {
          if (rankOf(dest) === lastRank) pushMove(list, i, dest, 'q');
          else pushMove(list, i, dest, null);
          if (rankOf(i) === startRank) {
            var dest2 = addDelta(i, dir * 2, 0);
            if (dest2 >= 0 && (!board[dest2] || board[dest2] === '.')) {
              pushMove(list, i, dest2, null);
            }
          }
        }
        var caps = [-1, 1];
        for (d = 0; d < 2; d++) {
          dest = addDelta(i, dir, caps[d]);
          if (dest < 0) continue;
          cap = board[dest];
          if (cap && cap !== '.' && colorOf(cap) === enemy(color)) {
            if (rankOf(dest) === lastRank) pushMove(list, i, dest, 'q');
            else pushMove(list, i, dest, null);
          } else if (state.ep !== null && dest === state.ep) {
            pushMove(list, i, dest, null);
          }
        }
      } else if (typ === 'n') {
        var kn = knightSquares(i);
        for (t = 0; t < kn.length; t++) {
          cap = board[kn[t]];
          if (!cap || cap === '.' || colorOf(cap) !== color) pushMove(list, i, kn[t], null);
        }
      } else if (typ === 'k') {
        var kg = kingSquares(i);
        for (t = 0; t < kg.length; t++) {
          cap = board[kg[t]];
          if (!cap || cap === '.' || colorOf(cap) !== color) pushMove(list, i, kg[t], null);
        }
      } else {
        var dirs = typ === 'b'
          ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
          : typ === 'r'
            ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
            : [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
        for (d = 0; d < dirs.length; d++) {
          rays = ray(i, dirs[d][0], dirs[d][1]);
          for (t = 0; t < rays.length; t++) {
            cap = board[rays[t]];
            if (!cap || cap === '.') {
              pushMove(list, i, rays[t], null);
            } else {
              if (colorOf(cap) !== color) pushMove(list, i, rays[t], null);
              break;
            }
          }
        }
      }
    }

    if (color === 'w' && board[60] === 'K' && !inCheck(state, 'w')) {
      if (state.castling.K && (!board[61] || board[61] === '.') && (!board[62] || board[62] === '.') && board[63] === 'R') {
        empty = clone(state);
        empty.board[61] = 'K';
        empty.board[60] = '.';
        if (!inCheck(empty, 'w')) pushMove(list, 60, 62, null);
      }
      if (state.castling.Q && (!board[59] || board[59] === '.') && (!board[58] || board[58] === '.') && (!board[57] || board[57] === '.') && board[56] === 'R') {
        empty = clone(state);
        empty.board[59] = 'K';
        empty.board[60] = '.';
        if (!inCheck(empty, 'w')) pushMove(list, 60, 58, null);
      }
    }
    if (color === 'b' && board[4] === 'k' && !inCheck(state, 'b')) {
      if (state.castling.k && (!board[5] || board[5] === '.') && (!board[6] || board[6] === '.') && board[7] === 'r') {
        empty = clone(state);
        empty.board[5] = 'k';
        empty.board[4] = '.';
        if (!inCheck(empty, 'b')) pushMove(list, 4, 6, null);
      }
      if (state.castling.q && (!board[3] || board[3] === '.') && (!board[2] || board[2] === '.') && (!board[1] || board[1] === '.') && board[0] === 'r') {
        empty = clone(state);
        empty.board[3] = 'k';
        empty.board[4] = '.';
        if (!inCheck(empty, 'b')) pushMove(list, 4, 2, null);
      }
    }

    return list;
  }

  function applyUnchecked(state, move) {
    var next = clone(state);
    var board = next.board;
    var from = move.from;
    var to = move.to;
    var piece = board[from];
    var typ = piece.toLowerCase();
    var captured = board[to] && board[to] !== '.' ? board[to] : null;

    if (typ === 'p' && next.ep !== null && to === next.ep && (!board[to] || board[to] === '.')) {
      var capSq = to + (colorOf(piece) === 'w' ? 8 : -8);
      captured = board[capSq];
      board[capSq] = '.';
    }

    board[to] = piece;
    board[from] = '.';

    if (typ === 'p' && (rankOf(to) === 0 || rankOf(to) === 7)) {
      board[to] = colorOf(piece) === 'w' ? 'Q' : 'q';
    }

    if (typ === 'k' && from === 60 && to === 62) {
      board[63] = '.';
      board[61] = 'R';
    }
    if (typ === 'k' && from === 60 && to === 58) {
      board[56] = '.';
      board[59] = 'R';
    }
    if (typ === 'k' && from === 4 && to === 6) {
      board[7] = '.';
      board[5] = 'r';
    }
    if (typ === 'k' && from === 4 && to === 2) {
      board[0] = '.';
      board[3] = 'r';
    }

    next.ep = null;
    if (typ === 'p' && Math.abs(rankOf(to) - rankOf(from)) === 2) {
      next.ep = (from + to) >> 1;
    }

    if (piece === 'K') {
      next.castling.K = false;
      next.castling.Q = false;
    }
    if (piece === 'k') {
      next.castling.k = false;
      next.castling.q = false;
    }
    if (from === 63 || to === 63) next.castling.K = false;
    if (from === 56 || to === 56) next.castling.Q = false;
    if (from === 7 || to === 7) next.castling.k = false;
    if (from === 0 || to === 0) next.castling.q = false;

    next.turn = enemy(state.turn);
    next.moveNumber = state.moveNumber + 1;
    return { state: next, captured: captured };
  }

  function legalMoves(state) {
    if (state.status !== 'playing') return [];
    var pseudo = pseudoMoves(state);
    var out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var res = applyUnchecked(state, pseudo[i]);
      if (!inCheck(res.state, state.turn)) out.push(pseudo[i]);
    }
    return out;
  }

  function movesFrom(state, from) {
    return legalMoves(state).filter(function (m) { return m.from === from; });
  }

  function findMove(state, from, to) {
    var all = legalMoves(state);
    for (var i = 0; i < all.length; i++) {
      if (all[i].from === from && all[i].to === to) return all[i];
    }
    return null;
  }

  function sanFor(state, move, after, captured) {
    var piece = state.board[move.from];
    var typ = piece.toLowerCase();
    var castle = typ === 'k' && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2;
    var text;
    if (castle) {
      text = fileOf(move.to) === 6 ? 'O-O' : 'O-O-O';
    } else if (typ === 'p') {
      text = captured ? FILES[fileOf(move.from)] + 'x' + alg(move.to) : alg(move.to);
      if (rankOf(move.to) === 0 || rankOf(move.to) === 7) text += '=Q';
    } else {
      var letter = typ.toUpperCase();
      var others = legalMoves(state).filter(function (m) {
        return m.to === move.to && m.from !== move.from && state.board[m.from] === piece;
      });
      var spec = '';
      if (others.length) {
        var sameFile = others.some(function (m) { return fileOf(m.from) === fileOf(move.from); });
        var sameRank = others.some(function (m) { return rankOf(m.from) === rankOf(move.from); });
        if (!sameFile) spec = FILES[fileOf(move.from)];
        else if (!sameRank) spec = String(8 - rankOf(move.from));
        else spec = alg(move.from);
      }
      text = letter + spec + (captured ? 'x' : '') + alg(move.to);
    }
    if (after.status === 'checkmate') text += '#';
    else if (after.check) text += '+';
    return text;
  }

  function finishStatus(next) {
    next.check = inCheck(next, next.turn);
    var moves = legalMoves(next);
    if (!moves.length) {
      if (next.check) {
        next.status = 'checkmate';
        next.winner = enemy(next.turn);
      } else {
        next.status = 'stalemate';
        next.winner = null;
      }
    } else {
      next.status = 'playing';
      next.winner = null;
    }
  }

  function applyMove(state, from, to) {
    if (state.status !== 'playing') {
      return { error: 'Партия уже окончена' };
    }
    var mv = findMove(state, from, to);
    if (!mv) {
      return { error: 'Невозможный ход' };
    }
    var res = applyUnchecked(state, mv);
    finishStatus(res.state);
    var san = sanFor(state, mv, res.state, res.captured);
    return { state: res.state, san: san, move: { from: from, to: to, san: san } };
  }

  function pieceFile(p) {
    if (!p || p === '.') return null;
    return (colorOf(p) === 'w' ? 'w' : 'b') + p.toUpperCase();
  }

  return {
    startState: startState,
    clone: clone,
    alg: alg,
    parseAlg: parseAlg,
    colorOf: colorOf,
    inCheck: inCheck,
    legalMoves: legalMoves,
    movesFrom: movesFrom,
    applyMove: applyMove,
    pieceFile: pieceFile,
    finishStatus: finishStatus
  };
});
