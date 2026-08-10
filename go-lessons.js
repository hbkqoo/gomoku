/* 圍棋教學關卡：氣與提子、逃叫吃、雙叫吃、做眼、打劫、征子。
   與五子棋關卡（用 forcedLoss 泛用搜尋判題）不同，圍棋每關自帶劇本：
   - setup(): 建好殘局的 game（可直接擺盤；打劫關需要真實落子序列才有劫狀態）
   - judge(g, moves): 玩家落子後判題 → { r: 'win'|'fail'|'continue', text? }
   - reply(g): 對手的應手（確定性劇本，不用 AI——教學要可重現）
   - afterReply(g): 對手回應後再判一次（征子關用：白逃出後氣變多＝征斷）
   - hint(g): 目前局面的建議點
   陣列另掛 .tips（新手觀念小抄）。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./go.js'), require('./go-ai.js'));
  } else root.GoLessons = factory(root.GoEngine, root.GoAI);
})(typeof self !== 'undefined' ? self : this, function (Go, AI) {
  'use strict';
  const B = 1, W = 2;

  // 直接擺盤（大多數關卡不需要劫／雜湊歷史，擺盤就夠）
  function boardGame(black, white) {
    const g = Go.createGame({ size: 9 });
    for (const [x, y] of black) g.board[y][x] = B;
    for (const [x, y] of white) g.board[y][x] = W;
    return g;
  }
  // 指定顏色中「只剩一口氣」的棋塊
  function atariGroups(g, color) {
    return Go.groupsWithLiberties(g, color, 1);
  }
  // 劇本共用：救出第一塊被叫吃的白棋（下它唯一那口氣）；救不了就虛手
  function rescueFirstAtari(g) {
    for (const grp of atariGroups(g, W)) {
      const c = Go.idxToXY(g.size, grp.libs[0]);
      if (Go.legal(g, c.x, c.y).ok) return { x: c.x, y: c.y };
    }
    return { pass: true };
  }
  // 含指定座標的棋塊
  function groupOf(g, x, y) {
    return g.board[y][x] ? Go.groupAt(g.board, g.size, x, y) : null;
  }
  // 追蹤白目標塊：初始錨點被提走就回 null
  function whiteChain(g, anchors) {
    for (const [x, y] of anchors) {
      if (g.board[y][x] === W) return Go.groupAt(g.board, g.size, x, y);
    }
    return null;
  }

  const lessons = [
    {
      id: 'capture',
      title: '氣與提子',
      subtitle: '第 1 關 · 最基礎',
      desc: '每顆棋子直線相鄰的空點叫「氣」。白棋只剩最後一口氣了——下在那裡，把它提走！',
      tip: '口訣：氣被填光，棋子就被提走。',
      explain: '棋子靠「氣」活著：直線相鄰的空點就是氣（斜的不算）。把對方棋子的氣全部填光，就能把它從棋盤上提走。提子是圍棋攻防的基本功——會算氣，才看得懂哪些棋是安全的。',
      goal: '一手提掉白子',
      maxMoves: 1,
      setup() { return boardGame([[3, 4], [5, 4], [4, 3]], [[4, 4]]); },
      judge(g) {
        if (g.captured[B] >= 1) return { r: 'win' };
        return { r: 'fail', text: '白棋只剩一口氣（它正下方的空點），下在那裡就能提走' };
      },
      reply() { return null; },
      hint() { return { x: 4, y: 5 }; },
    },
    {
      id: 'escape',
      title: '逃出叫吃',
      subtitle: '第 2 關 · 基礎',
      desc: '你的兩顆黑子只剩一口氣（這叫「被叫吃」）。往外延氣，逃出去！',
      tip: '口訣：只剩一口氣，要嘛逃、要嘛棄，別裝沒看見。',
      explain: '只剩一口氣的棋隨時會被提走。應對有二：往外「延氣」逃出去，或是判斷救不活就放棄（別再貼子送死）。這一關逃得出去——延氣後從 1 口氣變 3 口氣，白棋一時追不上了。',
      goal: '一手把被叫吃的黑子逃出來',
      maxMoves: 1,
      setup() {
        return boardGame(
          [[4, 4], [4, 5]],
          [[3, 4], [5, 4], [4, 3], [3, 5], [5, 5]]
        );
      },
      judge(g) {
        const grp = groupOf(g, 4, 4);
        if (grp && grp.libs.length >= 3) return { r: 'win' };
        return { r: 'fail', text: '被叫吃的黑子只剩下方一口氣，下在那裡延氣逃出' };
      },
      reply() { return null; },
      hint() { return { x: 4, y: 6 }; },
    },
    {
      id: 'double-atari',
      title: '雙叫吃',
      subtitle: '第 3 關 · 一石二鳥',
      desc: '找一個點，下下去「同時」叫吃兩顆白子。白棋只能救一顆，另一顆就是你的了。',
      tip: '口訣：一手叫吃兩塊，對手顧此失彼。',
      explain: '和五子棋的雙威脅同理：一手同時叫吃兩塊棋，對手一手只能救一塊。雙叫吃是最常見的吃子手筋，實戰中要隨時留意「兩顆弱子的中間點」。',
      goal: '一手雙叫吃，兩手內提到子',
      maxMoves: 2,
      setup() {
        return boardGame(
          [[3, 2], [2, 3], [5, 2], [6, 3]],
          [[3, 3], [5, 3]]
        );
      },
      judge(g, moves) {
        if (g.captured[B] >= 1) return { r: 'win' };
        if (moves === 1) {
          if (atariGroups(g, W).length >= 2) return { r: 'continue' };
          return { r: 'fail', text: '要找「同時」讓兩顆白子只剩一口氣的點——它們的中間' };
        }
        return { r: 'fail', text: '白棋救了一顆，另一顆只剩一口氣——把它提走！' };
      },
      reply(g) { return rescueFirstAtari(g); },
      hint(g) {
        for (const grp of atariGroups(g, W)) {
          const c = Go.idxToXY(g.size, grp.libs[0]);
          if (Go.legal(g, c.x, c.y).ok) return c;
        }
        return { x: 4, y: 3 };
      },
    },
    {
      id: 'two-eyes',
      title: '做出兩個眼',
      subtitle: '第 4 關 · 死活入門',
      desc: '被圍住的棋只要有「兩個分開的眼」，對方永遠下不進來，就是活棋。你的黑棋有一個三格的眼位——補一手，把它分成兩個眼！',
      tip: '口訣：兩個眼＝永遠提不走的活棋。',
      explain: '「眼」是被自己棋子完全圍住的空點：對方下進去是自殺，規則不允許。有兩個分開的眼，對方永遠無法同時填掉，這塊棋就死不了。三格直線的眼位要點在正中間——搶到中間就是兩個眼，被對方搶到就只剩一個眼（死棋）。',
      goal: '補一手做出兩個眼',
      maxMoves: 1,
      setup() {
        return boardGame(
          [[3, 0], [0, 1], [1, 1], [2, 1], [3, 1]],
          [[4, 0], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2]]
        );
      },
      judge(g) {
        const grp = groupOf(g, 1, 1);
        const eyes = AI.eyeRegions(g.board, g.size, grp).filter((r) => r.enclosed).length;
        if (eyes >= 2) return { r: 'win' };
        return { r: 'fail', text: '下在三格眼位的正中間，才能分出兩個眼；下在旁邊只會剩一個眼' };
      },
      reply() { return null; },
      hint() { return { x: 1, y: 0 }; },
    },
    {
      id: 'ko',
      title: '打劫',
      subtitle: '第 5 關 · 特殊規則',
      desc: '白棋剛提走你一顆子（劫）。規則禁止你「立刻」提回——先在別處下一手威脅（劫材）逼白棋回應，下一手才能提回來。',
      tip: '口訣：劫不能馬上提回，先找劫材。',
      explain: '如果雙方可以無限互提同一顆子，棋局永遠下不完——所以規則規定：剛被提的劫，必須先在別處下過一手才能提回。那「別處的一手」通常選對方不得不回應的威脅（例如叫吃），這叫「劫材」。劫材多的一方，打劫就佔優。',
      goal: '先找劫材（叫吃右下白棋），再提回劫',
      maxMoves: 2,
      setup() {
        const g = Go.createGame({ size: 9 });
        // 劫必須用真實落子擺出來，ko 狀態才會成立
        for (const [x, y] of [[2, 1], [3, 1], [1, 2], [4, 2], [2, 3], [3, 3], [3, 2], [2, 2]]) {
          Go.place(g, x, y);
        }
        // 劫材目標：右下的白二子（兩口氣），直接擺盤即可
        for (const [x, y] of [[5, 6], [6, 5], [7, 5], [8, 6]]) g.board[y][x] = B;
        for (const [x, y] of [[6, 6], [7, 6]]) g.board[y][x] = W;
        return g;
      },
      judge(g, moves) {
        if (moves === 1) {
          // 第一手必須是劫材：右下白塊被叫吃
          const target = whiteChain(g, [[6, 6], [7, 6]]);
          if (target && target.libs.length === 1) return { r: 'continue' };
          return { r: 'fail', text: '不能立刻提回劫——先下劫材：叫吃右下的白二子，逼白棋回應' };
        }
        // 第二手：提回劫（劫點 (3,2) 變黑、白 (2,2) 被提）
        if (g.board[2][3] === B && g.board[2][2] === 0) return { r: 'win' };
        return { r: 'fail', text: '白棋應了劫材，現在可以提回劫了——下在原來被提的位置' };
      },
      // 不能用「救第一塊被叫吃的白棋」的共用劇本：劫子 (2,2) 本來就只剩
      // 劫點一口氣、掃描序又在前，共用劇本會讓白去粘劫而不是應劫材
      reply(g) {
        const target = whiteChain(g, [[6, 6], [7, 6]]);
        if (target && target.libs.length === 1) {
          const c = Go.idxToXY(g.size, target.libs[0]);
          if (Go.legal(g, c.x, c.y).ok) return { x: c.x, y: c.y };
        }
        return { pass: true };
      },
      hint(g, moves) {
        return moves === 0 ? { x: 6, y: 7 } : { x: 3, y: 2 };
      },
    },
    {
      id: 'ladder',
      title: '征子（梯子）',
      subtitle: '第 6 關 · 進階',
      desc: '白棋想逃，但逃跑路線上有你的接應。每一手都保持叫吃（讓白只剩一口氣），一路追到底把整條白棋提走！',
      tip: '口訣：征子像下樓梯，每一步都踩住叫吃。',
      explain: '征子是「連續叫吃」的吃子法：白棋每逃一步，你就再叫吃一次，白棋的氣永遠增不上去，最後整條被提走。關鍵有二：(1) 每一手都必須讓白棋只剩一口氣，鬆一手白棋就活了；(2) 逃跑方向的斜前方要有自己的接應子（本關的黑子已就位）。實戰中「征子是否有利」要先算清楚，征不死反而虧。',
      goal: '一路叫吃到底，把白子征掉',
      maxMoves: 12,
      setup() {
        // 錨點是可變狀態（白每逃一步就多一個），必須在每次開關卡時重置，
        // 否則重試會帶著上一輪的髒錨點
        this.anchors = [[4, 4]];
        return boardGame([[4, 3], [3, 4], [5, 5]], [[4, 4]]);
      },
      judge(g) {
        if (g.captured[B] >= 1) return { r: 'win' };
        const chain = whiteChain(g, this.anchors);
        if (!chain) return { r: 'win' };
        if (chain.libs.length >= 2) {
          return { r: 'fail', text: '征子要每一手都叫吃——讓白棋只剩一口氣，不能鬆手' };
        }
        return { r: 'continue' };
      },
      reply(g) {
        const chain = whiteChain(g, this.anchors);
        if (!chain || chain.libs.length !== 1) return null;
        const c = Go.idxToXY(g.size, chain.libs[0]);
        if (Go.legal(g, c.x, c.y).ok) {
          this.anchors.push([c.x, c.y]);   // 白逃出的新子也算目標塊的錨點
          return { x: c.x, y: c.y };
        }
        return { pass: true };             // 逃了也是自殺 → 白只能虛手，你下一手提
      },
      afterReply(g) {
        const chain = whiteChain(g, this.anchors);
        if (chain && chain.libs.length >= 3) {
          return { r: 'fail', text: '這個方向征不住——白棋逃出去了。退回重試' };
        }
        return { r: 'ok' };
      },
      // 白塊兩口氣時：試下每口氣，白逃出後仍 ≤2 氣的那口才是征點
      hint(g) {
        const chain = whiteChain(g, this.anchors);
        if (!chain) return null;
        if (chain.libs.length === 1) {
          const c = Go.idxToXY(g.size, chain.libs[0]);
          return Go.legal(g, c.x, c.y).ok ? c : null;
        }
        for (const q of chain.libs) {
          const c = Go.idxToXY(g.size, q);
          if (!Go.legal(g, c.x, c.y).ok) continue;
          Go.place(g, c.x, c.y);                       // 試黑叫吃
          let good = false;
          const after = whiteChain(g, this.anchors);
          if (after && after.libs.length === 1) {
            const e = Go.idxToXY(g.size, after.libs[0]);
            if (Go.legal(g, e.x, e.y).ok) {
              Go.place(g, e.x, e.y);                   // 試白逃
              const fled = whiteChain(g, this.anchors);
              good = !!fled && fled.libs.length <= 2;
              Go.undo(g);
            } else good = true;                        // 白連逃都不能逃
          }
          Go.undo(g);
          if (good) return c;
        }
        return null;
      },
    },
  ];

  // 新手觀念小抄
  lessons.tips = [
    { h: '氣＝棋子的命', b: '棋子直線相鄰的空點叫「氣」（斜的不算）。氣被對方填光，整塊棋就被提走。下每一手前先看看自己和對方的氣。' },
    { h: '被叫吃要回應', b: '只剩一口氣叫「被叫吃」。要嘛延氣逃走、要嘛乾脆放棄，最糟的是裝沒看見——下一手就被提走。' },
    { h: '兩個眼＝活棋', b: '被自己完全圍住的空點叫「眼」。有兩個分開的眼，對方永遠下不進來（下進去是自殺），這塊棋就永遠提不走。' },
    { h: '金角銀邊草肚皮', b: '圍同樣的地，角落最省子、邊線次之、中央最花。開局先佔角、再搶邊，最後才經營中央。' },
    { h: '打劫不能馬上提回', b: '剛被提的劫要先在別處下一手（最好是對方非應不可的「劫材」）才能提回。劫材多的一方打劫佔優。' },
    { h: '沒棋下就虛手', b: '盤上沒有值得下的點時按「虛手」讓一手。雙方連續虛手就進入數子：地盤＋活子多的一方獲勝（白方有貼目補償）。' },
  ];

  return lessons;
});
