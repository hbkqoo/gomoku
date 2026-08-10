/* 圍棋引擎單元測試：node tests/go.test.js */
const G = require('../go.js');

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

// 依序落子（黑白交替）；[x, y]，用 'p' 表示虛手
function play(g, moves) {
  for (const m of moves) {
    if (m === 'p') G.pass(g);
    else G.place(g, m[0], m[1]);
  }
  return g;
}
const nine = () => G.createGame({ size: 9 });
const at = (g, x, y) => g.board[y][x];

/* ---- 基本規則 ---- */
console.log('基本規則');
{
  const g = nine();
  eq(g.size, 9, '盤面大小為 9');
  eq(g.komi, 7.5, '預設貼目 7.5');
  eq(g.current, G.BLACK, '黑棋先行');
  assert(G.place(g, 4, 4) === true, '合法落子成功');
  eq(g.current, G.WHITE, '落子後換手');
  assert(G.place(g, 4, 4) === false, '不可落在已有棋子上');
  assert(G.place(g, -1, 0) === false, '不可落在盤外');
  assert(G.place(g, 9, 0) === false, '不可落在盤外（右下界）');
  eq(g.moves.length, 1, '非法著手不進棋譜');
}
{
  const g = G.createGame();
  eq(g.size, 19, '預設 19 路');
  const g13 = G.createGame({ size: 13 });
  eq(g13.size, 13, '可指定 13 路');
  const gx = G.createGame({ size: 11 });
  eq(gx.size, 19, '不支援的尺寸退回 19 路');
}

/* ---- 氣 ---- */
console.log('氣與棋塊');
{
  const g = nine();
  G.place(g, 4, 4);
  const grp = G.groupAt(g.board, 9, 4, 4);
  eq(grp.libs.length, 4, '天元單子有 4 氣');
  eq(grp.stones.length, 1, '單子棋塊只有 1 顆');
}
{
  const g = nine();
  G.place(g, 0, 0);
  eq(G.libertyCount(g.board, 9, 0, 0), 2, '角上單子有 2 氣');
}
{
  const g = nine();
  G.place(g, 4, 0);
  eq(G.libertyCount(g.board, 9, 4, 0), 3, '邊上單子有 3 氣');
}
{
  const g = play(nine(), [[4, 4], [0, 0], [4, 5]]);
  const grp = G.groupAt(g.board, 9, 4, 4);
  eq(grp.stones.length, 2, '相鄰同色成一塊');
  eq(grp.libs.length, 6, '中腹兩子連塊共 6 氣');
}

/* ---- 提子 ---- */
console.log('提子');
{
  // 黑四面包圍天元的白子
  const g = play(nine(), [[3, 4], [4, 4], [5, 4], [0, 0], [4, 3], [0, 1], [4, 5]]);
  eq(at(g, 4, 4), G.EMPTY, '白子四面無氣被提');
  eq(g.captured[G.BLACK], 1, '黑方提子數 +1');
  eq(g.captured[G.WHITE], 0, '白方提子數不變');
  // 剛被提的點不會被永久封鎖，但此處四周皆黑，白棋回下就是自殺
  assert(G.legal(g, 4, 4).ok === false, '提子後該點對白棋而言仍是自殺點');
}
{
  // 角上白子被兩子提掉
  const g = play(nine(), [[4, 4], [0, 0], [1, 0], [8, 8], [0, 1]]);
  eq(at(g, 0, 0), G.EMPTY, '角上白子兩氣被提');
  eq(g.captured[G.BLACK], 1, '角上提子計數正確');
}
{
  // 一手同時提兩塊
  const g = play(nine(), [[2, 0], [1, 0], [1, 1], [0, 1], [0, 2], [8, 8], [0, 0]]);
  eq(at(g, 1, 0), G.EMPTY, '同手提掉白子（1,0）');
  eq(at(g, 0, 1), G.EMPTY, '同手提掉白子（0,1）');
  eq(at(g, 0, 0), G.BLACK, '提子後自己的子留在盤上');
  eq(g.captured[G.BLACK], 2, '一手提兩子計數正確');
}

