/* 新手教學課程資料驗證：node tests/tutorial.test.js
 *
 * 這支測試不管文字寫得好不好，只管 tutorial-lessons.js 裡每一個「結構化的宣稱」
 * 是不是和真正的引擎（engine.js／go.js）一致：
 *   board.wins / winPoints / forbidden / allowed   → 五子棋引擎逐點重算，集合必須完全相等
 *   board.libs / captures / legal / illegal / score → 圍棋引擎逐點重算
 *   sequence                                        → 從盤面依序落子，每一步都必須合法
 *   then                                            → 走完 sequence 之後再驗一次同樣的宣稱
 *   finalStatus                                     → 走完之後的勝負／階段
 * 課程資料寫錯時，這裡會直接指出差在哪一點。
 */
const E = require('../engine.js');
const Go = require('../go.js');
const DATA = require('../tutorial-lessons.js');

const GAMES = {
  gomoku: { label: '五子棋', size: 15 },
  go: { label: '圍棋', size: 9 },
};

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL  ' + name); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const key = (x, y) => x + ',' + y;

/* ---------- 走訪 ---------- */
function eachLesson(cb) {
  Object.keys(GAMES).forEach((gid) => {
    (DATA[gid] || []).forEach((sec) => {
      (sec.lessons || []).forEach((l) => cb(gid, sec, l));
    });
  });
}

/* ---------- 建立局面 ---------- */
function boardSize(gid, spec) {
  return gid === 'gomoku' ? 15 : (spec && spec.size) || 9;
}

function build(gid, spec) {
  const s = spec || {};
  if (gid === 'gomoku') {
    const g = E.createGame({ renju: !!s.renju });
    (s.play || []).forEach(([x, y]) => {
      if (!E.place(g, x, y)) throw new Error(`play 落子失敗 (${x},${y})`);
    });
    (s.black || []).forEach(([x, y]) => { g.board[y][x] = E.BLACK; });
    (s.white || []).forEach(([x, y]) => { g.board[y][x] = E.WHITE; });
    g.current = s.turn === 'w' ? E.WHITE : E.BLACK;
    return g;
  }
  const g = Go.createGame({ size: s.size || 9 });
  (s.play || []).forEach(([x, y]) => {
    if (!Go.place(g, x, y)) throw new Error(`play 落子失敗 (${x},${y})`);
  });
  (s.black || []).forEach(([x, y]) => { g.board[y][x] = Go.BLACK; });
  (s.white || []).forEach(([x, y]) => { g.board[y][x] = Go.WHITE; });
  g.current = s.turn === 'w' ? Go.WHITE : Go.BLACK;
  return g;
}

/* ---------- 五子棋：某色所有「下一手立刻連五」的點 ---------- */
function fiveWinPoints(game, color) {
  const out = [];
  for (let y = 0; y < E.SIZE; y++) {
    for (let x = 0; x < E.SIZE; x++) {
      if (game.board[y][x] !== E.EMPTY) continue;
      game.board[y][x] = color;
      const line = E.findWinLine(game.board, x, y);
      game.board[y][x] = E.EMPTY;
      if (line) out.push({ x, y });
    }
  }
  return out;
}

