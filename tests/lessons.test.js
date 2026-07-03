/* 教學關卡驗證：node tests/lessons.test.js
   逐關證明：(1) 開局輪到黑且必勝 (2) 正解首手後對手必敗 (3) 隨便亂下會失去必勝
   (4) 以正解開局、AI 攻防自走，黑能在 maxMoves 手內獲勝 */
const E = require('../engine.js');
const LESSONS = require('../lessons.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name); }
}

function build(lesson) {
  const g = E.createGame();
  for (const [x, y] of lesson.setup) {
    if (!E.place(g, x, y)) throw new Error(`setup 落子失敗 (${x},${y})`);
  }
  return g;
}

// 找一個「離戰場近但不保必勝」的錯手示範點
function findWrongMove(lesson) {
  const g = build(lesson);
  for (const [x, y] of [[0, 7], [7, 0], [1, 1], [13, 13], [0, 3]]) {
    if (g.board[y][x] !== E.EMPTY) continue;
    const g2 = build(lesson);
    E.place(g2, x, y);
    if (g2.winner) continue;
    if (!E.forcedLoss(g2, lesson.checkDepth)) return { x, y };
  }
  return null;
}

for (const lesson of LESSONS) {
  console.log(`關卡「${lesson.title}」`);
  const g = build(lesson);
  assert(g.winner === 0 && g.current === E.BLACK, '開局輪到黑棋、無勝負');
  assert(lesson.setup.length % 2 === 0, 'setup 黑白交替、以白結尾');
  assert(E.forcedWin(g, lesson.checkDepth), `開局黑棋在 ${lesson.checkDepth} 層內必勝`);

  // 正解首手
  const g2 = build(lesson);
  assert(E.place(g2, lesson.key[0], lesson.key[1]), '正解點可落子');
  assert(g2.winner === E.BLACK || E.forcedLoss(g2, lesson.checkDepth), '正解後對手必敗（或直接獲勝）');

  // 錯手示範
  const wrong = findWrongMove(lesson);
  assert(wrong !== null, `存在會被判錯的錯手（${wrong ? wrong.x + ',' + wrong.y : '無'}）`);

  // 全程自走：黑用 checkDepth 搜尋，白用困難級防守
  const g3 = build(lesson);
  let blackMoves = 0, guard = 0;
  while (!g3.winner && guard++ < 40) {
    if (g3.current === E.BLACK) {
      const mv = E.aiMove(g3, { depth: lesson.checkDepth });
      E.place(g3, mv.x, mv.y);
      blackMoves++;
    } else {
      const mv = E.aiMove(g3, { level: 'hard' });
      E.place(g3, mv.x, mv.y);
    }
  }
  assert(g3.winner === E.BLACK && blackMoves <= lesson.maxMoves,
    `AI 自走 ${blackMoves} 手獲勝（上限 ${lesson.maxMoves}）`);
}

console.log('');
console.log('通過 ' + passed + '，失敗 ' + failed);
process.exit(failed ? 1 : 0);
