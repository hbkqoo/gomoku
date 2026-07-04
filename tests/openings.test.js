/* 開局定式資料驗證：node tests/openings.test.js
   核對 26 種開局座標合法、自洽，且能在引擎上合法擺出 */
const E = require('../engine.js');
const O = require('../openings.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name); }
}

console.log('資料完整性');
assert(O.length === 26, '共 26 種開局');
assert(O.filter((o) => o.type === 'direct').length === 13, '直接型 13 種');
assert(O.filter((o) => o.type === 'indirect').length === 13, '間接型 13 種');
assert(O.some((o) => o.name === '花月') && O.some((o) => o.name === '浦月'), '含花月與浦月');

console.log('每種開局座標自洽');
for (const o of O) {
  const ms = o.moves;
  const ok3 = ms.length === 3;
  const b1 = ms[0][0] === 0 && ms[0][1] === 0;
  const w2 = o.type === 'direct'
    ? (ms[1][0] === 0 && ms[1][1] === -1)
    : (ms[1][0] === 1 && ms[1][1] === -1);
  // 三手互不重疊
  const keys = new Set(ms.map((m) => m[0] + ',' + m[1]));
  const distinct = keys.size === 3;
  // 黑3 在 5x5 內
  const in5 = Math.abs(ms[2][0]) <= 2 && Math.abs(ms[2][1]) <= 2;
  assert(ok3 && b1 && w2 && distinct && in5, `${o.name}（${o.typeLabel}${o.no}）座標自洽`);
}

console.log('花月 / 浦月 座標正確（對照研究結論）');
{
  const k = O.find((o) => o.name === '花月');
  assert(k.type === 'direct' && k.no === 4 &&
    k.moves[1][0] === 0 && k.moves[1][1] === -1 &&
    k.moves[2][0] === 1 && k.moves[2][1] === -1, '花月＝直接4，黑3(1,-1)');
  const u = O.find((o) => o.name === '浦月');
  assert(u.type === 'indirect' && u.no === 7 &&
    u.moves[1][0] === 1 && u.moves[1][1] === -1 &&
    u.moves[2][0] === 1 && u.moves[2][1] === 1, '浦月＝間接7，黑3(1,1)');
}

console.log('可在引擎上合法擺出（中心 7,7）');
for (const o of O) {
  const g = E.createGame();
  let ok = true;
  for (const [dx, dy] of o.moves) {
    if (!E.place(g, 7 + dx, 7 + dy)) { ok = false; break; }
  }
  assert(ok && g.moves.length === 3 && g.current === E.WHITE, `${o.name} 擺出後輪到白方（第 4 手）`);
}

console.log('');
console.log('通過 ' + passed + '，失敗 ' + failed);
process.exit(failed ? 1 : 0);
