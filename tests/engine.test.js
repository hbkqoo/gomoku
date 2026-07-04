/* 引擎單元測試：node tests/engine.test.js */
const E = require('../engine.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name); }
}

// 依序落子的工具：moves 為 [x, y] 陣列，黑白交替
function play(moves) {
  const g = E.createGame();
  for (const [x, y] of moves) E.place(g, x, y);
  return g;
}

/* ---- 基本規則 ---- */

console.log('基本規則');
{
  const g = E.createGame();
  assert(g.current === E.BLACK, '黑棋先行');
  assert(E.place(g, 7, 7) === true, '合法落子成功');
  assert(E.place(g, 7, 7) === false, '不可落在已有棋子上');
  assert(g.current === E.WHITE, '落子後換手');
}
{
  // 黑棋橫向連五
  const g = play([[3, 7], [3, 8], [4, 7], [4, 8], [5, 7], [5, 8], [6, 7], [6, 8], [7, 7]]);
  assert(g.winner === E.BLACK, '橫向連五判黑勝');
  assert(g.winLine && g.winLine.length >= 5, '回報勝利連線');
  assert(E.place(g, 0, 0) === false, '勝負已定不可再落子');
}
{
  // 直向連五
  const g = play([[7, 3], [8, 3], [7, 4], [8, 4], [7, 5], [8, 5], [7, 6], [8, 6], [7, 7]]);
  assert(g.winner === E.BLACK, '直向連五判勝');
}
{
  // 斜向連五
  const g = play([[3, 3], [0, 1], [4, 4], [0, 2], [5, 5], [0, 3], [6, 6], [0, 4], [7, 7]]);
  assert(g.winner === E.BLACK, '斜向連五判勝');
}

/* ---- 悔棋 ---- */

console.log('悔棋');
{
  const g = play([[7, 7], [8, 8]]);
  assert(E.undo(g) === true, '悔棋成功');
  assert(g.board[8][8] === E.EMPTY, '棋子已移除');
  assert(g.current === E.WHITE, '輪到被悔的一方');
  E.undo(g);
  assert(E.undo(g) === false, '空盤不可再悔');
}
{
  // 勝局悔棋可復活
  const g = play([[3, 7], [3, 8], [4, 7], [4, 8], [5, 7], [5, 8], [6, 7], [6, 8], [7, 7]]);
  E.undo(g);
  assert(g.winner === 0 && g.winLine === null, '悔掉致勝手後勝負重置');
}

/* ---- AI：一步決勝負 ---- */

console.log('AI 一步決勝負');
{
  // 黑有活四 (3..6, 7)，輪到黑：AI 應直接連五
  const g = play([[3, 7], [3, 0], [4, 7], [4, 0], [5, 7], [5, 0], [6, 7], [6, 0]]);
  const mv = E.aiMove(g);
  const wins = (mv.x === 2 && mv.y === 7) || (mv.x === 7 && mv.y === 7);
  assert(wins, 'AI 有連五就直取（下在 ' + mv.x + ',' + mv.y + '）');
}
{
  // 白有沖四 (3..6, 7)、(2,7) 已被黑堵住，輪到黑：AI 必須擋 (7,7)
  // 黑的填子放四角，避免自己湊出連線
  const g = play([[2, 7], [3, 7], [14, 0], [4, 7], [0, 14], [5, 7], [14, 14], [6, 7]]);
  const mv = E.aiMove(g);
  assert(mv.x === 7 && mv.y === 7, 'AI 擋住對方的沖四（下在 ' + mv.x + ',' + mv.y + '）');
}
{
  // 白有活三 (4..6, 7)，輪到黑：AI 應在 3,7 或 7,7 攔截
  const g = play([[0, 0], [4, 7], [0, 1], [5, 7], [0, 2], [6, 7]]);
  const mv = E.aiMove(g);
  const blocks = (mv.y === 7 && (mv.x === 3 || mv.x === 7));
  assert(blocks, 'AI 攔截對方活三（下在 ' + mv.x + ',' + mv.y + '）');
}

/* ---- AI：多步搜尋（比單手啟發式強的證據） ---- */

