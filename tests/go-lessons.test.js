/* 圍棋教學關卡測試：node tests/go-lessons.test.js
   每一關都實際走過：照 hint 走必須過關（可解性）、典型錯手必須被擋（判題有效）。 */
const Go = require('../go.js');
const L = require('../go-lessons.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name); }
}
function eq(a, b, name) {
  const ok = a === b;
  if (!ok) console.error(`         期望 ${b}，實得 ${a}`);
  assert(ok, name);
}

// 模擬教學流程：玩家照 hint 走，對手照劇本應，回傳結果軌跡
function playThrough(lesson, maxSteps) {
  const g = lesson.setup();
  const log = [];
  let moves = 0;
  for (let step = 0; step < (maxSteps || 20); step++) {
    const h = lesson.hint(g, moves);
    if (!h) { log.push('no-hint'); break; }
    if (!Go.place(g, h.x, h.y)) { log.push(`place-rejected(${h.x},${h.y})`); break; }
    moves++;
    const j = lesson.judge(g, moves);
    log.push(`black(${h.x},${h.y})→${j.r}`);
    if (j.r === 'win') return { result: 'win', moves, log, g };
    if (j.r === 'fail') return { result: 'fail', moves, log, g };
    const rep = lesson.reply ? lesson.reply(g) : null;
    if (rep && !rep.pass) {
      if (!Go.place(g, rep.x, rep.y)) { log.push(`reply-rejected(${rep.x},${rep.y})`); break; }
      log.push(`white(${rep.x},${rep.y})`);
    } else if (rep && rep.pass) {
      Go.pass(g);
      log.push('white-pass');
    }
    if (lesson.afterReply) {
      const a = lesson.afterReply(g);
      if (a.r === 'fail') return { result: 'afterReply-fail', moves, log, g };
    }
    if (moves >= lesson.maxMoves) return { result: 'exhausted', moves, log, g };
  }
  return { result: 'stuck', moves, log, g };
}

/* ---- 共通結構 ---- */
console.log('關卡結構');
{
  eq(L.length, 6, '共 6 關');
  assert(L.tips && L.tips.length === 6, '6 條新手觀念');
  for (const les of L) {
    assert(!!(les.id && les.title && les.desc && les.explain && les.goal && les.tip), `${les.id}：欄位齊全`);
    assert(typeof les.setup === 'function' && typeof les.judge === 'function' && typeof les.hint === 'function',
      `${les.id}：setup/judge/hint 都是函式`);
    const g = les.setup();
    eq(g.size, 9, `${les.id}：9 路盤`);
    eq(g.current, 1, `${les.id}：輪到黑棋`);
    // 擺出來的每一塊棋都要有氣（擺錯盤面的老坑）
    const seen = new Set();
    let zeroLib = 0;
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      if (!g.board[y][x]) continue;
      const p = y * 9 + x;
      if (seen.has(p)) continue;
      const grp = Go.groupAt(g.board, 9, x, y);
      for (const q of grp.stones) seen.add(q);
      if (grp.libs.length === 0) zeroLib++;
    }
    eq(zeroLib, 0, `${les.id}：盤面上沒有 0 氣的棋塊`);
  }
}

/* ---- 每關可解性：照 hint 走必過關 ---- */
console.log('可解性（照提示走到底）');
for (const les of L) {
  const r = playThrough(les);
  assert(r.result === 'win', `${les.id}：照提示走能過關（${r.result}；${r.log.join(' ')}）`);
  assert(r.moves <= les.maxMoves, `${les.id}：在步數上限內完成（${r.moves}/${les.maxMoves}）`);
}