/* ---------- claims 驗證（board 與 then 共用） ---------- */
function checkClaims(gid, game, claims, where) {
  if (!claims) return;
  const c = claims;

  if (gid === 'gomoku') {
    if (c.wins) {
      const got = fiveWinPoints(game, game.current).map((p) => key(p.x, p.y)).sort();
      const want = c.wins.map(([x, y]) => key(x, y)).sort();
      assert(got.join(' ') === want.join(' '),
        where + ' wins 完全相符（引擎算出 [' + got.join(' ') + ']，資料寫 [' + want.join(' ') + ']）');
    }
    if (c.winPoints) {
      Object.keys(c.winPoints).forEach((ck) => {
        const color = ck === 'w' ? E.WHITE : E.BLACK;
        const n = fiveWinPoints(game, color).length;
        assert(n === c.winPoints[ck],
          where + ' winPoints.' + ck + ' = ' + c.winPoints[ck] + '（引擎算出 ' + n + '）');
      });
    }
    (c.forbidden || []).forEach((f) => {
      const r = E.forbiddenReason(game.board, f.x, f.y);
      assert(r === f.reason,
        where + ' (' + f.x + ',' + f.y + ') 禁手原因為「' + f.reason + '」（引擎回傳「' + r + '」）');
      assert(isStr(f.why), where + ' (' + f.x + ',' + f.y + ') 禁手宣稱有寫 why');
    });
    (c.allowed || []).forEach((a) => {
      const r = E.forbiddenReason(game.board, a.x, a.y);
      assert(r === null, where + ' (' + a.x + ',' + a.y + ') 不是禁手（引擎回傳「' + r + '」）');
      assert(isStr(a.why), where + ' (' + a.x + ',' + a.y + ') allowed 宣稱有寫 why');
    });
    return;
  }

  // 圍棋
  (c.libs || []).forEach((l) => {
    const grp = game.board[l.y][l.x] ? Go.groupAt(game.board, game.size, l.x, l.y) : null;
    assert(grp && grp.libs.length === l.n,
      where + ' (' + l.x + ',' + l.y + ') 的棋塊有 ' + l.n + ' 口氣（引擎算出 ' +
      (grp ? grp.libs.length : '該點是空的') + '）');
    assert(isStr(l.why), where + ' (' + l.x + ',' + l.y + ') libs 宣稱有寫 why');
  });
  (c.captures || []).forEach((cp) => {
    const r = Go.legal(game, cp.x, cp.y);
    assert(r.ok && r.captures.length === cp.count,
      where + ' (' + cp.x + ',' + cp.y + ') 可提 ' + cp.count + ' 子（引擎：' +
      (r.ok ? r.captures.length + ' 子' : '不合法「' + r.reason + '」') + '）');
    assert(isStr(cp.why), where + ' (' + cp.x + ',' + cp.y + ') captures 宣稱有寫 why');
  });
  (c.legal || []).forEach((l) => {
    const r = Go.legal(game, l.x, l.y);
    assert(r.ok, where + ' (' + l.x + ',' + l.y + ') 合法（引擎：' + r.reason + '）');
    assert(isStr(l.why), where + ' (' + l.x + ',' + l.y + ') legal 宣稱有寫 why');
  });
  (c.illegal || []).forEach((l) => {
    const r = Go.legal(game, l.x, l.y);
    assert(!r.ok && r.reason.indexOf(l.reason) >= 0,
      where + ' (' + l.x + ',' + l.y + ') 不合法且原因含「' + l.reason + '」（引擎：' +
      (r.ok ? '判定為合法' : r.reason) + '）');
    assert(isStr(l.why), where + ' (' + l.x + ',' + l.y + ') illegal 宣稱有寫 why');
  });
  (c.score || []).forEach((sc, i) => {
    const dead = (sc.dead || []).map(([x, y]) => Go.xyToIdx(game.size, x, y));
    const r = Go.score(game, dead);
    const winner = r.winner === Go.BLACK ? 'b' : r.winner === Go.WHITE ? 'w' : 'draw';
    assert(r.black === sc.black, where + ' score[' + i + '] 黑 ' + sc.black + ' 目（引擎 ' + r.black + '）');
    assert(r.white === sc.white, where + ' score[' + i + '] 白 ' + sc.white + ' 目（引擎 ' + r.white + '）');
    assert(winner === sc.winner, where + ' score[' + i + '] 勝方 ' + sc.winner + '（引擎 ' + winner + '）');
    assert(isStr(sc.why), where + ' score[' + i + '] 有寫 why');
  });
  if (c.phase) {
    assert(game.phase === c.phase, where + ' phase = ' + c.phase + '（引擎 ' + game.phase + '）');
  }
}