console.log('AI 多步搜尋');
{
  // 黑已有活三 (4..6, 7) 與活二 (5, 5..6)，深度搜尋應能找到製造雙威脅或直接進攻的路線；
  // 至少：AI（黑）此時不應下出與局面無關的棋
  const g = play([[4, 7], [0, 0], [5, 7], [0, 1], [6, 7], [0, 2]]);
  const mv = E.aiMove(g);
  const extendsThree = mv.y === 7 && (mv.x === 3 || mv.x === 7);
  assert(extendsThree, 'AI 把活三延伸成四逼對手（下在 ' + mv.x + ',' + mv.y + '）');
}
{
  // 深度 vs 淺層對弈 30 局太久，改驗證：搜尋版能看穿「假防守」。
  // 局面：白下一手可形成活四的雙威脅點存在時，深度搜尋應提前處理。
  // 白有兩條活二交叉（(8,4)-(8,5) 與 (6,6)-(7,6)），交叉延伸點威脅大；
  // 這裡只驗證搜尋版與淺層版在同一局面都能給出合法著手且不報錯。
  const g = play([[7, 7], [8, 4], [7, 8], [8, 5], [3, 3], [6, 6], [3, 4], [7, 6]]);
  const deep = E.aiMove(g);
  const shallow = E.aiMove(g, { depth: 0 });
  assert(deep && g.board[deep.y][deep.x] === E.EMPTY, '搜尋版回傳合法空點');
  assert(shallow && g.board[shallow.y][shallow.x] === E.EMPTY, '淺層版回傳合法空點');
  // 候選點合約：著手必須在既有棋子的 2 格範圍內（不會下到荒郊野外）
  let near = false;
  for (const m of g.moves) {
    if (Math.abs(m.x - deep.x) <= 2 && Math.abs(m.y - deep.y) <= 2) { near = true; break; }
  }
  assert(near, 'AI 著手貼近戰場（' + deep.x + ',' + deep.y + '）');
}
{
  // 空盤第一手：下天元
  const g = E.createGame();
  const mv = E.aiMove(g);
  assert(mv.x === 7 && mv.y === 7, '空盤 AI 下天元');
}

/* ---- 禁手規則 ---- */

console.log('禁手規則');
{
  // 雙活三：黑 (6,8),(7,8) 橫向活二 ＋ (6,7),(7,6) 斜向活二，交叉點 (5,8) 形成雙活三
  const g = E.createGame({ renju: true });
  for (const [x, y] of [[6, 8], [2, 2], [7, 8], [12, 2], [6, 7], [2, 12], [7, 6], [11, 11]]) E.place(g, x, y);
  assert(E.forbiddenReason(g.board, 5, 8) === '雙活三', '偵測雙活三禁手');
  assert(E.place(g, 5, 8) === false, 'renju 開啟時黑棋不能下雙活三');
  assert(g.board[8][5] === E.EMPTY, '禁手點未被落子');
}
{
  // 同一局面 renju 關閉：可以下
  const g = E.createGame();
  for (const [x, y] of [[6, 8], [2, 2], [7, 8], [12, 2], [6, 7], [2, 12], [7, 6], [11, 11]]) E.place(g, x, y);
  assert(E.place(g, 5, 8) === true, 'renju 關閉時雙活三可下');
}
{
  // 雙四：黑 (4..6,7) 沖四線 ＋ (7,4..6) 沖四線，交叉點 (7,7)
  const g = E.createGame({ renju: true });
  for (const [x, y] of [[4, 7], [3, 7], [5, 7], [7, 3], [6, 7], [2, 2], [7, 4], [12, 2], [7, 5], [2, 12], [7, 6], [12, 12]]) E.place(g, x, y);
  assert(E.forbiddenReason(g.board, 7, 7) === '雙四', '偵測雙四禁手');
}
{
  // 長連：黑 (3..7,7) 中間缺 (5,7)，補上後成六連
  const g = E.createGame({ renju: true });
  for (const [x, y] of [[2, 7], [0, 0], [3, 7], [0, 1], [4, 7], [0, 2], [6, 7], [0, 3], [7, 7], [0, 4]]) E.place(g, x, y);
  assert(E.forbiddenReason(g.board, 5, 7) === '長連', '偵測長連禁手');
  assert(E.place(g, 5, 7) === false, '長連不能下');
}
{
  // 連五優先於禁手：形成恰好五連的一手即使同時帶出其他棋形也合法
  const g = E.createGame({ renju: true });
  for (const [x, y] of [[3, 7], [0, 0], [4, 7], [0, 1], [5, 7], [0, 2], [6, 7], [0, 3]]) E.place(g, x, y);
  assert(E.place(g, 7, 7) === true, '連五的一手合法');
  assert(g.winner === E.BLACK, '連五獲勝');
}
{
  // 白棋不受禁手限制
  const g = E.createGame({ renju: true });
  for (const [x, y] of [[0, 0], [6, 8], [0, 1], [7, 8], [0, 2], [6, 7], [0, 3], [7, 6], [0, 5]]) E.place(g, x, y);
  // 輪到白，(5,8) 對白是雙活三形——白可下
  assert(E.place(g, 5, 8) === true, '白棋不受禁手限制');
}
{
  // AI 執黑在 renju 下避開禁手點
  const g = E.createGame({ renju: true });
  for (const [x, y] of [[6, 8], [2, 2], [7, 8], [12, 2], [6, 7], [2, 12], [7, 6], [11, 11]]) E.place(g, x, y);
  const mv = E.aiMove(g, { depth: 2 });
  assert(mv && !(mv.x === 5 && mv.y === 8) && E.forbiddenReason(g.board, mv.x, mv.y) === null,
    'AI 黑棋避開禁手點（下在 ' + mv.x + ',' + mv.y + '）');
}

