/* 五子棋核心引擎：棋盤狀態、勝負判定、悔棋、AI */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GomokuEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 15;
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  // opts.renju: true 時啟用禁手規則（黑棋禁雙活三、雙四、長連）
  function createGame(opts) {
    return {
      board: Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY)),
      current: BLACK,
      moves: [],
      winner: 0,
      winLine: null,
      renju: !!(opts && opts.renju),
    };
  }

  function inBoard(x, y) {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  }

  function place(game, x, y) {
    if (game.winner || !inBoard(x, y) || game.board[y][x] !== EMPTY) return false;
    if (game.renju && game.current === BLACK && forbiddenReason(game.board, x, y)) return false;
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

  /* ---- 禁手（Renju 簡化版）：黑棋禁雙活三、雙四、長連 ---- */

  // 沿 (dx,dy) 方向、包含 (x,y) 的最大連續黑子串
  function blackRun(board, x, y, dx, dy) {
    const cells = [{ x, y }];
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (inBoard(nx, ny) && board[ny][nx] === BLACK) {
        cells.push({ x: nx, y: ny });
        nx += dx * s; ny += dy * s;
      }
    }
    return cells;
  }

  // (x,y) 已放黑子的前提下，該方向是否存在「四」（再一手黑棋即成五；含跳四）
  function dirHasFour(board, x, y, dx, dy) {
    for (let o = -4; o <= 0; o++) {
      let blacks = 0, empties = 0, covers = false, ok = true;
      for (let i = 0; i < 5; i++) {
        const cx = x + dx * (o + i), cy = y + dy * (o + i);
        if (!inBoard(cx, cy)) { ok = false; break; }
        if (cx === x && cy === y) covers = true;
        const v = board[cy][cx];
        if (v === BLACK) blacks++;
        else if (v === EMPTY) empties++;
        else { ok = false; break; }
      }
      if (ok && covers && blacks === 4 && empties === 1) return true;
    }
    return false;
  }

  // (x,y) 已放黑子的前提下，該方向是否存在「活三」（再一手黑棋可成兩端皆空的活四）
  function dirHasLiveThree(board, x, y, dx, dy) {
    for (let o = -4; o <= 4; o++) {
      if (o === 0) continue;
      const ex = x + dx * o, ey = y + dy * o;
      if (!inBoard(ex, ey) || board[ey][ex] !== EMPTY) continue;
      board[ey][ex] = BLACK;
      let live = false;
      const run = blackRun(board, ex, ey, dx, dy);
      if (run.length === 4 && run.some((c) => c.x === x && c.y === y)) {
        // 兩端外的格子須皆為空
        let open = 0;
        for (const s of [1, -1]) {
          let nx = ex + dx * s, ny = ey + dy * s;
          while (inBoard(nx, ny) && board[ny][nx] === BLACK) { nx += dx * s; ny += dy * s; }
          if (inBoard(nx, ny) && board[ny][nx] === EMPTY) open++;
        }
        live = open === 2;
      }
      board[ey][ex] = EMPTY;
      if (live) return true;
    }
    return false;
  }

  // 黑棋在 (x,y) 落子是否為禁手。回傳 null（合法）或原因字串（'長連'｜'雙四'｜'雙活三'）。
  // 簡化：連五（恰好五）優先於禁手判定；活三不遞迴檢查成四點本身是否禁手。
  function forbiddenReason(board, x, y) {
    if (!inBoard(x, y) || board[y][x] !== EMPTY) return null;
    board[y][x] = BLACK;
    let five = false, over = false;
    for (const [dx, dy] of DIRS) {
      const n = blackRun(board, x, y, dx, dy).length;
      if (n === 5) five = true;
      else if (n >= 6) over = true;
    }
    let reason = null;
    if (!five) {
      if (over) reason = '長連';
      else {
        let fours = 0, threes = 0;
        for (const [dx, dy] of DIRS) {
          if (dirHasFour(board, x, y, dx, dy)) fours++;
          else if (dirHasLiveThree(board, x, y, dx, dy)) threes++;
        }
        if (fours >= 2) reason = '雙四';
        else if (threes >= 2) reason = '雙活三';
      }
    }
    board[y][x] = EMPTY;
    return reason;
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

  // 依啟發式分數排序的候選走法（攻守合算），供隨機模式與搜尋的走法排序共用
  // renju: true 時過濾黑棋的禁手點
  function rankedMoves(board, me, renju) {
    const foe = me === BLACK ? WHITE : BLACK;
    const scored = [];
    for (const key of candidateCells(board)) {
      const x = key % SIZE, y = Math.floor(key / SIZE);
      if (renju && me === BLACK && forbiddenReason(board, x, y)) continue;
      const attack = pointScore(board, x, y, me);
      const defend = pointScore(board, x, y, foe);
      scored.push({ x, y, attack, defend, score: attack + defend * 0.9 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /* ---- minimax + alpha-beta 多步搜尋 ---- */

  const WIN_SCORE = 100000000;
  const SEARCH_DEPTH = 6;   // 總層數（雙方各三手）
  const BRANCH = 8;         // 每層保留的候選走法數

  // 滑動五格窗計分：窗內只有單方棋子時依子數計分（能正確評估 X X _ X X 等帶洞棋形）。
  // 開放棋形會落在多個乾淨窗內而累積高分，不需另外判斷開口。
  const WINDOW_W = [0, 2, 40, 800, 20000, 10000000];

  // 靜態盤面評估：回傳 me 視角的分差；對手同級威脅加重（*1.15），因為接下來輪到對方走。
  function evaluateBoard(board, me) {
    let myScore = 0, foeScore = 0;
    for (const [dx, dy] of DIRS) {
      const x0 = dx < 0 ? 4 : 0, x1 = dx > 0 ? SIZE - 4 : SIZE;
      const y0 = dy < 0 ? 4 : 0, y1 = dy > 0 ? SIZE - 4 : SIZE;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          let mine = 0, foes = 0;
          for (let i = 0; i < 5; i++) {
            const p = board[y + dy * i][x + dx * i];
            if (p === EMPTY) continue;
            if (p === me) mine++; else foes++;
          }
          if (mine && !foes) myScore += WINDOW_W[mine];
          else if (foes && !mine) foeScore += WINDOW_W[foes];
        }
      }
    }
    return myScore - foeScore * 1.15;
  }

  // negamax + alpha-beta。回傳 player 視角的分數；越快達成的勝利分數越高（偏好速勝）。
  // branch：每層展開的候選數；stat.deadline（可選）：超過時標記 aborted，結果丟棄
  function negamax(board, depth, alpha, beta, player, renju, branch, stat) {
    if (stat.deadline && Date.now() > stat.deadline) { stat.aborted = true; return 0; }
    if (depth === 0) return evaluateBoard(board, player);
    const moves = rankedMoves(board, player, renju).slice(0, branch);
    if (!moves.length) return 0; // 滿盤和局（或黑棋全為禁手點＝無路可走）
    let best = -Infinity;
    for (const mv of moves) {
      if (mv.attack >= 10000000) return WIN_SCORE + depth; // 這手直接連五
      board[mv.y][mv.x] = player;
      const val = -negamax(board, depth - 1, -beta, -alpha, player === BLACK ? WHITE : BLACK, renju, branch, stat);
      board[mv.y][mv.x] = EMPTY;
      if (stat.aborted) return 0;
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // 剪枝
    }
    return best;
  }

  // 根節點搜尋：回傳 { move, value, aborted }
  function searchRoot(board, me, depth, renju, branch, deadline) {
    const br = branch || BRANCH;
    const scored = rankedMoves(board, me, renju);
    const best = scored[0];
    if (!best) return { move: null, value: 0, aborted: false };
    if (best.attack >= 10000000) return { move: best, value: WIN_SCORE + depth, aborted: false };
    const foe = me === BLACK ? WHITE : BLACK;
    const stat = { deadline: deadline || 0, aborted: false };
    let bestMv = best, bestVal = -Infinity, alpha = -Infinity;
    for (const mv of scored.slice(0, br)) {
      board[mv.y][mv.x] = me;
      const val = -negamax(board, depth - 1, -Infinity, -alpha, foe, renju, br, stat);
      board[mv.y][mv.x] = EMPTY;
      if (stat.aborted) break;
      if (val > bestVal) { bestVal = val; bestMv = mv; }
      if (bestVal > alpha) alpha = bestVal;
    }
    return { move: bestMv, value: bestVal, aborted: stat.aborted };
  }

  // 難度預設：depth（搜尋層數）與 branch（每層展開候選數）逐級遞增，強度明顯分開。
  // easy 完全不搜尋（新手級 easyMove）；master 加時間預算上限避免過慢。
  const AI_LEVELS = {
    easy: { depth: 0, easy: true },              // 新手：只擋立即連五、偏重自攻
    medium: { depth: 2, branch: 8 },             // 進階：會擋活三、算一回合
    hard: { depth: 4, branch: 10 },              // 困難：看得到雙威脅組合
    master: { depth: 6, branch: 14, timeBudget: 3000 }, // 大師：更深更廣
  };

  // 入門（新手）走法：刻意弱化，讓剛學會的人也贏得了。
  // 保證：(1) 能連五就贏 (2) 對手下一手就能連五（活四/沖四）才擋；
  // 其餘偏重「自己進攻」、幾乎不看防守（不會主動擋你的活三）→ 用活三做活四就能擊敗它。
  function easyMove(scored, rng) {
    const best = scored[0];
    if (best.attack >= 10000000) return { x: best.x, y: best.y }; // 能贏就贏
    const block = scored.find((s) => s.defend >= 10000000);
    if (block) return { x: block.x, y: block.y };                 // 對手立即連五才擋
    // 進攻導向的加權隨機：自己的棋形分量重、對手威脅只給 3%（連活三都懶得擋），
    // 在前 12 名裡挑。立即連五已在上面強制擋掉，所以不會蠢到讓對手一手贏。
    const pool = scored
      .map((s) => ({ x: s.x, y: s.y, w: s.attack + s.defend * 0.03 + 1 }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 12);
    let total = 0;
    for (const c of pool) total += c.w;
    let r = rng() * total;
    for (const c of pool) { r -= c.w; if (r <= 0) return { x: c.x, y: c.y }; }
    return { x: pool[0].x, y: pool[0].y };
  }

  // opts.level: 'easy'|'medium'|'hard'|'master'（difficulty 預設，個別欄位可再覆寫）
  // opts.jitter: 0~1 隨機程度；opts.pool: 隨機時的候選數；opts.rng: 隨機來源（測試用）
  // opts.depth: 搜尋層數（設 0 = 只用單手啟發式）
  // opts.timeBudget: 毫秒；設定時改用迭代加深（深度 2,4,6… 直到 opts.maxDepth 或時間用完）
  function aiMove(game, opts) {
    let o = opts || {};
    if (o.level && AI_LEVELS[o.level]) o = Object.assign({}, AI_LEVELS[o.level], o);
    const rng = o.rng || Math.random;
    const jitter = o.jitter || 0;
    const pool = o.pool || 1;
    const me = game.current;
    const board = game.board;
    const renju = !!game.renju;
    const scored = rankedMoves(board, me, renju);
    const best = scored[0];
    if (!best) return null;
    if (best.attack >= 10000000) return { x: best.x, y: best.y }; // 直接獲勝
    // 入門（新手）級：刻意弱化的走法
    if (o.easy) return easyMove(scored, rng);
    // 隨機模式（觀戰用）：單手啟發式；攸關勝負的一手（擋四以上）不受隨機影響
    if (jitter > 0) {
      if (best.score >= 90000) return { x: best.x, y: best.y };
      const floor = best.score * (1 - 0.3 * jitter);
      const cands = scored.slice(0, pool).filter((s) => s.score >= floor);
      const pick = cands[Math.floor(rng() * cands.length)];
      return { x: pick.x, y: pick.y };
    }
    // 對手下一手就能連五 → 只有這一擋，不必搜尋
    if (best.defend >= 10000000) return { x: best.x, y: best.y };
    const branch = o.branch || BRANCH;
    const depth = o.depth === undefined ? SEARCH_DEPTH : o.depth;
    if (depth <= 0) return { x: best.x, y: best.y };
    if (o.timeBudget) {
      // 迭代加深至 depth，時間用完就採用最後一個完成深度的結果
      let mv = { x: best.x, y: best.y };
      const deadline = Date.now() + o.timeBudget;
      for (let d = 2; d <= depth; d += 2) {
        const res = searchRoot(board, me, d, renju, branch, deadline);
        if (res.aborted) break;
        if (res.move) mv = { x: res.move.x, y: res.move.y };
        if (res.value >= WIN_SCORE) break; // 已找到必勝路線
      }
      return mv;
    }
    const res = searchRoot(board, me, depth, renju, branch, 0);
    return res.move ? { x: res.move.x, y: res.move.y } : { x: best.x, y: best.y };
  }

  /* ---- 分析工具（教練模式與教學關卡用） ---- */

  // 目前輪到的一方在 depth 層內是否有必勝路線
  function forcedWin(game, depth) {
    const res = searchRoot(game.board, game.current, depth || SEARCH_DEPTH, !!game.renju, BRANCH, 0);
    return res.value >= WIN_SCORE;
  }

  // 目前輪到的一方在 depth 層內是否無論如何都輸（對手必勝）
  function forcedLoss(game, depth) {
    const res = searchRoot(game.board, game.current, depth || SEARCH_DEPTH, !!game.renju, BRANCH, 0);
    return res.value <= -WIN_SCORE;
  }

  // 盤面威脅點清單：[{x, y, kind}]，kind 依急迫度：
  // 'win' 我方連五點｜'block' 對方連五點（必擋）｜'attack' 我方雙威脅/活四點｜
  // 'danger' 對方雙威脅/活四點｜'three' 我方活三點｜'watch' 對方活三點｜
  // 'forbidden' 禁手點（僅 renju 開啟且輪到黑棋時，附 reason）
  function hints(game) {
    const me = game.current, foe = me === BLACK ? WHITE : BLACK;
    const board = game.board;
    const renju = !!game.renju;
    const out = [];
    for (const key of candidateCells(board)) {
      const x = key % SIZE, y = Math.floor(key / SIZE);
      if (renju && me === BLACK) {
        const reason = forbiddenReason(board, x, y);
        if (reason) { out.push({ x, y, kind: 'forbidden', reason }); continue; }
      }
      const a = pointScore(board, x, y, me);
      const d = pointScore(board, x, y, foe);
      if (a >= 10000000) out.push({ x, y, kind: 'win' });
      else if (d >= 10000000) out.push({ x, y, kind: 'block' });
      else if (a >= 800000) out.push({ x, y, kind: 'attack' });
      else if (d >= 800000) out.push({ x, y, kind: 'danger' });
      else if (a >= 50000) out.push({ x, y, kind: 'three' });
      else if (d >= 50000) out.push({ x, y, kind: 'watch' });
    }
    return out;
  }

  // AI 思考視覺化：回傳目前輪到方的候選點評分，供熱力圖顯示。
  // 每點 { x, y, attack, defend, score, norm }，norm 為 0~1 相對強度（最高分為 1）。
  // 依 score 由高到低排序；opts.top 限制回傳數量（預設全部）。
  function analyzeMoves(game, opts) {
    const o = opts || {};
    const me = game.current;
    const renju = !!game.renju;
    let scored = rankedMoves(game.board, me, renju);
    if (o.top) scored = scored.slice(0, o.top);
    if (!scored.length) return [];
    // 以 log 壓縮動態範圍（分數跨好幾個數量級），讓熱力圖的中低分也看得出差異
    const logs = scored.map((s) => Math.log10(Math.max(1, s.score)));
    const lo = Math.min(...logs), hi = Math.max(...logs);
    const span = hi - lo || 1;
    return scored.map((s, i) => ({
      x: s.x, y: s.y, attack: s.attack, defend: s.defend, score: s.score,
      norm: (logs[i] - lo) / span,
    }));
  }

  return {
    SIZE, EMPTY, BLACK, WHITE, AI_LEVELS,
    createGame, place, undo, aiMove, findWinLine,
    forbiddenReason, forcedWin, forcedLoss, hints, analyzeMoves,
  };
});
