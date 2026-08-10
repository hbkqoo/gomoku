/* 圍棋 AI 單元測試：node tests/go-ai.test.js
   重點是「高速盤面」與 go.js 的一致性——偽氣法寫錯不會噴錯，只會靜默下出爛棋。 */
const Go = require('../go.js');
const AI = require('../go-ai.js');
const I = AI._internal;

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

/* ---- 高速盤面 vs go.js：隨機對局逐手交叉比對 ---- */
console.log('高速盤面與 go.js 一致性');
{
  // 逐手比對盤面、棋塊大小、叫吃狀態、劫點。
  // go.js 已被 132 項測試驗過，這裡拿它當基準來抓 union-find／偽氣法的錯。
  function crossCheck(size, seed, maxMoves) {
    const g = Go.createGame({ size });
    const b = I.setFromGame(I.makeBoard(size), g);
    const rng = I.makeRng(seed);
    const bad = [];
    for (let step = 0; step < maxMoves; step++) {
      const legal = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (g.board[y][x] !== Go.EMPTY) continue;
          if (Go.legal(g, x, y).ok) legal.push([x, y]);
        }
      }
      if (!legal.length) break;
      const [x, y] = legal[(rng() * legal.length) | 0];
      const mover = g.current;
      Go.place(g, x, y);
      I.playStone(b, y * size + x, mover);

      for (let p = 0; p < size * size; p++) {
        const px = p % size, py = (p - px) / size;
        if (b.color[p] !== g.board[py][px]) { bad.push(`第 ${step + 1} 手：(${px},${py}) 顏色不一致`); return bad; }
        if (b.color[p] === Go.EMPTY) continue;
        const grp = Go.groupAt(g.board, size, px, py);
        const r = I.find(b, p);
        if (b.cnt[r] !== grp.stones.length) { bad.push(`第 ${step + 1} 手：(${px},${py}) 棋塊大小 ${b.cnt[r]} ≠ ${grp.stones.length}`); return bad; }
        const atari = I.inAtari(b, r);
        if (atari !== (grp.libs.length === 1)) { bad.push(`第 ${step + 1} 手：(${px},${py}) 叫吃判定不一致（氣=${grp.libs.length}）`); return bad; }
        if (atari && I.atariPoint(b, r) !== grp.libs[0]) { bad.push(`第 ${step + 1} 手：(${px},${py}) 叫吃點不一致`); return bad; }
      }
      if (b.ko !== g.ko) { bad.push(`第 ${step + 1} 手：劫點不一致 ${b.ko} ≠ ${g.ko}`); return bad; }
    }
    return bad;
  }

  for (const size of [9, 13, 19]) {
    for (const seed of [1, 7, 99]) {
      const bad = crossCheck(size, seed, size * size * 2);
      assert(bad.length === 0, `${size} 路隨機對局逐手一致（seed ${seed}）` + (bad.length ? ' → ' + bad[0] : ''));
    }
  }
}

/* ---- 合法性判定 ---- */
console.log('合法性判定');
{
  // 與 go.js 全盤比對（超劫除外——模擬只認簡單劫，那是刻意的取捨）
  const g = Go.createGame({ size: 9 });
  const rng = I.makeRng(4242);
  for (let k = 0; k < 40; k++) {
    const legal = [];
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (Go.legal(g, x, y).ok) legal.push([x, y]);
    if (!legal.length) break;
    const [x, y] = legal[(rng() * legal.length) | 0];
    Go.place(g, x, y);
  }
  const b = I.setFromGame(I.makeBoard(9), g);
  let diff = 0;
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const r = Go.legal(g, x, y);
      const fast = I.isLegal(b, y * 9 + x, g.current);
      if (r.ok !== fast && !/超劫|重現/.test(r.reason)) diff++;
    }
  }
  eq(diff, 0, '高速盤面的合法性判定與 go.js 一致（超劫除外）');
}
{
  // 提子先於自殺：能提到子就合法
  const g = Go.createGame({ size: 9 });
  for (const [x, y] of [[2, 0], [1, 0], [1, 1], [0, 1], [0, 2], [8, 8]]) Go.place(g, x, y);
  const b = I.setFromGame(I.makeBoard(9), g);
  assert(I.isLegal(b, 0, Go.BLACK) === true, '高速盤面同樣認定「能提子就不算自殺」');
  const captured = I.playStone(b, 0, Go.BLACK);
  eq(captured, 2, '高速盤面一手提兩子');
  eq(b.color[1], Go.EMPTY, '被提的子已清除');
}
{
  const g = Go.createGame({ size: 9 });
  for (const [x, y] of [[1, 0], [8, 8], [0, 1]]) Go.place(g, x, y);
  const b = I.setFromGame(I.makeBoard(9), g);
  assert(I.isLegal(b, 0, Go.WHITE) === false, '高速盤面拒絕自殺手');
}

