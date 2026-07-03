/* AI 強度基準測試：深度搜尋版 vs 原作單手啟發式（加隨機擾動）
   seeded RNG，結果可重現。執行：node tests/benchmark.js（約 1 分鐘） */
const E = require('../engine.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let wins = 0, losses = 0, draws = 0, worstMs = 0;
const t0 = Date.now();
for (let i = 0; i < 20; i++) {
  const rng = mulberry32(1000 + i);
  const deepIsBlack = i % 2 === 0;
  const g = E.createGame();
  let guard = 0;
  while (!g.winner && guard++ < 225) {
    const deepTurn = (g.current === E.BLACK) === deepIsBlack;
    const m0 = Date.now();
    const mv = E.aiMove(g, deepTurn ? undefined : { depth: 0, jitter: 0.4, pool: 3, rng });
    if (deepTurn) { const ms = Date.now() - m0; if (ms > worstMs) worstMs = ms; }
    if (!mv) break;
    E.place(g, mv.x, mv.y);
  }
  const deepColor = deepIsBlack ? E.BLACK : E.WHITE;
  if (g.winner === deepColor) wins++;
  else if (g.winner === -1 || g.winner === 0) draws++;
  else losses++;
  console.log(`第 ${i + 1} 局：深度版執${deepIsBlack ? '黑' : '白'} → ${g.winner === deepColor ? '勝' : g.winner > 0 ? '敗' : '和'}（${g.moves.length} 手）`);
}
console.log(`\n總計 20 局：勝 ${wins} 敗 ${losses} 和 ${draws}，深度版單手思考最長 ${worstMs} ms，總耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