/* ==================== 0. 頂層結構 ==================== */
section('0. 頂層結構');
Object.keys(GAMES).forEach((gid) => {
  assert(Array.isArray(DATA[gid]) && DATA[gid].length > 0, GAMES[gid].label + ' 有章節資料');
});
assert(Object.keys(DATA).sort().join(',') === 'go,gomoku', '只包含 gomoku 與 go 兩個棋種');

/* ==================== 1. id 唯一與必填欄位 ==================== */
section('1. id 唯一與必填欄位');
(function () {
  const seen = {};
  const dup = [];
  function claim(id, where) {
    if (!isStr(id)) { failed++; console.error('  FAIL  ' + where + ' 缺少 id'); return; }
    if (seen[id]) dup.push(id);
    seen[id] = where;
  }
  Object.keys(GAMES).forEach((gid) => {
    (DATA[gid] || []).forEach((sec) => {
      claim(sec.id, gid + ' 章節「' + sec.title + '」');
      assert(isStr(sec.title), gid + ' 章節 ' + sec.id + ' 有標題');
      assert(Array.isArray(sec.lessons) && sec.lessons.length > 0, gid + ' 章節 ' + sec.id + ' 有課程');
      (sec.lessons || []).forEach((l) => claim(l.id, gid + ' 課程「' + l.title + '」'));
    });
  });
  assert(dup.length === 0, 'id 全域唯一（重複：' + dup.join(', ') + '）');
})();

eachLesson((gid, sec, l) => {
  const w = gid + '/' + l.id;
  assert(isStr(l.title), w + ' 有 title');
  assert(isStr(l.summary), w + ' 有 summary');
  assert(Array.isArray(l.paras) && l.paras.length > 0 && l.paras.every(isStr), w + ' 有非空 paras');
  assert(!l.tips || (Array.isArray(l.tips) && l.tips.every(isStr)), w + ' tips 皆為非空字串');
});

/* ==================== 2. 座標都在盤內、棋子不重疊 ==================== */
section('2. 座標與擺盤');
eachLesson((gid, sec, l) => {
  const s = l.board;
  if (!s) return;
  const w = gid + '/' + l.id;
  const n = boardSize(gid, s);
  const bad = [];
  const occupied = {};
  const pts = [].concat(s.black || [], s.white || [], s.play || []);
  pts.forEach(([x, y]) => {
    if (!(x >= 0 && x < n && y >= 0 && y < n)) bad.push(key(x, y));
    if (occupied[key(x, y)]) bad.push('重複 ' + key(x, y));
    occupied[key(x, y)] = 1;
  });
  assert(bad.length === 0, w + ' 擺盤座標合法且不重疊（' + bad.join(' ') + '）');

  if (s.view) {
    const [x0, y0, x1, y1] = s.view;
    assert(x0 >= 0 && y0 >= 0 && x1 < n && y1 < n && x1 > x0 && y1 > y0, w + ' view 範圍合法');
    const outside = pts.filter(([x, y]) => x < x0 || x > x1 || y < y0 || y > y1).map(([x, y]) => key(x, y));
    assert(outside.length === 0, w + ' 所有棋子都在 view 範圍內（超出：' + outside.join(' ') + '）');
    const seqOut = (l.sequence || []).filter((m) => !m.pass &&
      (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1)).map((m) => key(m.x, m.y));
    assert(seqOut.length === 0, w + ' sequence 的落點都在 view 內（超出：' + seqOut.join(' ') + '）');
  }
  if (gid === 'go' && s.size !== undefined) {
    assert(Go.SIZES.indexOf(s.size) >= 0, w + ' 圍棋盤面大小是 9／13／19');
  }
  if (gid === 'gomoku') {
    assert(s.size === undefined, w + ' 五子棋不需要指定 size（固定 15）');
    (s.forbidden || []).forEach(() => {
      assert(s.renju === true, w + ' 有禁手宣稱時必須 renju: true');
    });
  }
});