/* ---- 真眼判定 ---- */
console.log('真眼判定');
{
  const g = Go.createGame({ size: 9 });
  // 中腹真眼：(4,4) 四鄰皆黑，對角無白
  for (const [x, y] of [[3, 4], [5, 4], [4, 3], [4, 5]]) g.board[y][x] = Go.BLACK;
  let b = I.setFromGame(I.makeBoard(9), g);
  assert(I.isTrueEye(b, 4 * 9 + 4, Go.BLACK) === true, '中腹四鄰皆己方 → 真眼');
  assert(I.isTrueEye(b, 4 * 9 + 4, Go.WHITE) === false, '同一點對白棋不是眼');
  // 一個對角是白：中腹仍算真眼（容許 1 個）
  g.board[3][3] = Go.WHITE;
  b = I.setFromGame(I.makeBoard(9), g);
  assert(I.isTrueEye(b, 4 * 9 + 4, Go.BLACK) === true, '中腹容許 1 個敵方對角');
  // 兩個對角是白 → 假眼
  g.board[5][5] = Go.WHITE;
  b = I.setFromGame(I.makeBoard(9), g);
  assert(I.isTrueEye(b, 4 * 9 + 4, Go.BLACK) === false, '中腹 2 個敵方對角 → 假眼');
}
{
  const g = Go.createGame({ size: 9 });
  // 角上眼：(0,0) 兩鄰皆黑，唯一在盤上的對角 (1,1) 必須不是白
  g.board[0][1] = Go.BLACK; g.board[1][0] = Go.BLACK;
  let b = I.setFromGame(I.makeBoard(9), g);
  assert(I.isTrueEye(b, 0, Go.BLACK) === true, '角上兩鄰皆己方 → 真眼');
  g.board[1][1] = Go.WHITE;
  b = I.setFromGame(I.makeBoard(9), g);
  assert(I.isTrueEye(b, 0, Go.BLACK) === false, '角上只要有 1 個敵方對角就是假眼');
}

/* ---- 數子與模擬 ---- */
console.log('模擬');
{
  // areaMargin 是「模擬結束時」用的快速版：只看空點的四鄰，不做 flood fill。
  // 模擬打完盤面幾乎填滿，這個近似與 go.js 的 score() 一致；但在稀疏盤面上
  // 兩者本來就不同（這裡單子在角會多算到兩個鄰接空點），刻意記錄這個差異。
  const g = Go.createGame({ size: 9 });
  g.board[0][0] = Go.BLACK;
  const b = I.setFromGame(I.makeBoard(9), g);
  eq(I.areaMargin(b, 0), 3, '稀疏盤面上快速數子只認鄰接空點（1 子 + 2 鄰點）');
  eq(Go.score(g, []).black, 81, '對照：go.js 的 flood fill 會把整盤算給黑（兩者用途不同）');
}
{
  const g = Go.createGame({ size: 9 });
  for (let y = 0; y < 9; y++) { g.board[y][3] = Go.BLACK; g.board[y][5] = Go.WHITE; }
  const b = I.setFromGame(I.makeBoard(9), g);
  // 黑 9 子 + 左三行 27，白 9 子 + 右三行 27，中間一行雙方接觸不算
  eq(I.areaMargin(b, 0), 0, '兩邊對稱時目差為 0');
  eq(I.areaMargin(b, 7.5), -7.5, '貼目正確反映在目差上');
}
{
  const g = Go.createGame({ size: 9 });
  const root = I.setFromGame(I.makeBoard(9), g);
  const b = I.makeBoard(9);
  const rng = I.makeRng(2026);
  let finite = 0, filled = 0, maxEmpty = 0;
  for (let i = 0; i < 200; i++) {
    I.copyBoard(b, root);
    const m = I.playout(b, Go.BLACK, 7.5, rng, 9 * 9 * 2 + 40);
    if (Number.isFinite(m)) finite++;
    if (b.emptyCount > maxEmpty) maxEmpty = b.emptyCount;
    // 模擬會一直下到雙方都只剩眼位可填；9 路實測平均剩 14 點、最多 24 點
    if (b.emptyCount <= 32) filled++;
  }
  eq(finite, 200, '200 盤模擬都得到有限的目差');
  assert(filled === 200, `模擬都下到接近終局（空點剩 ≤32，實測最多 ${maxEmpty}）`);
}