/* ---- 難度分級 ---- */

console.log('難度分級');
{
  const mk = () => {
    const g = E.createGame();
    for (const [x, y] of [[7, 7], [8, 8], [7, 8], [8, 7], [6, 6], [9, 9]]) E.place(g, x, y);
    return g;
  };
  for (const lv of ['easy', 'medium', 'hard', 'master']) {
    const g = mk();
    const t0 = Date.now();
    const mv = E.aiMove(g, { level: lv });
    const ms = Date.now() - t0;
    assert(mv && g.board[mv.y][mv.x] === E.EMPTY, `level=${lv} 回傳合法空點（${ms} ms）`);
    if (lv === 'master') assert(ms < 2500, 'master 思考時間在預算內（' + ms + ' ms）');
  }
  // 各級都必須擋對方的四（基本底線，入門也一樣）
  for (const lv of ['easy', 'medium', 'hard', 'master']) {
    const g = E.createGame();
    for (const [x, y] of [[2, 7], [3, 7], [14, 0], [4, 7], [0, 14], [5, 7], [14, 14], [6, 7]]) E.place(g, x, y);
    const mv = E.aiMove(g, { level: lv });
    assert(mv.x === 7 && mv.y === 7, `level=${lv} 會擋沖四`);
  }
}

/* ---- 分析工具：hints 與 forcedWin ---- */

console.log('分析工具');
{
  // 黑有活四（3..6,7），輪到白：白視角應有 block 提示在 (2,7) 與 (7,7)
  const g = E.createGame();
  for (const [x, y] of [[3, 7], [3, 0], [4, 7], [4, 0], [5, 7], [5, 0], [6, 7], [6, 0], [10, 10]]) E.place(g, x, y);
  // 9 手後輪到白
  const hs = E.hints(g);
  const blocks = hs.filter((h) => h.kind === 'block').map((h) => h.x + ',' + h.y);
  assert(blocks.includes('2,7') && blocks.includes('7,7'), 'hints 標出必擋點（' + blocks.join(' / ') + '）');
}
{
  // 黑有活三，輪到黑：黑的活四點應標為 attack 或 three
  const g = E.createGame();
  for (const [x, y] of [[4, 7], [0, 0], [5, 7], [0, 1], [6, 7], [0, 2]]) E.place(g, x, y);
  const hs = E.hints(g);
  const mine = hs.filter((h) => (h.kind === 'attack' || h.kind === 'three') && h.y === 7 && (h.x === 3 || h.x === 7));
  assert(mine.length === 2, 'hints 標出我方活三的延伸點');
}
{
  // forcedWin：黑有活四 → 黑必勝；空盤 → 非必勝
  const g = E.createGame();
  for (const [x, y] of [[3, 7], [3, 0], [4, 7], [4, 0], [5, 7], [5, 0], [6, 7], [6, 0]]) E.place(g, x, y);
  assert(E.forcedWin(g, 2) === true, 'forcedWin：活四在手 → 必勝');
  const empty = E.createGame();
  assert(E.forcedWin(empty, 2) === false, 'forcedWin：空盤 → 非必勝');
}
{
  // forcedLoss：對方活四且自己無威脅 → 必敗（白的填子放四角避免成線）
  const g = E.createGame();
  for (const [x, y] of [[3, 7], [0, 0], [4, 7], [14, 0], [5, 7], [0, 14], [6, 7], [14, 14], [12, 12]]) E.place(g, x, y);
  // 輪到白，黑有活四（兩端皆空）
  assert(E.forcedLoss(g, 3) === true, 'forcedLoss：對方活四 → 必敗');
}

