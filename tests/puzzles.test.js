/* 殘局謎題驗證：node tests/puzzles.test.js
   逐題證明：黑方輪走、確為必勝、解答手保住必勝、實際對打能贏、日期決定性 */
const E = require('../engine.js');
const P = require('../puzzles.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name); }
}

function checkPuzzle(p, tag) {
  assert(!!p, tag + '：成功產生謎題');
  if (!p) return;
  const g = P.rebuild(p.moves);
  assert(g.winner === 0 && g.current === E.BLACK, tag + '：黑方輪走、尚未分勝負');
  assert(E.forcedWin(g, p.depth), tag + `：${p.depth} 層內必勝`);
  // 解答手合法且落子後仍保持必勝（或直接獲勝）
  const g2 = P.rebuild(p.moves);
  const ok = E.place(g2, p.solution.x, p.solution.y);
  assert(ok, tag + '：解答點可落子');
  assert(g2.winner === E.BLACK || E.forcedLoss(g2, p.depth), tag + '：解答後對手必敗');
  // 對打驗證：黑必須在 K 手內贏最強防守
  assert(P.verifyWin(p.moves, p.K, p.depth + 2), tag + `：對打 ${p.K} 手內獲勝`);
}

console.log('各難度產生器');
for (const tier of ['easy', 'medium', 'hard']) {
  checkPuzzle(P.generate(12345, tier), `${tier}`);
}

console.log('每日謎題決定性');
{
  const d1a = P.daily('2026-07-04');
  const d1b = P.daily('2026-07-04');
  assert(d1a && d1b, '同日期兩次都產生');
  assert(JSON.stringify(d1a.moves) === JSON.stringify(d1b.moves), '同日期 → 完全相同的謎題');
  const d2 = P.daily('2026-07-05');
  assert(JSON.stringify(d1a.moves) !== JSON.stringify(d2.moves), '不同日期 → 不同謎題');
}

console.log('連續 14 天每日謎題全部合法');
{
  let allOk = true;
  for (let d = 1; d <= 14; d++) {
    const ds = `2026-08-${String(d).padStart(2, '0')}`;
    const p = P.daily(ds);
    if (!p) { allOk = false; console.error('    ' + ds + ' 產生失敗'); continue; }
    const g = P.rebuild(p.moves);
    const legal = g.winner === 0 && g.current === E.BLACK;
    const win = P.verifyWin(p.moves, p.K, p.depth + 2);
    if (!legal || !win) { allOk = false; console.error(`    ${ds} 不合法（legal=${legal} win=${win} tier=${p.tier}）`); }
  }
  assert(allOk, '14 天每日謎題皆為合法必勝殘局');
}

console.log('謎題不會太瑣碎');
{
  // medium 題不該在 1 層（一手）就解掉
  const p = P.generate(999, 'medium');
  if (p) {
    const g = P.rebuild(p.moves);
    assert(!E.forcedWin(g, 1), 'medium 題無法一手取勝（需要組合殺法）');
  } else {
    assert(false, 'medium 題產生失敗');
  }
}

console.log('');
console.log('通過 ' + passed + '，失敗 ' + failed);
process.exit(failed ? 1 : 0);
