/* 難度分級驗證：node tests/difficulty.test.js
   證明四級強度單調遞增（上一級明顯打贏下一級），且「入門」真的像新手
   （不會主動擋活三、用活三做活四就能贏它）。seeded 可重現。 */
const E = require('../engine.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name); }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 隨機開局（天元附近幾手），讓確定性的等級對弈也能產生多樣棋局
function randomOpening(rng, n) {
  const g = E.createGame();
  let guard = 0;
  while (g.moves.length < n && guard++ < 50) {
    const x = 7 + Math.floor((rng() - 0.5) * 6);
    const y = 7 + Math.floor((rng() - 0.5) * 6);
    if (!g.winner) E.place(g, x, y);
  }
  return g.moves.map((m) => [m.x, m.y]);
}

function playGame(blackLevel, whiteLevel, opening, rng) {
  const g = E.createGame();
  for (const [x, y] of opening) if (!g.winner) E.place(g, x, y);
  let guard = 0;
  while (!g.winner && guard++ < 225) {
    const lvl = g.current === E.BLACK ? blackLevel : whiteLevel;
    const mv = E.aiMove(g, { level: lvl, rng });
    if (!mv) break;
    E.place(g, mv.x, mv.y);
  }
  return g.winner; // 1 黑 / 2 白 / -1 和
}

// strong vs weak：strong 各執黑白半數，回傳 strong 的得分率（勝1 和0.5）
function duel(strong, weak, games, seedBase) {
  let score = 0;
  for (let i = 0; i < games; i++) {
    const rng = mulberry32(seedBase + i * 101);
    const opening = randomOpening(rng, 2 + (i % 3));
    const strongBlack = i % 2 === 0;
    const w = playGame(strongBlack ? strong : weak, strongBlack ? weak : strong, opening, rng);
    const strongColor = strongBlack ? E.BLACK : E.WHITE;
    if (w === strongColor) score += 1;
    else if (w === -1) score += 0.5;
  }
  return score / games;
}

console.log('強度單調遞增（上一級明顯打贏下一級）');
{
  const mVsE = duel('medium', 'easy', 16, 1000);
  console.log(`  進階 vs 入門 得分率 ${(mVsE * 100).toFixed(0)}%`);
  assert(mVsE >= 0.8, '進階明顯強於入門（>= 80%）');

  const hVsM = duel('hard', 'medium', 12, 2000);
  console.log(`  困難 vs 進階 得分率 ${(hVsM * 100).toFixed(0)}%`);
  assert(hVsM >= 0.6, '困難明顯強於進階（>= 60%）');

  const xVsH = duel('master', 'hard', 6, 3000);
  console.log(`  大師 vs 困難 得分率 ${(xVsH * 100).toFixed(0)}%`);
  assert(xVsH >= 0.5, '大師不弱於困難（>= 50%）');
}

console.log('入門像新手：有自己的進攻時，不會乖乖擋對手活三');
{
  // 公平局面：黑有自己的活二 (5,5)(6,5)（可延伸成活三），白有活三 (5,9)(6,9)(7,9)。
  // 輪到黑（3 vs 3）。進階/困難會擋白的活三；入門偏重自攻，多半去延伸自己的棋。
  function makePos() {
    const g = E.createGame();
    for (const [x, y] of [[5, 5], [5, 9], [6, 5], [6, 9], [12, 12], [7, 9]]) E.place(g, x, y);
    return g; // 黑:(5,5)(6,5)(12,12) 白:(5,9)(6,9)(7,9)，輪到黑
  }
  const blocksThree = (mv) => mv.y === 9 && (mv.x === 4 || mv.x === 8);
  let easyBlock = 0;
  for (let i = 0; i < 40; i++) {
    const mv = E.aiMove(makePos(), { level: 'easy', rng: mulberry32(500 + i) });
    if (blocksThree(mv)) easyBlock++;
  }
  console.log(`  入門擋白活三比率 ${easyBlock}/40`);
  assert(easyBlock <= 20, '入門常不擋對手活三（<= 50%）像新手');
  assert(blocksThree(E.aiMove(makePos(), { level: 'medium' })), '進階會擋活三');
  assert(blocksThree(E.aiMove(makePos(), { level: 'hard' })), '困難會擋活三');
}

console.log('入門仍守底線：對手活四（立即連五）一定擋、自己能贏一定贏');
{
  // 白活四 (3..6,7)，黑必須擋 (2,7) 或 (7,7)
  function fourPos() {
    const g = E.createGame();
    for (const [x, y] of [[3, 7], [0, 0], [4, 7], [0, 1], [5, 7], [0, 2], [6, 7], [0, 3]]) E.place(g, x, y);
    return g;
  }
  let ok = true;
  for (let i = 0; i < 20; i++) {
    const mv = E.aiMove(fourPos(), { level: 'easy', rng: mulberry32(9000 + i) });
    if (!(mv.y === 7 && (mv.x === 2 || mv.x === 7))) { ok = false; break; }
  }
  assert(ok, '入門一定擋對手活四（立即連五）');
  // 自己能連五就贏：黑活四 (3..6,7)
  const g = E.createGame();
  for (const [x, y] of [[3, 7], [3, 0], [4, 7], [4, 0], [5, 7], [5, 0], [6, 7], [6, 0]]) E.place(g, x, y);
  const mv = E.aiMove(g, { level: 'easy', rng: mulberry32(1) });
  assert(mv.y === 7 && (mv.x === 2 || mv.x === 7), '入門自己能連五就下');
}

console.log('');
console.log('通過 ' + passed + '，失敗 ' + failed);
process.exit(failed ? 1 : 0);
