/* 殘局謎題產生器：黑方輪走、且存在必勝殺法的殘局。
   關鍵設計：forcedWin() 因搜尋剪枝可能誤判，故產生時一律以「實際對打」驗證——
   黑方用足夠深度、白方用最強防守，必須在步數上限內真的獲勝，才承認是合法謎題。
   依日期 seed 產生 → 每天固定同一題（daily）；也可用任意 seed 產生練習題（random）。

   難度分級（K = 黑方需幾手取勝；depth = 對應搜尋層數 2K-1）：
   - easy   K=1：黑方已有「四」，一手連五
   - medium K=2：需先做出四三 / 活四等雙重威脅
   - hard   K=3：連續衝四（VCF 類）三手殺 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./engine.js'));
  else root.GomokuPuzzles = factory(root.GomokuEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  const BLACK = E.BLACK, WHITE = E.WHITE;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TIERS = {
    easy: { K: 1, depth: 1, label: '入門' },
    medium: { K: 2, depth: 3, label: '進階' },
    hard: { K: 3, depth: 5, label: '高手' },
  };

  // 以既有 moves 重建一局（黑先、交替），回傳 game
  function rebuild(moves) {
    const g = E.createGame();
    for (const m of moves) E.place(g, m.x, m.y);
    return g;
  }

  // 驗證：黑方（verifyDepth 搜尋）對白方（hard 防守）能在 K 手內真的獲勝
  function verifyWin(moves, K, verifyDepth) {
    const g = rebuild(moves);
    if (g.winner || g.current !== BLACK) return false;
    let blackMoves = 0, guard = 0;
    while (!g.winner && guard++ < 30) {
      if (g.current === BLACK) {
        const mv = E.aiMove(g, { depth: verifyDepth });
        if (!mv) return false;
        E.place(g, mv.x, mv.y);
        blackMoves++;
        if (blackMoves > K) return false; // 超過步數上限仍未贏 → 不算此難度
      } else {
        const mv = E.aiMove(g, { level: 'hard' });
        if (!mv) return false;
        E.place(g, mv.x, mv.y);
      }
    }
    return g.winner === BLACK && blackMoves <= K;
  }

  // 一次自走掃描：黑方帶較大隨機探索、白方防守偶爾鬆手；
  // 遇到「黑方輪走且符合 tier 必勝條件」的殘局就回傳快照，否則 null
  function scanOnce(seed, tier) {
    const T = TIERS[tier];
    const rng = mulberry32(seed);
    const g = E.createGame();
    let guard = 0;
    const MIN_MOVES = tier === 'easy' ? 4 : 6;
    while (!g.winner && guard++ < 44) {
      if (g.current === BLACK && g.moves.length >= MIN_MOVES) {
        // 前置閘門：黑方沒有活三以上的強棋形時，不可能有速勝殺法，跳過昂貴的深度搜尋
        const top = E.analyzeMoves(g, { top: 1 })[0];
        const gate = top && top.attack >= 50000;
        // 便宜過濾：本 tier 深度必勝，且低一階不必勝（確保需要完整殺法、非更淺可解）
        if (gate && E.forcedWin(g, T.depth) && (T.depth <= 1 || !E.forcedWin(g, T.depth - 2))) {
          const moves = g.moves.map((m) => ({ x: m.x, y: m.y, player: m.player }));
          // 實際對打驗證：黑方用 tier 深度（足以找到殺法），白方用最強防守把關
          if (verifyWin(moves, T.K, T.depth)) {
            const solution = E.aiMove(rebuild(moves), { depth: T.depth });
            return { moves, solution, tier, K: T.K, depth: T.depth, label: T.label };
          }
        }
      }
      const isBlack = g.current === BLACK;
      const mv = E.aiMove(g, isBlack
        ? { depth: 2, jitter: 0.7, pool: 4, rng }
        : { depth: 2, jitter: 0.4, pool: 3, rng });
      if (!mv) break;
      E.place(g, mv.x, mv.y);
    }
    return null;
  }

  // 以 baseSeed 為基礎多次嘗試，直到產生合法謎題（決定性：同 seed 同結果）
  function generate(baseSeed, tier, maxAttempts) {
    const attempts = maxAttempts || 60;
    for (let i = 0; i < attempts; i++) {
      const p = scanOnce((baseSeed * 131 + i * 97 + 17) >>> 0, tier);
      if (p) { p.attempt = i; return p; }
    }
    return null;
  }

  // 非同步版：每次 tick 只跑一次嘗試，讓瀏覽器 UI 保持回應（Node/瀏覽器皆有 setTimeout）
  // cb(puzzle | null)；回傳 tier 不變，結果與同步 generate 相同（決定性）
  function generateAsync(baseSeed, tier, cb, maxAttempts) {
    const attempts = maxAttempts || 60;
    let i = 0;
    function step() {
      if (i >= attempts) return cb(null);
      const p = scanOnce((baseSeed * 131 + i * 97 + 17) >>> 0, tier);
      if (p) { p.attempt = i; return cb(p); }
      i++;
      setTimeout(step, 0);
    }
    setTimeout(step, 0);
  }

  function dailyAsync(dateStr, cb) {
    const tier = dailyTier(dateStr);
    generateAsync(dateSeed(dateStr), tier, (p) => {
      if (p) { p.date = dateStr; return cb(p); }
      generateAsync(dateSeed(dateStr), 'easy', (fb) => {
        if (fb) { fb.date = dateStr; fb.fallback = true; }
        cb(fb);
      });
    });
  }

  // 日期字串 'YYYY-MM-DD' → 決定性整數 seed
  function dateSeed(dateStr) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr);
    if (!m) return 20260101;
    return (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]);
  }

  // 依日期選 tier：週末給高手題，平日進階，每月 1 號給入門暖身
  function dailyTier(dateStr) {
    const seed = dateSeed(dateStr);
    const day = seed % 100;
    if (day === 1) return 'easy';
    // 用 seed 決定週期性難度（不需 Date 物件）
    const r = (seed * 2654435761) >>> 0;
    return (r % 3 === 0) ? 'hard' : 'medium';
  }

  function daily(dateStr) {
    const tier = dailyTier(dateStr);
    const p = generate(dateSeed(dateStr), tier);
    if (p) { p.date = dateStr; return p; }
    // 保底：極少數日期若 medium/hard 產不出，退回 easy（仍決定性）
    const fb = generate(dateSeed(dateStr), 'easy');
    if (fb) { fb.date = dateStr; fb.fallback = true; }
    return fb;
  }

  function random(seed, tier) {
    return generate((seed >>> 0) || 1, tier || 'medium');
  }

  return { TIERS, generate, generateAsync, daily, dailyAsync, random, dateSeed, dailyTier, rebuild, verifyWin };
});