/* ---- 禁著點（自殺） ---- */
console.log('禁著點');
{
  // 黑佔 (1,0) 與 (0,1)，白下 (0,0) 無氣又提不到子 → 禁著
  const g = play(nine(), [[1, 0], [8, 8], [0, 1]]);
  eq(g.current, G.WHITE, '輪到白棋');
  const r = G.legal(g, 0, 0);
  assert(r.ok === false, '無氣且提不到子 → 禁著點');
  assert(/自殺/.test(r.reason), '禁著理由標明自殺');
  assert(G.place(g, 0, 0) === false, 'place 也拒絕自殺手');
  eq(at(g, 0, 0), G.EMPTY, '被拒絕的自殺手不留痕跡');
}
{
  // 能提到對方就不算自殺（提子先於自殺判定）
  const g = play(nine(), [[2, 0], [1, 0], [1, 1], [0, 1], [0, 2], [8, 8]]);
  const r = G.legal(g, 0, 0);
  assert(r.ok === true, '下下去能提子 → 不算自殺，合法');
  eq(r.captures.length, 2, '合法性檢查回報會提掉 2 子');
  assert(at(g, 1, 0) === G.WHITE && at(g, 0, 1) === G.WHITE, '合法性檢查不會改動盤面');
}
{
  // 整塊自殺：黑補上最後一氣讓自己兩子無氣
  const g = nine();
  // 白圍出一個兩格的空位 (0,0) (1,0)，黑填其一 → 該塊仍有一氣，合法；填滿才是自殺
  play(g, [[8, 8], [2, 0], [8, 7], [0, 1], [8, 6], [1, 1], [7, 8], [1, 0]]);
  // 現在白在 (2,0)(0,1)(1,1)(1,0)，(0,0) 被白完全包圍
  const r = G.legal(g, 0, 0);
  assert(r.ok === false, '下進對方完整眼位是自殺（禁著）');
}

/* ---- 打劫 ---- */
console.log('打劫');
{
  // 標準劫形：黑 (2,1)(1,2)(2,3)，白 (3,1)(4,2)(3,3)
  const g = play(nine(), [
    [2, 1], [3, 1], [1, 2], [4, 2], [2, 3], [3, 3],
    [3, 2],          // 黑先入劫
    [2, 2],          // 白提掉黑 (3,2)
  ]);
  eq(at(g, 3, 2), G.EMPTY, '白提掉黑子');
  eq(at(g, 2, 2), G.WHITE, '白子留在劫上');
  eq(g.ko, G.xyToIdx(9, 3, 2), '劫點記在被提的位置');
  eq(g.current, G.BLACK, '輪到黑棋');
  const r = G.legal(g, 3, 2);
  assert(r.ok === false, '黑不可立即回提');
  // 這裡刻意檢查「簡單劫」的專屬訊息：立即回提同時也違反超劫，
  // 只檢查是否含「劫」字的話，兩條規則會互相遮蔽，簡單劫壞掉也測不出來
  assert(/立即回提/.test(r.reason), '拒絕理由是劫爭而非超劫（簡單劫規則本身有生效）');

  G.place(g, 8, 8);            // 黑找劫材（下他處）
  eq(g.ko, -1, '黑下他處後劫點解除');
  G.place(g, 7, 8);            // 白應劫材
  assert(G.legal(g, 3, 2).ok === true, '隔一手後黑可以回提');
  G.place(g, 3, 2);
  eq(at(g, 2, 2), G.EMPTY, '黑回提成功');
  eq(g.ko, G.xyToIdx(9, 2, 2), '回提後換白棋被劫住');
}
{
  // 提兩子不構成劫（劫只在「提一子且自己是單子一氣」時成立）
  const g = play(nine(), [[2, 0], [1, 0], [1, 1], [0, 1], [0, 2], [8, 8], [0, 0]]);
  eq(g.ko, -1, '一手提兩子不設劫點');
}

/* ---- 超劫（位置重現） ---- */
console.log('超劫與雜湊');
{
  const g = play(nine(), [[4, 4], [2, 2], [4, 5]]);
  eq(g.seen.size, 4, '每一手落子記一個盤面雜湊（含空盤）');
  G.pass(g);
  eq(g.seen.size, 4, '虛手不新增盤面雜湊');
  G.undo(g);
  G.undo(g);
  eq(g.seen.size, 3, '悔棋會把該盤面從歷史中移除');
  assert(G.place(g, 4, 5) === true, '悔棋後同一手可以重下');
}
{
  // 白箱驗證：把「下一手會產生的盤面」預先塞進歷史，該手必須被拒絕。
  // （真正的三劫循環／長生局面難以手工排出，這裡直接驗超劫檢查本身有生效）
  const g = nine();
  const probe = G.createGame({ size: 9 });
  G.place(probe, 4, 4);
  const futureHash = probe.moves[0].hash;
  g.seen.add(futureHash);
  const r = G.legal(g, 4, 4);
  assert(r.ok === false, '會重現既有盤面的著手被拒絕');
  assert(/超劫|重現/.test(r.reason), '拒絕理由標明超劫');
  eq(at(g, 4, 4), G.EMPTY, '被超劫拒絕的著手不留痕跡');
}