/* ---- 模擬中的叫吃應對 ---- */
console.log('叫吃應對（模擬策略）');
{
  // 這一組是回歸測試：第一版把方向寫反了，只處理「對手自己送吃」（幾乎不發生），
  // 真正常見的「對手那一手把我方叫吃」完全沒回應，實測 400 次只觸發 6 次。
  const g = Go.createGame({ size: 9 });
  for (const [x, y] of [[4, 4], [4, 5]]) g.board[y][x] = Go.BLACK;
  for (const [x, y] of [[3, 4], [5, 4], [4, 3], [3, 5], [5, 5]]) g.board[y][x] = Go.WHITE;
  const b = I.setFromGame(I.makeBoard(9), g);
  b.lastMove = Go.xyToIdx(9, 4, 3);          // 白剛下 (4,3) 造成叫吃
  const cands = I.tacticalCandidates(b, Go.BLACK);
  eq(cands.length, 1, '我方被叫吃 → 產生 1 個戰術候選');
  eq(cands[0], Go.xyToIdx(9, 4, 6), '候選就是延氣點 (4,6)');
  const rng = I.makeRng(5);
  let hit = 0;
  for (let i = 0; i < 400; i++) if (I.pickMove(b, Go.BLACK, rng) === Go.xyToIdx(9, 4, 6)) hit++;
  assert(hit > 300, `模擬有很高比例會回應叫吃（400 次中 ${hit} 次，設計值 85%）`);
}
{
  const g = Go.createGame({ size: 9 });
  for (const [x, y] of [[3, 4], [5, 4], [4, 3]]) g.board[y][x] = Go.BLACK;
  g.board[4][4] = Go.WHITE;
  const b = I.setFromGame(I.makeBoard(9), g);
  b.lastMove = Go.xyToIdx(9, 4, 4);          // 白把自己下成一氣
  const cands = I.tacticalCandidates(b, Go.BLACK);
  eq(cands.length, 1, '對手送吃 → 產生 1 個戰術候選');
  eq(cands[0], Go.xyToIdx(9, 4, 5), '候選就是提子點 (4,5)');
}
{
  // 逃到死路不該列入候選，否則模擬會一路往死裡填子
  const g = Go.createGame({ size: 9 });
  g.board[0][0] = Go.BLACK;
  g.board[0][1] = Go.WHITE; g.board[1][0] = Go.WHITE; g.board[1][1] = Go.WHITE;
  const b = I.setFromGame(I.makeBoard(9), g);
  assert(I.escapeIsUseful(b, Go.xyToIdx(9, 0, 0), Go.BLACK) === false, '沒有出路的點不算有效逃氣');
  const b2 = I.setFromGame(I.makeBoard(9), Go.createGame({ size: 9 }));
  assert(I.escapeIsUseful(b2, Go.xyToIdx(9, 4, 4), Go.BLACK) === true, '空曠處算有效逃氣');
}
{
  const g = Go.createGame({ size: 9 });
  const b = I.setFromGame(I.makeBoard(9), g);
  b.lastMove = Go.xyToIdx(9, 4, 4);
  eq(I.tacticalCandidates(b, Go.BLACK).length, 0, '沒有叫吃時不產生戰術候選');
}