/* ---- 判題有效：典型錯手要被擋 ---- */
console.log('判題（錯手被擋）');
{
  // 關 1：下在別處沒提到子 → fail
  const les = L[0];
  const g = les.setup();
  Go.place(g, 0, 0);
  const j = les.judge(g, 1);
  eq(j.r, 'fail', 'capture：下錯處判 fail');
  assert(!!j.text, 'capture：fail 有說明文字');
}
{
  // 關 2：不逃反下別處 → fail
  const les = L[1];
  const g = les.setup();
  Go.place(g, 0, 0);
  eq(les.judge(g, 1).r, 'fail', 'escape：沒逃判 fail');
  // 正解後那塊棋確實 3 口氣
  const g2 = les.setup();
  Go.place(g2, 4, 6);
  const grp = Go.groupAt(g2.board, 9, 4, 4);
  eq(grp.libs.length, 3, 'escape：逃出後 3 口氣');
}
{
  // 關 3：只叫吃一顆 → fail；正解 (4,3) 同時叫吃兩顆
  const les = L[2];
  const g = les.setup();
  Go.place(g, 3, 4);   // 只叫吃左邊那顆
  eq(les.judge(g, 1).r, 'fail', 'double-atari：單叫吃判 fail');
  const g2 = les.setup();
  Go.place(g2, 4, 3);
  eq(les.judge(g2, 1).r, 'continue', 'double-atari：雙叫吃判 continue');
  eq(Go.groupsWithLiberties(g2, 2, 1).length, 2, 'double-atari：兩顆白子都剩一氣');
}
{
  // 關 4：下在眼位角落（非中間）→ 只剩一個眼 → fail
  const les = L[3];
  const g = les.setup();
  Go.place(g, 0, 0);
  eq(les.judge(g, 1).r, 'fail', 'two-eyes：搶錯點判 fail');
  const g2 = les.setup();
  Go.place(g2, 1, 0);
  eq(les.judge(g2, 1).r, 'win', 'two-eyes：點中間判 win');
}
{
  // 關 5：立刻回提被引擎擋（劫）；先下無關處 → fail
  const les = L[4];
  const g = les.setup();
  eq(g.ko, Go.xyToIdx(9, 3, 2), 'ko：劫點成立');
  assert(Go.legal(g, 3, 2).ok === false, 'ko：立刻回提被規則擋下');
  assert(/劫/.test(Go.legal(g, 3, 2).reason), 'ko：拒絕理由是劫爭');
  Go.place(g, 0, 8);   // 下無關處（不是劫材）
  eq(les.judge(g, 1).r, 'fail', 'ko：非劫材判 fail');
  // 正解流程：劫材 → 白應 → 回提
  const g2 = les.setup();
  Go.place(g2, 6, 7);
  eq(les.judge(g2, 1).r, 'continue', 'ko：劫材判 continue');
  const rep = les.reply(g2);
  assert(rep && !rep.pass, 'ko：白會應劫材');
  Go.place(g2, rep.x, rep.y);
  assert(Go.legal(g2, 3, 2).ok, 'ko：交換後可以回提了');
  Go.place(g2, 3, 2);
  eq(les.judge(g2, 2).r, 'win', 'ko：回提判 win');
}
{
  // 關 6：鬆一手（不叫吃）→ fail；追錯方向 → afterReply fail
  const les = L[5];
  const g = les.setup();
  Go.place(g, 0, 0);   // 完全不理白棋
  eq(les.judge(g, 1).r, 'fail', 'ladder：鬆手判 fail');

  const g2 = les.setup();
  Go.place(g2, 4, 5);              // 正解第一手：叫吃
  eq(les.judge(g2, 1).r, 'continue', 'ladder：叫吃判 continue');
  const rep = les.reply(g2);       // 白逃
  Go.place(g2, rep.x, rep.y);
  eq(les.afterReply(g2).r, 'ok', 'ladder：白逃出仍 ≤2 氣（征持續）');
  // 追錯方向：下讓白逃出後 3 氣的那口
  const chain = Go.groupAt(g2.board, 9, rep.x, rep.y);
  const hintPt = les.hint(g2, 2);
  const wrong = chain.libs.map((q) => Go.idxToXY(9, q)).find((c) => !(c.x === hintPt.x && c.y === hintPt.y));
  assert(!!wrong, 'ladder：存在另一口氣（錯征點）');
  Go.place(g2, wrong.x, wrong.y);
  const j2 = les.judge(g2, 2);
  if (j2.r === 'continue') {
    const rep2 = les.reply(g2);
    Go.place(g2, rep2.x, rep2.y);
    eq(les.afterReply(g2).r, 'fail', 'ladder：追錯方向白逃出 → afterReply 判 fail');
  } else {
    eq(j2.r, 'fail', 'ladder：錯征點直接判 fail');
  }
}
{
  // 關 6 重開不殘留狀態：連續 setup 兩次，第二次照 hint 走仍能過關
  const les = L[5];
  playThrough(les);
  const r2 = playThrough(les);
  assert(r2.result === 'win', `ladder：重開關卡不受上一輪影響（${r2.result}）`);
}

console.log(`\n通過 ${passed}，失敗 ${failed}`);
process.exit(failed ? 1 : 0);
