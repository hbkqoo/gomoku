/* 圍棋核心引擎：氣與提子、禁著點（自殺）、打劫與位置超劫、虛手、中國規則數子。
   API 與 GomokuEngine 同形（createGame / place / undo / status …），
   讓 main.js 能以同一套流程驅動兩種棋。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const SIZES = [9, 13, 19];
  const DEFAULT_SIZE = 19;
  const DEFAULT_KOMI = 7.5;          // 中國規則貼目（7.5 目，不會有和局）

  const other = (c) => (c === BLACK ? WHITE : BLACK);
  const colorName = (c) => (c === BLACK ? '黑棋' : '白棋');

  /* ---------- 座標 ---------- */
  function xyToIdx(size, x, y) { return y * size + x; }
  function idxToXY(size, p) { const x = p % size; return { x, y: (p - x) / size }; }
  function inBoard(size, x, y) { return x >= 0 && x < size && y >= 0 && y < size; }
  // 四鄰（上下左右）；圍棋不吃斜線
  function forEachNbr(size, x, y, fn) {
    if (x > 0) fn(x - 1, y);
    if (x < size - 1) fn(x + 1, y);
    if (y > 0) fn(x, y - 1);
    if (y < size - 1) fn(x, y + 1);
  }

  // 星位：19 路取四/十/十六線，13 路取四/七/十線，9 路取三/五/七線（皆為 0-based）
  function starPoints(size) {
    if (size === 9) {
      return [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]];
    }
    if (size === 13) {
      return [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]];
    }
    if (size === 19) {
      const a = [3, 9, 15], out = [];
      for (const y of a) for (const x of a) out.push([x, y]);
      return out;
    }
    // 非標準尺寸：只放天元（若邊長為奇數）
    return size % 2 ? [[(size - 1) / 2, (size - 1) / 2]] : [];
  }

  /* ---------- Zobrist 雜湊（供位置超劫判定） ----------
     用固定種子的 xorshift 產表，讓同一盤棋在任何機器上雜湊一致（測試可重現）。
     兩組獨立 32 位元合成字串當 key，把碰撞機率壓到可忽略——
     單靠一組 32 位元，幾百手就有萬分之一機率把合法著手誤判成「重複盤面」。 */
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s;
    };
  }
  const zobCache = {};
  function zobristFor(size) {
    if (zobCache[size]) return zobCache[size];
    const n = size * size;
    const rng = makeRng(0x9e3779b9 ^ size);
    const t = {
      a: [new Int32Array(n), new Int32Array(n)],
      b: [new Int32Array(n), new Int32Array(n)],
    };
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < n; i++) { t.a[c][i] = rng() | 0; t.b[c][i] = rng() | 0; }
    }
    zobCache[size] = t;
    return t;
  }
  const hashKey = (a, b) => a + '|' + b;

  /* ---------- 對局狀態 ---------- */
  // opts: { size: 9|13|19, komi: number }
  function createGame(opts) {
    const o = opts || {};
    const size = SIZES.indexOf(o.size) >= 0 ? o.size : DEFAULT_SIZE;
    const komi = Number.isFinite(o.komi) ? o.komi : DEFAULT_KOMI;
    const g = {
      size,
      komi,
      board: Array.from({ length: size }, () => new Array(size).fill(EMPTY)),
      current: BLACK,
      moves: [],
      captured: { 1: 0, 2: 0 },  // captured[c] = c 方提掉對手的子數
      ko: -1,                    // 立即回提禁點（簡單劫），-1 表示無
      passes: 0,                 // 目前連續虛手數
      phase: 'play',             // 'play' → 'scoring'（雙方虛手後確認死子）→ 'over'
      winner: 0,                 // 0 未定 / BLACK / WHITE / -1 和局
      reason: '',                // 'score' | 'resign'
      result: null,              // 終局結算明細（見 score()）
      hashA: 0, hashB: 0,
      seen: new Set([hashKey(0, 0)]),
    };
    return g;
  }

  /* ---------- 棋塊與氣 ---------- */
  // 回傳 { color, stones:[idx], libs:[idx] }；空點回傳 null
  function groupAt(board, size, x, y) {
    const color = board[y][x];
    if (color === EMPTY) return null;
    const n = size * size;
    const mark = new Uint8Array(n);
    const libMark = new Uint8Array(n);
    const stones = [], libs = [];
    const stack = [xyToIdx(size, x, y)];
    mark[stack[0]] = 1;
    while (stack.length) {
      const p = stack.pop();
      stones.push(p);
      const q = idxToXY(size, p);
      forEachNbr(size, q.x, q.y, (nx, ny) => {
        const np = xyToIdx(size, nx, ny);
        const v = board[ny][nx];
        if (v === EMPTY) {
          if (!libMark[np]) { libMark[np] = 1; libs.push(np); }
        } else if (v === color && !mark[np]) {
          mark[np] = 1;
          stack.push(np);
        }
      });
    }
    return { color, stones, libs };
  }

  // 只算氣數，不收集棋子清單（AI 與規則判定的熱路徑）
  function libertyCount(board, size, x, y) {
    const g = groupAt(board, size, x, y);
    return g ? g.libs.length : 0;
  }

  /* ---------- 落子 ---------- */
  // commit=false 只做合法性檢查；回傳 { ok, reason, captures }
  function tryPlace(game, x, y, commit) {
    const size = game.size;
    if (game.phase !== 'play') return { ok: false, reason: '對局已結束', captures: [] };
    if (!inBoard(size, x, y)) return { ok: false, reason: '不在棋盤上', captures: [] };
    if (game.board[y][x] !== EMPTY) return { ok: false, reason: '此點已有棋子', captures: [] };

    const p = xyToIdx(size, x, y);
    if (p === game.ko) return { ok: false, reason: '劫爭：此點不可立即回提', captures: [] };

    const me = game.current, opp = other(me);
    const board = game.board;

    // 先擺上去，才算得出對手有沒有被提乾淨、自己有沒有氣
    board[y][x] = me;
    const captures = [];
    forEachNbr(size, x, y, (nx, ny) => {
      if (board[ny][nx] !== opp) return;
      const g = groupAt(board, size, nx, ny);
      if (g.libs.length === 0) {
        for (const q of g.stones) {
          const c = idxToXY(size, q);
          if (board[c.y][c.x] === opp) { board[c.y][c.x] = EMPTY; captures.push(q); }
        }
      }
    });

    const mine = groupAt(board, size, x, y);
    if (mine.libs.length === 0) {
      // 提子在前、自殺判定在後：能提到對方就不算自殺
      board[y][x] = EMPTY;
      for (const q of captures) { const c = idxToXY(size, q); board[c.y][c.x] = opp; }
      return { ok: false, reason: '禁著點：此處無氣（自殺）', captures: [] };
    }

    const z = zobristFor(size);
    let ha = game.hashA ^ z.a[me - 1][p];
    let hb = game.hashB ^ z.b[me - 1][p];
    for (const q of captures) { ha ^= z.a[opp - 1][q]; hb ^= z.b[opp - 1][q]; }
    const key = hashKey(ha, hb);
    if (game.seen.has(key)) {
      board[y][x] = EMPTY;
      for (const q of captures) { const c = idxToXY(size, q); board[c.y][c.x] = opp; }
      return { ok: false, reason: '禁止重現先前盤面（超劫）', captures: [] };
    }

    if (!commit) {
      board[y][x] = EMPTY;
      for (const q of captures) { const c = idxToXY(size, q); board[c.y][c.x] = opp; }
      return { ok: true, reason: '', captures };
    }

    game.moves.push({
      x, y, player: me, pass: false,
      caps: captures,
      koBefore: game.ko,
      passesBefore: game.passes,
      hash: key,
    });
    game.captured[me] += captures.length;
    game.hashA = ha; game.hashB = hb;
    game.seen.add(key);
    // 簡單劫：提掉剛好一子，且自己成為只有一氣的單顆棋子 → 對手不能立刻提回
    game.ko = (captures.length === 1 && mine.stones.length === 1 && mine.libs.length === 1)
      ? captures[0] : -1;
    game.passes = 0;
    game.current = opp;
    return { ok: true, reason: '', captures };
  }

  function legal(game, x, y) { return tryPlace(game, x, y, false); }
  function place(game, x, y) { return tryPlace(game, x, y, true).ok; }

  function pass(game) {
    if (game.phase !== 'play') return false;
    game.moves.push({
      x: -1, y: -1, player: game.current, pass: true,
      caps: [], koBefore: game.ko, passesBefore: game.passes, hash: null,
    });
    game.passes += 1;
    game.ko = -1;
    game.current = other(game.current);
    if (game.passes >= 2) game.phase = 'scoring';   // 進入確認死子階段
    return true;
  }

  function resign(game, side) {
    if (game.phase === 'over') return false;
    game.phase = 'over';
    game.winner = other(side);
    game.reason = 'resign';
    game.result = null;
    return true;
  }

  // 悔棋一手。從「確認死子」階段悔棋會退回對局中；認輸後悔棋等於取消認輸。
  function undo(game) {
    const m = game.moves.pop();
    if (!m) {
      if (game.reason === 'resign') { game.phase = 'play'; game.winner = 0; game.reason = ''; return true; }
      return false;
    }
    const size = game.size;
    if (!m.pass) {
      game.board[m.y][m.x] = EMPTY;
      const opp = other(m.player);
      for (const q of m.caps) { const c = idxToXY(size, q); game.board[c.y][c.x] = opp; }
      game.captured[m.player] -= m.caps.length;
      game.seen.delete(m.hash);
      // 雜湊退回上一手：從 moves 尾端找最後一個有雜湊的著手
      let prev = hashKey(0, 0);
      for (let i = game.moves.length - 1; i >= 0; i--) {
        if (game.moves[i].hash) { prev = game.moves[i].hash; break; }
      }
      const bar = prev.indexOf('|');
      game.hashA = parseInt(prev.slice(0, bar), 10);
      game.hashB = parseInt(prev.slice(bar + 1), 10);
    }
    game.ko = m.koBefore;
    game.passes = m.passesBefore;
    game.current = m.player;
    game.phase = game.passes >= 2 ? 'scoring' : 'play';
    game.winner = 0;
    game.reason = '';
    game.result = null;
    return true;
  }

  // 從「確認死子」退回對局（悔棋以外的取消途徑）
  function resumePlay(game) {
    if (game.phase !== 'scoring') return false;
    game.phase = 'play';
    game.passes = 0;
    game.winner = 0;
    game.result = null;
    return true;
  }

  /* ---------- 中國規則數子 ---------- */
  // dead：死子的點索引集合（Set / Array 皆可）。純函式，不改動 game。
  // 回傳 { black, white, ... , owner }：owner[p] 為該點歸屬（BLACK/WHITE/0=單官）
  function score(game, dead) {
    const size = game.size, n = size * size;
    const deadSet = dead instanceof Set ? dead : new Set(dead || []);
    const b = game.board.map((row) => row.slice());
    let deadBlack = 0, deadWhite = 0;
    for (const p of deadSet) {
      const c = idxToXY(size, p);
      if (b[c.y][c.x] === BLACK) { b[c.y][c.x] = EMPTY; deadBlack++; }
      else if (b[c.y][c.x] === WHITE) { b[c.y][c.x] = EMPTY; deadWhite++; }
    }

    const owner = new Int8Array(n);
    let blackStones = 0, whiteStones = 0, blackTerritory = 0, whiteTerritory = 0, dame = 0;
    const seen = new Uint8Array(n);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = xyToIdx(size, x, y);
        const v = b[y][x];
        if (v === BLACK) { blackStones++; owner[p] = BLACK; continue; }
        if (v === WHITE) { whiteStones++; owner[p] = WHITE; continue; }
        if (seen[p]) continue;
        // 空區 flood fill：只被單一顏色包圍才算該方的地
        const region = [];
        const stack = [p];
        seen[p] = 1;
        let touchBlack = false, touchWhite = false;
        while (stack.length) {
          const q = stack.pop();
          region.push(q);
          const c = idxToXY(size, q);
          forEachNbr(size, c.x, c.y, (nx, ny) => {
            const np = xyToIdx(size, nx, ny);
            const nv = b[ny][nx];
            if (nv === BLACK) touchBlack = true;
            else if (nv === WHITE) touchWhite = true;
            else if (!seen[np]) { seen[np] = 1; stack.push(np); }
          });
        }
        let ow = 0;
        if (touchBlack && !touchWhite) { ow = BLACK; blackTerritory += region.length; }
        else if (touchWhite && !touchBlack) { ow = WHITE; whiteTerritory += region.length; }
        else dame += region.length;
        for (const q of region) owner[q] = ow;
      }
    }

    const black = blackStones + blackTerritory;
    const white = whiteStones + whiteTerritory + game.komi;
    const diff = black - white;
    return {
      black, white, diff,
      blackStones, whiteStones, blackTerritory, whiteTerritory, dame,
      deadBlack, deadWhite, komi: game.komi,
      winner: diff > 0 ? BLACK : diff < 0 ? WHITE : -1,
      owner,
    };
  }

  // 結算並收局。dead 同 score()。
  function finalize(game, dead) {
    if (game.phase === 'over') return game.result;
    const r = score(game, dead);
    game.result = r;
    game.winner = r.winner;
    game.reason = 'score';
    game.phase = 'over';
    return r;
  }

  /* ---------- 供 UI／AI 使用的查詢 ---------- */
  // 重播前 n 手的盤面（圍棋有提子，不能像五子棋那樣直接把棋子疊上去）
  function replayBoard(game, n) {
    const g = createGame({ size: game.size, komi: game.komi });
    const upto = Math.max(0, Math.min(n, game.moves.length));
    for (let i = 0; i < upto; i++) {
      const m = game.moves[i];
      if (m.pass) pass(g); else tryPlace(g, m.x, m.y, true);
    }
    return g.board;
  }

  // 目前輪到的一方，所有合法著點（不含虛手）
  function legalMoves(game) {
    const out = [];
    if (game.phase !== 'play') return out;
    for (let y = 0; y < game.size; y++) {
      for (let x = 0; x < game.size; x++) {
        if (game.board[y][x] !== EMPTY) continue;
        if (tryPlace(game, x, y, false).ok) out.push({ x, y });
      }
    }
    return out;
  }

  // 指定顏色所有「只剩 n 氣」的棋塊（n 預設 1，即被叫吃）——教練模式用
  function groupsWithLiberties(game, color, n) {
    const want = n === undefined ? 1 : n;
    const size = game.size, seen = new Uint8Array(size * size), out = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (game.board[y][x] !== color) continue;
        const p = xyToIdx(size, x, y);
        if (seen[p]) continue;
        const g = groupAt(game.board, size, x, y);
        for (const q of g.stones) seen[q] = 1;
        if (g.libs.length === want) out.push(g);
      }
    }
    return out;
  }

  function status(game) {
    return {
      over: game.phase === 'over',
      phase: game.phase,
      winner: game.winner,
      reason: game.reason,
      result: game.result,
    };
  }

  return {
    EMPTY, BLACK, WHITE, SIZES, DEFAULT_SIZE, DEFAULT_KOMI,
    createGame, place, legal, pass, resign, undo, resumePlay,
    score, finalize, status, replayBoard, legalMoves,
    groupAt, libertyCount, groupsWithLiberties, starPoints,
    xyToIdx, idxToXY, inBoard, forEachNbr, other, colorName,
  };
});