/* ---- 虛手與階段 ---- */
console.log('虛手與對局階段');
{
  const g = nine();
  assert(G.pass(g) === true, '可以虛手');
  eq(g.current, G.WHITE, '虛手後換手');
  eq(g.passes, 1, '連續虛手計數 1');
  eq(g.phase, 'play', '單方虛手仍在對局中');
  G.pass(g);
  eq(g.passes, 2, '連續虛手計數 2');
  eq(g.phase, 'scoring', '雙方虛手後進入確認死子階段');
  assert(G.place(g, 0, 0) === false, '確認階段不可落子');
  G.undo(g);
  eq(g.phase, 'play', '悔棋可退回對局中');
  eq(g.current, G.WHITE, '悔棋後輪次正確');
}
{
  const g = play(nine(), [[4, 4], 'p', [3, 3]]);
  eq(g.passes, 0, '中間有人落子就重新計算連續虛手');
  eq(g.phase, 'play', '不連續的虛手不會收局');
}
{
  const g = nine();
  G.place(g, 4, 4);
  G.resign(g, G.WHITE);
  eq(g.phase, 'over', '認輸後對局結束');
  eq(g.winner, G.BLACK, '白方認輸判黑勝');
  eq(g.reason, 'resign', '結束原因為認輸');
}

/* ---- 悔棋 ---- */
console.log('悔棋');
{
  const g = play(nine(), [[3, 4], [4, 4], [5, 4], [0, 0], [4, 3], [0, 1], [4, 5]]);
  eq(at(g, 4, 4), G.EMPTY, '（前置）白子已被提');
  G.undo(g);
  eq(at(g, 4, 4), G.WHITE, '悔棋還原被提的白子');
  eq(at(g, 4, 5), G.EMPTY, '悔棋移除剛下的黑子');
  eq(g.captured[G.BLACK], 0, '悔棋還原提子計數');
  eq(g.current, G.BLACK, '悔棋後輪回黑棋');
  assert(G.place(g, 4, 5) === true, '悔棋後可重下同一手');
  eq(at(g, 4, 4), G.EMPTY, '重下後白子再次被提');
}
{
  const g = nine();
  assert(G.undo(g) === false, '空棋譜悔棋回傳 false');
}
{
  // 劫的狀態也要還原
  const g = play(nine(), [
    [2, 1], [3, 1], [1, 2], [4, 2], [2, 3], [3, 3], [3, 2], [2, 2],
  ]);
  const koIdx = g.ko;
  G.place(g, 8, 8);
  eq(g.ko, -1, '（前置）下他處後劫解除');
  G.undo(g);
  eq(g.ko, koIdx, '悔棋還原劫點');
}

/* ---- 棋譜重播 ---- */
console.log('棋譜重播');
{
  const g = play(nine(), [[3, 4], [4, 4], [5, 4], [0, 0], [4, 3], [0, 1], [4, 5]]);
  const full = G.replayBoard(g, g.moves.length);
  let same = true;
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (full[y][x] !== g.board[y][x]) same = false;
  assert(same, '重播到最後一手與現盤一致');
  const before = G.replayBoard(g, 6);
  eq(before[4][4], G.WHITE, '重播到提子前，白子還在盤上');
  const after = G.replayBoard(g, 7);
  eq(after[4][4], G.EMPTY, '重播到提子後，白子已消失');
  const empty = G.replayBoard(g, 0);
  eq(empty[4][4], G.EMPTY, '重播到第 0 手是空盤');
}

