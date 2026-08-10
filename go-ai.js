/* 圍棋 AI：蒙地卡羅樹搜尋（UCT）+ 隨機模擬。
   內部另有一套高速盤面（union-find + 偽氣法），與 go.js 的可讀盤面分工：
   go.js 對 UI 負責、這裡對速度負責。純 flood fill 在 19 路上每秒只跑得動
   幾百盤模擬，那等同亂下；偽氣法把每手的氣數維護降到接近 O(1)。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./go.js'));
  else root.GoAI = factory(root.GoEngine);
})(typeof self !== 'undefined' ? self : this, function (Go) {
  'use strict';
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const PASS = -1;
  const other = (c) => (c === BLACK ? WHITE : BLACK);
  const now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now() : () => Date.now();

  /* ---------- 亂數（可指定種子，讓測試可重現） ---------- */
  function makeRng(seed) {
    let s = (seed >>> 0) || 0x2545f491;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ---------- 鄰接表（依盤面大小快取） ---------- */
  const nbCache = {};
  function neighborTable(size) {
    if (nbCache[size]) return nbCache[size];
    const n = size * size;
    const oStart = new Int32Array(n + 1), oList = [];
    const dStart = new Int32Array(n + 1), dList = [];
    const dOff = new Int32Array(n);            // 該點有幾個對角落在盤外
    for (let p = 0; p < n; p++) {
      const x = p % size, y = (p - x) / size;
      oStart[p] = oList.length;
      if (y > 0) oList.push(p - size);
      if (x > 0) oList.push(p - 1);
      if (x < size - 1) oList.push(p + 1);
      if (y < size - 1) oList.push(p + size);
      dStart[p] = dList.length;
      let off = 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k & 1 ? 1 : -1), ny = y + (k & 2 ? 1 : -1);
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) dList.push(ny * size + nx);
        else off++;
      }
      dOff[p] = off;
    }
    oStart[n] = oList.length;
    dStart[n] = dList.length;
    const t = { size, o: Int32Array.from(oList), oStart, d: Int32Array.from(dList), dStart, dOff };
    nbCache[size] = t;
    return t;
  }

  /* ---------- 高速盤面 ----------
     每個棋塊用 union-find 表示，並維護「偽氣」三個累加量：
       libN = 帶重複的氣數、libS = Σ(氣位置+1)、libQ = Σ(氣位置+1)²
     只剩一氣（被叫吃）⇔ libN>0 且 libS² === libN·libQ（柯西不等式取等號），
     那口氣的位置就是 libS/libN − 1。用 +1 偏移是為了避開 0 號點造成的退化。 */
  function makeBoard(size) {
    const n = size * size;
    return {
      size, n, nb: neighborTable(size),
      color: new Int8Array(n),
      parent: new Int32Array(n),
      next: new Int32Array(n),      // 同塊棋子的環狀串列（提子時要走訪整塊）
      libN: new Int32Array(n),
      libS: new Float64Array(n),
      libQ: new Float64Array(n),
      cnt: new Int32Array(n),
      empties: new Int32Array(n),   // 空點清單，供 O(1) 隨機取點
      emptyPos: new Int32Array(n),
      emptyCount: 0,
      ko: -1,
      lastMove: PASS,
    };
  }

  function clearBoard(b) {
    b.color.fill(EMPTY);
    b.emptyCount = b.n;
    for (let p = 0; p < b.n; p++) { b.empties[p] = p; b.emptyPos[p] = p; }
    b.ko = -1;
    b.lastMove = PASS;
  }

  function copyBoard(dst, src) {
    dst.color.set(src.color);
    dst.parent.set(src.parent);
    dst.next.set(src.next);
    dst.libN.set(src.libN);
    dst.libS.set(src.libS);
    dst.libQ.set(src.libQ);
    dst.cnt.set(src.cnt);
    dst.empties.set(src.empties);
    dst.emptyPos.set(src.emptyPos);
    dst.emptyCount = src.emptyCount;
    dst.ko = src.ko;
    dst.lastMove = src.lastMove;
  }

  function removeEmpty(b, p) {
    const i = b.emptyPos[p], last = b.empties[--b.emptyCount];
    b.empties[i] = last; b.emptyPos[last] = i;
  }
  function addEmpty(b, p) {
    b.empties[b.emptyCount] = p; b.emptyPos[p] = b.emptyCount++;
  }

  function find(b, p) {
    let r = p;
    while (b.parent[r] !== r) r = b.parent[r];
    while (b.parent[p] !== r) { const nx = b.parent[p]; b.parent[p] = r; p = nx; }
    return r;
  }
  function addLib(b, r, q) {
    const v = q + 1;
    b.libN[r] += 1; b.libS[r] += v; b.libQ[r] += v * v;
  }
  function subLib(b, r, q) {
    const v = q + 1;
    b.libN[r] -= 1; b.libS[r] -= v; b.libQ[r] -= v * v;
  }
  function inAtari(b, r) {
    return b.libN[r] > 0 && b.libS[r] * b.libS[r] === b.libN[r] * b.libQ[r];
  }
  function atariPoint(b, r) {
    return b.libS[r] / b.libN[r] - 1;
  }

  function unite(b, a, c) {
    let ra = find(b, a), rc = find(b, c);
    if (ra === rc) return;
    if (b.cnt[ra] < b.cnt[rc]) { const t = ra; ra = rc; rc = t; }
    b.parent[rc] = ra;
    b.cnt[ra] += b.cnt[rc];
    b.libN[ra] += b.libN[rc];
    b.libS[ra] += b.libS[rc];
    b.libQ[ra] += b.libQ[rc];
    const t = b.next[ra]; b.next[ra] = b.next[rc]; b.next[rc] = t;
  }

  function removeChain(b, r) {
    let p = r;
    do {
      const nxt = b.next[p];
      b.color[p] = EMPTY;
      addEmpty(b, p);
      const o = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
      for (let i = s; i < e; i++) {
        const q = o[i];
        if (b.color[q] !== EMPTY) addLib(b, find(b, q), p);
      }
      p = nxt;
    } while (p !== r);
  }

  // 合法性：空點、非劫點，且不是自殺。
  // 「不是自殺」等價於：有空鄰點 ∨ 有非叫吃的同色鄰塊 ∨ 有被叫吃的異色鄰塊。
  function isLegal(b, p, c) {
    if (b.color[p] !== EMPTY || p === b.ko) return false;
    const o = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
    for (let i = s; i < e; i++) {
      const q = o[i], cv = b.color[q];
      if (cv === EMPTY) return true;
      const r = find(b, q);
      if (cv === c) { if (!inAtari(b, r)) return true; }
      else if (inAtari(b, r)) return true;
    }
    return false;
  }

  // 真眼（含假眼判定）：四鄰全是自己，且對角被敵子佔的數量夠少
  function isTrueEye(b, p, c) {
    const o = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
    for (let i = s; i < e; i++) if (b.color[o[i]] !== c) return false;
    const d = b.nb.d, ds = b.nb.dStart[p], de = b.nb.dStart[p + 1];
    const opp = other(c);
    let bad = 0;
    for (let i = ds; i < de; i++) if (b.color[d[i]] === opp) bad++;
    return b.nb.dOff[p] > 0 ? bad === 0 : bad <= 1;
  }

  // 落子（呼叫前必須先確認 isLegal）；回傳提子數
  function playStone(b, p, c) {
    const opp = other(c);
    b.color[p] = c;
    removeEmpty(b, p);
    b.parent[p] = p; b.next[p] = p; b.cnt[p] = 1;
    b.libN[p] = 0; b.libS[p] = 0; b.libQ[p] = 0;

    const o = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
    for (let i = s; i < e; i++) {
      const q = o[i];
      if (b.color[q] === EMPTY) addLib(b, p, q);
      else subLib(b, find(b, q), p);
    }
    let captured = 0, capPoint = -1;
    for (let i = s; i < e; i++) {
      const q = o[i];
      if (b.color[q] !== opp) continue;
      const r = find(b, q);
      if (b.libN[r] === 0) {
        if (b.cnt[r] === 1) capPoint = r;
        captured += b.cnt[r];
        removeChain(b, r);
      }
    }
    for (let i = s; i < e; i++) {
      const q = o[i];
      if (b.color[q] === c) unite(b, p, q);
    }
    const rp = find(b, p);
    b.ko = (captured === 1 && b.cnt[rp] === 1 && inAtari(b, rp)) ? capPoint : -1;
    b.lastMove = p;
    return captured;
  }

  // 從 go.js 的可讀盤面建出高速盤面
  function setFromGame(b, game) {
    clearBoard(b);
    const size = b.size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = game.board[y][x];
        if (c === EMPTY) continue;
        const p = y * size + x;
        b.color[p] = c; removeEmpty(b, p);
        b.parent[p] = p; b.next[p] = p; b.cnt[p] = 1;
        b.libN[p] = 0; b.libS[p] = 0; b.libQ[p] = 0;
      }
    }
    for (let p = 0; p < b.n; p++) {
      if (b.color[p] === EMPTY) continue;
      const o = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
      for (let i = s; i < e; i++) {
        const q = o[i];
        if (b.color[q] === b.color[p]) unite(b, p, q);
      }
    }
    for (let p = 0; p < b.n; p++) {
      if (b.color[p] === EMPTY) continue;
      const r = find(b, p);
      const o = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
      for (let i = s; i < e; i++) if (b.color[o[i]] === EMPTY) addLib(b, r, o[i]);
    }
    b.ko = typeof game.ko === 'number' ? game.ko : -1;
    const last = game.moves && game.moves.length ? game.moves[game.moves.length - 1] : null;
    b.lastMove = (last && !last.pass) ? last.y * size + last.x : PASS;
    return b;
  }

  /* ---------- 中國規則數子（模擬結束時用；此時死子早已被提乾淨） ---------- */
  function areaMargin(b, komi) {
    let black = 0, white = 0;
    for (let p = 0; p < b.n; p++) {
      const c = b.color[p];
      if (c === BLACK) { black++; continue; }
      if (c === WHITE) { white++; continue; }
      let hasB = false, hasW = false;
      const o = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
      for (let i = s; i < e; i++) {
        const v = b.color[o[i]];
        if (v === BLACK) hasB = true; else if (v === WHITE) hasW = true;
      }
      if (hasB && !hasW) black++;
      else if (hasW && !hasB) white++;
    }
    return black - white - komi;
  }

  /* ---------- 隨機模擬 ---------- */
  // 叫吃應對：純亂下的模擬讀不出死活，加上「對手那一手造成的叫吃要回應」
  // 之後棋力差距非常明顯。注意方向——要看的是「對手那手讓誰只剩一氣」，
  // 主要情況是我方被叫吃（該逃或反提），而不是對手自己送吃。
  const TACTIC_P = 0.85;
  function pickMove(b, c, rng) {
    if (b.lastMove >= 0 && rng() < TACTIC_P) {
      const cands = tacticalCandidates(b, c);
      if (cands.length) return cands[(rng() * cands.length) | 0];
    }
    const m = b.emptyCount;
    if (m === 0) return PASS;
    let i = (rng() * m) | 0;
    for (let k = 0; k < m; k++) {
      const p = b.empties[i];
      if (isLegal(b, p, c) && !isTrueEye(b, p, c)) return p;
      if (++i >= m) i = 0;
    }
    return PASS;
  }

  // 逃氣是否有意義：接上有氣的同伴、順手提子，或那口氣本身還有兩個以上空鄰點。
  // 少了這道過濾，模擬會一路往死路裡填子，反而比亂下更糟。
  function escapeIsUseful(b, p, c) {
    const opp = other(c);
    const o = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
    let empties = 0;
    for (let i = s; i < e; i++) {
      const q = o[i], cv = b.color[q];
      if (cv === EMPTY) { empties++; continue; }
      const r = find(b, q);
      if (cv === c) { if (!inAtari(b, r)) return true; }
      else if (inAtari(b, r)) return true;
    }
    return empties >= 2;
  }

  // 上一手所引發的戰術點：提掉被叫吃的敵塊、或救出被叫吃的我方棋塊
  function tacticalCandidates(b, c) {
    const out = [];
    const lm = b.lastMove;
    const opp = other(c);
    const pushCap = (p) => {
      if (p >= 0 && p < b.n && isLegal(b, p, c) && out.indexOf(p) < 0) out.push(p);
    };
    const pushEscape = (p) => {
      if (p >= 0 && p < b.n && isLegal(b, p, c) && escapeIsUseful(b, p, c) && out.indexOf(p) < 0) out.push(p);
    };
    // (1) 對手剛下的那一塊若只剩一氣 → 直接提掉
    if (b.color[lm] === opp) {
      const r = find(b, lm);
      if (inAtari(b, r)) pushCap(atariPoint(b, r));
    }
    // (2) 那一手的四周：敵塊被叫吃就提，我方被叫吃就逃
    const o = b.nb.o, s = b.nb.oStart[lm], e = b.nb.oStart[lm + 1];
    for (let i = s; i < e; i++) {
      const q = o[i], cv = b.color[q];
      if (cv === EMPTY) continue;
      const r = find(b, q);
      if (!inAtari(b, r)) continue;
      if (cv === opp) pushCap(atariPoint(b, r));
      else pushEscape(atariPoint(b, r));
    }
    return out;
  }

  function playout(b, color, komi, rng, maxMoves) {
    let c = color, passes = 0, moves = 0;
    while (passes < 2 && moves < maxMoves) {
      const p = pickMove(b, c, rng);
      if (p === PASS) { passes++; b.ko = -1; b.lastMove = PASS; }
      else { playStone(b, p, c); passes = 0; }
      c = other(c);
      moves++;
    }
    return areaMargin(b, komi);
  }

  /* ---------- 難度 ---------- */
  // ms 與 sims 誰先到就停。實測（本機）9 路約 5.1 萬盤/秒、19 路約 1.3 萬盤/秒，
  // 所以 9 路多半是 sims 先到、19 路是 ms 先到——兩邊都不會空等。
  const AI_LEVELS = {
    easy: { label: '入門', ms: 250, sims: 500, pick: 'top3' },
    medium: { label: '進階', ms: 800, sims: 15000, pick: 'top' },
    hard: { label: '困難', ms: 2000, sims: 60000, pick: 'top' },
    master: { label: '大師', ms: 4000, sims: 200000, pick: 'top' },
  };

  const UCT_C = 0.9;
  const PRIOR_N = 6;      // 每個新子節點的虛擬訪問數（先驗強度）
  const EXPAND_T = 8;     // 節點被訪問幾次後才展開子節點

  function newNode(move, player) {
    return { move, player, visits: 0, wins: 0, children: null };
  }

  function createSearch(game, opts) {
    const o = opts || {};
    const level = AI_LEVELS[o.level] || AI_LEVELS.medium;
    const budgetMs = Number.isFinite(o.ms) ? o.ms : level.ms;
    const budgetSims = Number.isFinite(o.sims) ? o.sims : level.sims;
    const size = game.size, komi = game.komi;
    const rootColor = game.current;
    const rootBoard = setFromGame(makeBoard(size), game);
    const scratch = makeBoard(size);
    const rng = makeRng(Number.isFinite(o.seed) ? o.seed : ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0));
    const maxPlayoutMoves = size * size * 2 + 40;
    // 早早虛手是災難（盤面還很空就收手）。只有在對手剛虛手、或棋局已過半時才准虛手。
    const canPass = game.passes >= 1 || game.moves.length >= Math.floor(size * size * 0.5);
    const maxChildRoot = size * size <= 169 ? Infinity : 100;
    const maxChild = size * size <= 169 ? 40 : 24;

    const root = newNode(-2, other(rootColor));
    let sims = 0, msUsed = 0;

    function prior(b, p, c) {
      let v = 0.5;
      const opp = other(c);
      const o2 = b.nb.o, s = b.nb.oStart[p], e = b.nb.oStart[p + 1];
      let emptyN = 0, capSize = 0, saveOwn = 0;
      for (let i = s; i < e; i++) {
        const q = o2[i], cv = b.color[q];
        if (cv === EMPTY) { emptyN++; continue; }
        const r = find(b, q);
        if (cv === opp) { if (inAtari(b, r)) capSize += b.cnt[r]; }
        else if (inAtari(b, r)) saveOwn += b.cnt[r];
      }
      if (capSize) v += Math.min(0.30, 0.10 + 0.03 * capSize);
      if (saveOwn) v += Math.min(0.20, 0.06 + 0.02 * saveOwn);
      if (emptyN === 0 && !capSize) v -= 0.25;   // 多半是自填或自緊氣
      const x = p % size, y = (p - x) / size;
      const line = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (line === 0) v -= 0.18;
      else if (line === 1) v -= 0.04;
      if (b.lastMove >= 0) {
        const lx = b.lastMove % size, ly = (b.lastMove - lx) / size;
        if (Math.max(Math.abs(lx - x), Math.abs(ly - y)) <= 2) v += 0.07;
      }
      return v < 0.02 ? 0.02 : v > 0.98 ? 0.98 : v;
    }

    function expand(node, b, color, isRoot) {
      const list = [];
      for (let i = 0; i < b.emptyCount; i++) {
        const p = b.empties[i];
        if (!isLegal(b, p, color) || isTrueEye(b, p, color)) continue;
        const nd = newNode(p, color);
        nd.prior = prior(b, p, color);
        list.push(nd);
      }
      const cap = isRoot ? maxChildRoot : maxChild;
      if (list.length > cap) {
        list.sort((a, c2) => c2.prior - a.prior);
        list.length = cap;
      }
      for (const nd of list) { nd.visits = PRIOR_N; nd.wins = PRIOR_N * nd.prior; }
      // 虛手永遠是候選，但先驗壓很低；只有真的走投無路時才會被搜出來
      const pn = newNode(PASS, color);
      pn.visits = PRIOR_N;
      pn.wins = PRIOR_N * (list.length ? 0.05 : 0.5);
      list.push(pn);
      node.children = list;
    }

    function selectUCT(node) {
      const ch = node.children;
      let best = null, bestVal = -Infinity;
      const logN = Math.log(node.visits > 1 ? node.visits : 2);
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i];
        const val = c.wins / c.visits + UCT_C * Math.sqrt(logN / c.visits);
        if (val > bestVal) { bestVal = val; best = c; }
      }
      return best;
    }

    expand(root, rootBoard, rootColor, true);

    const path = [];
    function iterate() {
      copyBoard(scratch, rootBoard);
      path.length = 0;
      path.push(root);
      let node = root, color = rootColor, passes = game.passes;
      while (node.children) {
        const child = selectUCT(node);
        if (!child) break;
        node = child;
        path.push(node);
        if (node.move === PASS) { passes++; scratch.ko = -1; scratch.lastMove = PASS; }
        else { playStone(scratch, node.move, color); passes = 0; }
        color = other(color);
        if (passes >= 2) break;
        if (!node.children && node.visits >= EXPAND_T) expand(node, scratch, color, false);
      }
      const margin = (passes >= 2)
        ? areaMargin(scratch, komi)
        : playout(scratch, color, komi, rng, maxPlayoutMoves);
      const winner = margin > 0 ? BLACK : WHITE;
      for (let i = 0; i < path.length; i++) {
        const nd = path[i];
        nd.visits++;
        if (nd.player === winner) nd.wins++;
      }
      sims++;
    }

    function work(sliceMs) {
      const left = budgetMs - msUsed;
      if (left <= 0 || sims >= budgetSims) return true;
      const t0 = now();
      const deadline = t0 + Math.min(sliceMs, left);
      while (sims < budgetSims) {
        for (let k = 0; k < 16 && sims < budgetSims; k++) iterate();
        if (now() >= deadline) break;
      }
      msUsed += now() - t0;
      return msUsed >= budgetMs || sims >= budgetSims;
    }

    // 排序後的根節點候選（訪問數優先，同數比勝率）
    function ranked() {
      return root.children
        .filter((c) => c.visits > PRIOR_N || root.children.length === 1)
        .sort((a, b2) => (b2.visits - a.visits) || (b2.wins / b2.visits - a.wins / a.visits));
    }

    function toMove(c) {
      if (!c || c.move === PASS) return { pass: true, winrate: c ? c.wins / c.visits : 0.5 };
      const x = c.move % size, y = (c.move - x) / size;
      return { x, y, winrate: c.wins / c.visits, visits: c.visits };
    }

    function best() {
      let list = ranked();
      if (!list.length) list = root.children.slice().sort((a, b2) => b2.wins / b2.visits - a.wins / a.visits);
      if (!canPass) list = list.filter((c) => c.move !== PASS);
      // 落子點還要通過 go.js 的完整規則（含超劫）——模擬只認簡單劫
      for (const c of list) {
        if (c.move === PASS) return toMove(c);
        const x = c.move % size, y = (c.move - x) / size;
        if (Go.legal(game, x, y).ok) {
          if (level.pick === 'top3' && list.length > 1) {
            const top = list.filter((k) => k.move !== PASS).slice(0, 3)
              .filter((k) => { const kx = k.move % size; return Go.legal(game, kx, (k.move - kx) / size).ok; });
            if (top.length) return toMove(top[(rng() * top.length) | 0]);
          }
          return toMove(c);
        }
      }
      return { pass: true, winrate: 0.5 };
    }

    // 熱力圖／教練用：每個候選點的訪問數與勝率
    function analyze(top) {
      const list = ranked().filter((c) => c.move !== PASS);
      const maxV = list.length ? list[0].visits : 1;
      const out = list.map((c) => {
        const x = c.move % size, y = (c.move - x) / size;
        return { x, y, visits: c.visits, winrate: c.wins / c.visits, norm: c.visits / maxV };
      });
      return top ? out.slice(0, top) : out;
    }

    return {
      level, budgetMs, budgetSims,
      sims: () => sims,
      msUsed: () => msUsed,
      done: () => msUsed >= budgetMs || sims >= budgetSims,
      step: (sliceMs) => work(sliceMs || 30),
      runAll() { while (!work(1000)); return sims; },
      best, analyze,
    };
  }

  /* ---------- 對外 API（與 GomokuEngine 同形） ---------- */
  // 回傳 { x, y } 或 { pass: true }；對局已結束回傳 null
  function aiMove(game, opts) {
    if (game.phase !== 'play') return null;
    const s = createSearch(game, opts);
    s.runAll();
    return s.best();
  }

  // 提示：用「困難」的預算算一手建議
  function hints(game, opts) {
    const o = Object.assign({ level: 'hard' }, opts || {});
    return aiMove(game, o);
  }

  // 熱力圖：每點的相對價值（norm 0~1）
  function analyzeMoves(game, opts) {
    const o = opts || {};
    if (game.phase !== 'play') return [];
    const s = createSearch(game, { level: o.level || 'medium', ms: o.ms, sims: o.sims, seed: o.seed });
    s.runAll();
    return s.analyze(o.top);
  }

  return {
    AI_LEVELS, PASS,
    createSearch, aiMove, hints, analyzeMoves,
    // 內部零件（測試與任務 3 的死活判定要用）
    _internal: {
      makeBoard, clearBoard, copyBoard, setFromGame, isLegal, isTrueEye,
      playStone, playout, areaMargin, find, inAtari, atariPoint, makeRng, neighborTable,
      pickMove, tacticalCandidates, escapeIsUseful,
    },
  };
});