/* ---- AI 戰術 ---- */
console.log('AI 戰術');
{
  // 提子必須是「勝負關鍵」時才測得準：MCTS 追求勝率而非目數，
  // 局面已定的話它下哪裡都贏，不提子並不算錯（那塊棋本來就死了）。
  // 這裡用終盤局面——不提就輸 11.5 目，提了就贏。
  const g = Go.createGame({ size: 9 });
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.board[y][x] = x < 5 ? Go.BLACK : Go.WHITE;
  for (const [x, y] of [[1, 3], [2, 3], [1, 4], [2, 4], [1, 5], [2, 5]]) g.board[y][x] = Go.WHITE;
  g.board[6][2] = Go.EMPTY;    // 白 6 子唯一的氣
  g.board[0][8] = Go.EMPTY;    // 另外留兩個沒價值的空點，讓 AI 必須做選擇
  g.board[1][8] = Go.EMPTY;
  g.current = Go.BLACK;
  const grp = Go.groupAt(g.board, 9, 1, 3);
  eq(grp.stones.length, 6, '（前置）白棋一塊 6 子');
  eq(grp.libs.length, 1, '（前置）只剩一氣');
  assert(Go.score(g, []).diff < 0, '（前置）不提子的話黑方輸');
  const g2 = Go.createGame({ size: 9 });
  g2.board = g.board.map((r) => r.slice());
  Go.place(g2, 2, 6);
  assert(Go.score(g2, []).diff > 0, '（前置）提子之後黑方贏');
  let hit = 0;
  for (const seed of [11, 23, 47]) {
    const mv = AI.aiMove(g, { level: 'medium', seed });
    if (mv && mv.x === 2 && mv.y === 6) hit++;
  }
  eq(hit, 3, '勝負關鍵的提子，AI 三個種子都找得到');
}
{
  // 自己被叫吃且逃得掉：AI 不該坐視不管
  const g = Go.createGame({ size: 9 });
  for (const [x, y] of [[4, 4], [4, 5]]) g.board[y][x] = Go.BLACK;
  for (const [x, y] of [[3, 4], [5, 4], [4, 3], [3, 5], [5, 5]]) g.board[y][x] = Go.WHITE;
  const grp = Go.groupAt(g.board, 9, 4, 4);
  eq(grp.libs.length, 1, '（前置）黑兩子只剩一氣 (4,6)');
  g.current = Go.BLACK;
  const mv = AI.aiMove(g, { level: 'hard', seed: 5 });
  assert(mv && !mv.pass, 'AI 沒有虛手');
  assert(mv && mv.x === 4 && mv.y === 6, `AI 會延氣自救（實得 ${JSON.stringify(mv)}）`);
}
{
  // 不下自殺點、不自填真眼、不早早虛手
  const g = Go.createGame({ size: 9 });
  let ok = true, passes = 0;
  for (let i = 0; i < 24; i++) {
    const mv = AI.aiMove(g, { level: 'easy', seed: 100 + i });
    if (!mv) { ok = false; break; }
    if (mv.pass) { passes++; Go.pass(g); continue; }
    if (!Go.legal(g, mv.x, mv.y).ok) { ok = false; break; }
    Go.place(g, mv.x, mv.y);
  }
  assert(ok, 'AI 連下 24 手都是合法著手');
  eq(passes, 0, '開局階段 AI 不會虛手');
}
{
  // 對手虛手且自己大幅領先時，AI 願意跟著虛手收局
  const g = Go.createGame({ size: 9 });
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    if (x < 4) g.board[y][x] = Go.BLACK;
    else if (x > 4) g.board[y][x] = Go.WHITE;
  }
  // 黑 36 子、白 36 子，中間一行空；白有貼目 7.5 → 白領先
  g.current = Go.BLACK;
  Go.pass(g);                       // 黑先虛手
  const mv = AI.aiMove(g, { level: 'medium', seed: 3 });
  assert(mv && mv.pass === true, `領先的白方跟著虛手收局（實得 ${JSON.stringify(mv)}）`);
}
{
  const g = Go.createGame({ size: 9 });
  Go.pass(g); Go.pass(g);
  eq(g.phase, 'scoring', '（前置）已進入確認階段');
  eq(AI.aiMove(g, { level: 'easy' }), null, '非對局階段回傳 null');
}

/* ---- 熱力圖／提示 ---- */
console.log('熱力圖與提示');
{
  const g = Go.createGame({ size: 9 });
  Go.place(g, 4, 4);
  const list = AI.analyzeMoves(g, { level: 'easy', top: 10, seed: 21 });
  assert(list.length > 0 && list.length <= 10, `analyzeMoves 回傳 ≤10 筆（實得 ${list.length}）`);
  assert(list.every((m) => m.norm >= 0 && m.norm <= 1), 'norm 落在 0~1');
  assert(list[0].norm === 1, '最高分的 norm 為 1');
  assert(list.every((m, i) => i === 0 || m.visits <= list[i - 1].visits), '依訪問數由高到低排序');
  assert(list.every((m) => g.board[m.y][m.x] === Go.EMPTY), '建議點都是空點');
  assert(list.every((m) => Go.legal(g, m.x, m.y).ok), '建議點都是合法著手');
}
{
  // 同樣要用「勝負關鍵」的局面，理由見上方 AI 戰術那一段
  const g = Go.createGame({ size: 9 });
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.board[y][x] = x < 5 ? Go.BLACK : Go.WHITE;
  for (const [x, y] of [[1, 3], [2, 3], [1, 4], [2, 4], [1, 5], [2, 5]]) g.board[y][x] = Go.WHITE;
  g.board[6][2] = Go.EMPTY;
  g.board[0][8] = Go.EMPTY;
  g.board[1][8] = Go.EMPTY;
  g.current = Go.BLACK;
  const h = AI.hints(g, { seed: 9 });
  assert(h && h.x === 2 && h.y === 6, `提示會指出勝負關鍵的提子（實得 ${JSON.stringify(h)}）`);
}