/* ---- 數子（中國規則） ---- */
console.log('中國規則數子');
{
  // 黑佔 x=3 整行、白佔 x=5 整行：左三行黑地、右三行白地、x=4 為單官
  const g = nine();
  for (let y = 0; y < 9; y++) { g.board[y][3] = G.BLACK; g.board[y][5] = G.WHITE; }
  const r = G.score(g, []);
  eq(r.blackStones, 9, '黑子數 9');
  eq(r.whiteStones, 9, '白子數 9');
  eq(r.blackTerritory, 27, '黑地 27（左三行）');
  eq(r.whiteTerritory, 27, '白地 27（右三行）');
  eq(r.dame, 9, '雙方都接觸的一行是單官 9');
  eq(r.black, 36, '黑總分 = 子 9 + 地 27');
  eq(r.white, 43.5, '白總分 = 子 9 + 地 27 + 貼目 7.5');
  eq(r.diff, -7.5, '黑白差 -7.5');
  eq(r.winner, G.WHITE, '白方以貼目取勝');
}
{
  // 同一盤面塞一顆白子進黑陣：不標死 → 黑地全變單官；標死 → 黑地恢復
  const g = nine();
  for (let y = 0; y < 9; y++) { g.board[y][3] = G.BLACK; g.board[y][5] = G.WHITE; }
  g.board[0][0] = G.WHITE;
  const alive = G.score(g, []);
  eq(alive.blackTerritory, 0, '未標死的白子讓黑地變成單官');
  eq(alive.whiteStones, 10, '未標死時白子數 10');
  const dead = G.score(g, [G.xyToIdx(9, 0, 0)]);
  eq(dead.blackTerritory, 27, '標死後黑地恢復 27');
  eq(dead.whiteStones, 9, '標死的白子不計入白子數');
  eq(dead.deadWhite, 1, '回報死掉的白子數');
  eq(dead.black, 36, '標死後黑總分 36');
}
{
  // 單子佔空盤：全盤都是它的地
  const g = nine();
  g.board[0][0] = G.BLACK;
  const r = G.score(g, []);
  eq(r.black, 81, '孤子獨佔全盤 = 1 子 + 80 地');
  eq(r.white, 7.5, '白方只有貼目');
  eq(r.winner, G.BLACK, '黑勝');
}
{
  const g = nine();
  const r = G.score(g, []);
  eq(r.dame, 81, '空盤全部是單官');
  eq(r.black, 0, '空盤黑 0 分');
  eq(r.winner, G.WHITE, '空盤由貼目判白勝');
}
{
  // owner 陣列供地盤預覽使用
  const g = nine();
  g.board[0][0] = G.BLACK;
  const r = G.score(g, []);
  eq(r.owner[G.xyToIdx(9, 0, 0)], G.BLACK, 'owner 標出黑子本身');
  eq(r.owner[G.xyToIdx(9, 8, 8)], G.BLACK, 'owner 標出黑方地盤');
}
{
  // finalize 會收局並寫進 game
  const g = nine();
  g.board[0][0] = G.BLACK;
  G.pass(g); G.pass(g);
  eq(g.phase, 'scoring', '（前置）已進入確認階段');
  const r = G.finalize(g, []);
  eq(g.phase, 'over', 'finalize 後對局結束');
  eq(g.winner, G.BLACK, 'finalize 寫入勝方');
  eq(g.reason, 'score', '結束原因為數子');
  eq(g.result.black, r.black, 'result 保留結算明細');
}
{
  const g = nine();
  G.pass(g); G.pass(g);
  assert(G.resumePlay(g) === true, '可從確認階段退回續下');
  eq(g.phase, 'play', '退回後階段為對局中');
  eq(g.passes, 0, '退回後連續虛手歸零');
}

/* ---- 查詢 API ---- */
console.log('查詢 API');
{
  const g = nine();
  eq(G.legalMoves(g).length, 81, '空盤 81 個合法點');
  G.place(g, 4, 4);
  eq(G.legalMoves(g).length, 80, '一子之後 80 個合法點');
}
{
  // 被叫吃的棋塊
  const g = play(nine(), [[4, 4], [0, 0], [1, 0]]);
  const atari = G.groupsWithLiberties(g, G.WHITE, 1);
  eq(atari.length, 1, '找出 1 塊被叫吃的白棋');
  eq(atari[0].stones.length, 1, '被叫吃的是單子');
  eq(G.groupsWithLiberties(g, G.BLACK, 1).length, 0, '黑棋沒有被叫吃的棋塊');
}
{
  eq(G.starPoints(9).length, 5, '9 路 5 個星位');
  eq(G.starPoints(13).length, 5, '13 路 5 個星位');
  eq(G.starPoints(19).length, 9, '19 路 9 個星位');
  const s9 = G.starPoints(9).map((p) => p.join(','));
  assert(s9.indexOf('4,4') >= 0, '9 路含天元 (4,4)');
  assert(s9.indexOf('2,2') >= 0, '9 路含 (2,2)（三線星位）');
  const s19 = G.starPoints(19).map((p) => p.join(','));
  assert(s19.indexOf('3,3') >= 0, '19 路含 (3,3)（四線星位）');
  assert(s19.indexOf('9,9') >= 0, '19 路含天元 (9,9)');
  assert(s19.indexOf('15,15') >= 0, '19 路含 (15,15)（十六線星位）');
}
{
  const g = nine();
  const st = G.status(g);
  assert(st.over === false, 'status 回報未結束');
  eq(st.phase, 'play', 'status 回報目前階段');
  eq(G.other(G.BLACK), G.WHITE, 'other() 換色正確');
  eq(G.colorName(G.BLACK), '黑棋', 'colorName() 正確');
  const c = G.idxToXY(9, G.xyToIdx(9, 3, 5));
  assert(c.x === 3 && c.y === 5, '座標索引互轉一致');
}

console.log(`\n通過 ${passed}，失敗 ${failed}`);
process.exit(failed ? 1 : 0);