/* ==================== 3. 盤面宣稱（board.claims） ==================== */
section('3. 盤面宣稱');
eachLesson((gid, sec, l) => {
  if (!l.board) return;
  const w = gid + '/' + l.id;
  let g;
  try { g = build(gid, l.board); } catch (err) {
    assert(false, w + ' 局面建得起來（' + err.message + '）');
    return;
  }
  assert(true, w + ' 局面建得起來');
  checkClaims(gid, g, l.board, w);
});

/* ==================== 4. sequence 每一步都合法 ==================== */
section('4. sequence 與 then');
eachLesson((gid, sec, l) => {
  if (!Array.isArray(l.sequence) || !l.sequence.length) {
    assert(!l.then, gid + '/' + l.id + ' 沒有 sequence 就不該有 then');
    assert(!l.finalStatus, gid + '/' + l.id + ' 沒有 sequence 就不該有 finalStatus');
    return;
  }
  const w = gid + '/' + l.id;
  assert(!!l.board, w + ' 有 sequence 就必須有 board');
  let g;
  try { g = build(gid, l.board); } catch (err) {
    assert(false, w + ' 局面建得起來（' + err.message + '）');
    return;
  }
  let ok = true;
  l.sequence.forEach((m, i) => {
    assert(isStr(m.note), w + ' 第 ' + (i + 1) + ' 步有 note');
    if (!ok) return;
    let done;
    if (m.pass) {
      assert(gid === 'go', w + ' 第 ' + (i + 1) + ' 步：只有圍棋能虛手');
      done = gid === 'go' && Go.pass(g);
    } else if (gid === 'gomoku') {
      done = E.place(g, m.x, m.y);
    } else {
      done = Go.place(g, m.x, m.y);
    }
    assert(done, w + ' 第 ' + (i + 1) + ' 步 ' +
      (m.pass ? '虛手' : '(' + m.x + ',' + m.y + ')') + ' 引擎判定合法');
    if (!done) ok = false;
  });
  if (!ok) return;

  if (l.then) checkClaims(gid, g, l.then, w + ' [then]');

  if (l.finalStatus) {
    const fs = l.finalStatus;
    if (fs.winner) {
      const got = gid === 'gomoku'
        ? (g.winner === E.BLACK ? 'b' : g.winner === E.WHITE ? 'w' : g.winner === -1 ? 'draw' : 'none')
        : (g.winner === Go.BLACK ? 'b' : g.winner === Go.WHITE ? 'w' : g.winner === -1 ? 'draw' : 'none');
      assert(got === fs.winner, w + ' 走完之後 ' + fs.winner + ' 獲勝（引擎：' + got + '）');
    }
    if (fs.phase) {
      assert(gid === 'go' && g.phase === fs.phase, w + ' 走完之後 phase = ' + fs.phase);
    }
  }
});

/* ==================== 5. 文字標記沒有寫壞 ==================== */
section('5. 課文標記');
eachLesson((gid, sec, l) => {
  const w = gid + '/' + l.id;
  const texts = [].concat(l.paras || [], l.tips || [], l.summary || [],
    (l.sequence || []).map((m) => m.note || ''),
    (l.board && l.board.caption) ? [l.board.caption] : []);
  const badMark = texts.filter((t) => {
    const stars = (t.match(/\*\*/g) || []).length;
    const bangs = (t.match(/!!/g) || []).length;
    const ticks = (t.match(/`/g) || []).length;
    return stars % 2 || bangs % 2 || ticks % 2;
  });
  assert(badMark.length === 0, w + ' 課文標記成對（未成對：' + badMark.join(' ｜ ') + '）');
});

/* ==================== 收尾 ==================== */
console.log('\n通過 ' + passed + ' 項，失敗 ' + failed + ' 項');
process.exit(failed ? 1 : 0);
