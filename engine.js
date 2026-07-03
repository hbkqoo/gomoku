/* 五子棋核心引擎：棋盤狀態、勝負判定、悔棋、AI */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GomokuEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 15;
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function createGame() {
    return {
      board: Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY)),
      current: BLACK,
      moves: [],
      winner: 0,
      winLine: null,
    };
  }

  function inBoard(x, y) {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  }

  function place(game, x, y) {
    if (game.winner || !inBoard(x, y) || game.board[y][x] !== EMPTY) return false;
    game.board[y][x] = game.current;
    game.moves.push({ x, y, player: game.current });
    const line = findWinLine(game.board, x, y);
    if (line) {
      game.winner = game.current;
      game.winLine = line;
    } else if (game.moves.length === SIZE * SIZE) {
      game.winner = -1; // 和局
    } else {
      game.current = game.current === BLACK ? WHITE : BLACK;
    }
    return true;
  }

  function undo(game) {
    const last = game.moves.pop();
    if (!last) return false;
    game.board[last.y][last.x] = EMPTY;
    game.current = last.player;
    game.winner = 0;
    game.winLine = null;
    return true;
  }

  function findWinLine(board, x, y) {
    const p = board[y][x];
    if (!p) return null;
    for (const [dx, dy] of DIRS) {
      const cells = [{ x, y }];
      for (const s of [1, -1]) {
        let nx = x + dx * s, ny = y + dy * s;
        while (inBoard(nx, ny) && board[ny][nx] === p) {
          cells.push({ x: nx, y: ny });
          nx += dx * s; ny += dy * s;
        }
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  /* ---- AI ---- */

  // 評估單一方向上，在 (x,y) 落子後形成的連線強度
  function lineScore(board, x, y, dx, dy, player) {
    let count = 1, openEnds = 0;
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (inBoard(nx, ny) && board[ny][nx] === player) {
        count++; nx += dx * s; ny += dy * s;
      }
      if (inBoard(nx, ny) && board[ny][nx] === EMPTY) openEnds++;
    }
    if (count >= 5) return 10000000;
    if (count === 4) return openEnds === 2 ? 1000000 : (openEnds === 1 ? 100000 : 0);
    if (count === 3) return openEnds === 2 ? 50000 : (openEnds === 1 ? 1000 : 0);
    if (count === 2) return openEnds === 2 ? 500 : (openEnds === 1 ? 50 : 0);
    if (count === 1) return openEnds === 2 ? 10 : 1;
    return 0;
  }

  function pointScore(board, x, y, player) {
    let total = 0;
    const parts = [];
    for (const [dx, dy] of DIRS) {
      const s = lineScore(board, x, y, dx, dy, player);
      parts.push(s);
      total += s;
    }
    // 雙活三 / 四三 等複合威脅加權
    const threats = parts.filter((s) => s >= 50000).length;
    if (threats >= 2) total += 800000;
    return total;
  }

  function candidateCells(board) {
    const set = new Set();
    let any = false;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (board[y][x] === EMPTY) continue;
        any = true;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (inBoard(nx, ny) && board[ny][nx] === EMPTY) set.add(ny * SIZE + nx);
          }
        }
      }
    }
    if (!any) return [Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2)];
    return [...set];
  }

  // opts.jitter: 0~1 隨機程度；opts.pool: 隨機時的候選數；opts.rng: 隨機來源（測試用）
  function aiMove(game, opts) {
    const o = opts || {};
    const rng = o.rng || Math.random;
    const jitter = o.jitter || 0;
    const pool = o.pool || 1;
    const me = game.current;
    const foe = me === BLACK ? WHITE : BLACK;
    const board = game.board;
    const scored = [];
    for (const key of candidateCells(board)) {
      const x = key % SIZE, y = Math.floor(key / SIZE);
      const attack = pointScore(board, x, y, me);
      if (attack >= 10000000) return { x, y }; // 直接獲勝
      const defend = pointScore(board, x, y, foe);
      scored.push({ x, y, score: attack + defend * 0.9 });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return null;
    // 攸關勝負的一手（擋四以上）不受隨機影響
    if (jitter <= 0 || best.score >= 90000) return { x: best.x, y: best.y };
    const floor = best.score * (1 - 0.3 * jitter);
    const cands = scored.slice(0, pool).filter((s) => s.score >= floor);
    const pick = cands[Math.floor(rng() * cands.length)];
    return { x: pick.x, y: pick.y };
  }

  return { SIZE, EMPTY, BLACK, WHITE, createGame, place, undo, aiMove, findWinLine };
});