/* ---- 分析：analyzeMoves（熱力圖） ---- */

console.log('analyzeMoves 熱力圖評分');
{
  const g = E.createGame();
  for (const [x, y] of [[4, 7], [0, 0], [5, 7], [0, 1], [6, 7], [0, 2]]) E.place(g, x, y);
  const all = E.analyzeMoves(g);
  assert(all.length > 0, '回傳候選點');
  assert(all.every((m) => g.board[m.y][m.x] === E.EMPTY), '所有點為空點');
  assert(all.every((m) => m.norm >= 0 && m.norm <= 1), 'norm 落在 0~1');
  // 已排序：分數遞減
  let sorted = true;
  for (let i = 1; i < all.length; i++) if (all[i].score > all[i - 1].score) sorted = false;
  assert(sorted, '依分數由高到低排序');
  assert(all[0].norm === 1, '最高分 norm 為 1');
  // 黑活三的延伸點（3,7)/(7,7）應在最前面
  const top3 = all.slice(0, 4).map((m) => m.x + ',' + m.y);
  assert(top3.includes('3,7') || top3.includes('7,7'), '活三延伸點名列前茅（' + top3.join(' ') + '）');
  // top 限制
  const t5 = E.analyzeMoves(g, { top: 5 });
  assert(t5.length === 5, 'top 參數限制回傳數量');
}

/* ---- AI：速度 ---- */

console.log('AI 速度');
{
  // 模擬中盤（12 子）局面：刻意不含任何四連威脅，確保走到完整深度搜尋
  const g = play([
    [7, 7], [8, 8], [7, 8], [8, 7], [6, 6], [9, 9],
    [5, 8], [9, 6], [6, 9], [10, 7], [4, 7], [6, 7],
  ]);
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    E.aiMove(g);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > worst) worst = ms;
  }
  console.log('  （中盤單手最長 ' + worst.toFixed(0) + ' ms）');
  assert(worst < 1500, 'AI 單手思考 < 1.5 秒');
}

/* ---- AI 對弈：搜尋版 vs 單手啟發式 ---- */

console.log('AI 對弈驗證（搜尋版 vs 淺層隨機版，各執黑 3 局，seeded 可重現）');
{
  // seeded PRNG，測試結果可重現
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function duel(deepIsBlack, seed) {
    const rng = mulberry32(seed);
    const g = E.createGame();
    let guard = 0;
    while (!g.winner && guard++ < 225) {
      const deepTurn = (g.current === E.BLACK) === deepIsBlack;
      const mv = E.aiMove(g, deepTurn ? undefined : { depth: 0, jitter: 0.4, pool: 3, rng });
      if (!mv) break;
      E.place(g, mv.x, mv.y);
    }
    const deepColor = deepIsBlack ? E.BLACK : E.WHITE;
    return g.winner === deepColor ? 1 : (g.winner === -1 ? 0.5 : 0);
  }
  let score = 0, games = 0;
  for (let i = 0; i < 3; i++) { score += duel(true, 100 + i); games++; }
  for (let i = 0; i < 3; i++) { score += duel(false, 200 + i); games++; }
  console.log('  （搜尋版得分 ' + score + ' / ' + games + '）');
  assert(score >= games * 0.7, '搜尋版明顯強於淺層版（得分率 >= 70%，和局算半分）');
}

console.log('');
console.log('通過 ' + passed + '，失敗 ' + failed);
process.exit(failed ? 1 : 0);