/* ---- 分時搜尋（UI 不凍結所需） ---- */
console.log('分時搜尋');
{
  const g = Go.createGame({ size: 9 });
  const s = AI.createSearch(g, { level: 'medium', seed: 8 });
  let slices = 0;
  while (!s.step(20) && slices < 500) slices++;
  assert(slices > 1, `搜尋確實被切成多個時間片（${slices} 片）`);
  assert(s.done(), '跑完後回報完成');
  assert(s.sims() > 100, `累積模擬數合理（${s.sims()}）`);
  const mv = s.best();
  assert(mv && !mv.pass && Go.legal(g, mv.x, mv.y).ok, '分時搜尋得到合法著手');
}
{
  // 同一個種子要得到同一手，否則測試不可重現
  const g = Go.createGame({ size: 9 });
  Go.place(g, 4, 4); Go.place(g, 2, 2);
  const a = AI.aiMove(g, { level: 'medium', seed: 777, sims: 3000, ms: 99999 });
  const b = AI.aiMove(g, { level: 'medium', seed: 777, sims: 3000, ms: 99999 });
  assert(a.x === b.x && a.y === b.y, `同種子同預算 → 同一手（${JSON.stringify(a)} vs ${JSON.stringify(b)}）`);
}

/* ---- 棋力：MCTS vs 規則型對手（隨機合法手 + 提子啟發式） ---- */
console.log('棋力對局');
{
  // 對手就是模擬用的策略本身：隨機合法非眼手，但會優先提掉被叫吃的敵塊。
  function baselineMove(game, rng) {
    const size = game.size;
    const b = I.setFromGame(I.makeBoard(size), game);
    const p = I.pickMoveForTest ? I.pickMoveForTest(b, game.current, rng) : null;
    if (p !== null && p !== undefined) return p;
    return null;
  }
  // pickMove 沒有對外，改用等價做法：先找提子點，找不到就隨機合法非眼點
  function baseline(game, rng) {
    const size = game.size;
    const b = I.setFromGame(I.makeBoard(size), game);
    const me = game.current, opp = me === Go.BLACK ? Go.WHITE : Go.BLACK;
    const caps = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (game.board[y][x] !== opp) continue;
        const g2 = Go.groupAt(game.board, size, x, y);
        if (g2.libs.length === 1) {
          const q = g2.libs[0];
          const qx = q % size, qy = (q - qx) / size;
          if (Go.legal(game, qx, qy).ok && caps.indexOf(q) < 0) caps.push(q);
        }
      }
    }
    if (caps.length && rng() < 0.85) {
      const q = caps[(rng() * caps.length) | 0];
      return { x: q % size, y: (q - q % size) / size };
    }
    const list = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = y * size + x;
        if (!I.isLegal(b, p, me) || I.isTrueEye(b, p, me)) continue;
        list.push({ x, y });
      }
    }
    if (!list.length) return { pass: true };
    return list[(rng() * list.length) | 0];
  }

  const GAMES = 8;
  let wins = 0, marginSum = 0;
  const t0 = Date.now();
  for (let k = 0; k < GAMES; k++) {
    const g = Go.createGame({ size: 9 });
    const rng = I.makeRng(1000 + k);
    const aiSide = k % 2 === 0 ? Go.BLACK : Go.WHITE;   // 輪流執黑執白
    let guard = 0;
    while (g.phase === 'play' && guard++ < 400) {
      let mv;
      if (g.current === aiSide) mv = AI.aiMove(g, { level: 'medium', sims: 1200, ms: 99999, seed: 500 + k * 17 + guard });
      else mv = baseline(g, rng);
      if (!mv || mv.pass) { Go.pass(g); continue; }
      if (!Go.place(g, mv.x, mv.y)) Go.pass(g);
    }
    const r = Go.score(g, []);
    const aiMargin = aiSide === Go.BLACK ? r.diff : -r.diff;
    marginSum += aiMargin;
    if (aiMargin > 0) wins++;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`         ${GAMES} 盤 9 路對局耗時 ${secs}s，AI 勝 ${wins}，平均目差 ${(marginSum / GAMES).toFixed(1)}`);
  assert(wins >= Math.ceil(GAMES * 0.8), `MCTS 對規則型對手勝率 ≥80%（實得 ${wins}/${GAMES}）`);
  assert(marginSum / GAMES > 10, `平均領先超過 10 目（實得 ${(marginSum / GAMES).toFixed(1)}）`);
}

console.log(`\n通過 ${passed}，失敗 ${failed}`);
process.exit(failed ? 1 : 0);
