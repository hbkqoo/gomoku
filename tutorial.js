/* ==================================================================
 * 教學頁：把 tutorial-lessons.js 的資料渲染成可互動的課程。
 *
 * 核心原則：這一頁不自己判斷規則。
 *   - 「這裡能不能下」一律問引擎（GomokuEngine.place／forbiddenReason、GoEngine.legal）
 *   - 「這塊有幾口氣」一律問 GoEngine.groupAt
 *   - 「下這裡會不會贏」一律用 GomokuEngine.findWinLine
 * 所以教學上標出來的東西，必定與實際下棋時一致；課程資料寫錯的話，
 * tests/tutorial.test.js 會先擋下來（它用同一套引擎逐條驗證）。
 *
 * 渲染完全由資料驅動：章節數、課程數、id 都不寫死，缺少選填欄位也不會壞掉。
 * ================================================================== */
(function () {
  'use strict';

  const E = window.GomokuEngine;
  const Go = window.GoEngine;
  const DATA = window.TutorialLessons || {};

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------- 課文的重點標記 ----------
   * 一律【先跳脫再轉標記】：跳脫後的字串只會多出 &amp; 這類實體，不會產生
   * 星號、驚嘆號或反引號，所以標記不可能誤傷使用者文字、也不可能被注入 HTML。 */
  function rich(s) {
    return esc(s)
      .replace(/`([^`\n]+)`/g, '<code class="sqref">$1</code>')
      .replace(/!!([^!\n]+)!!/g, '<b class="danger">$1</b>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b class="kw">$1</b>');
  }

  /* ==================================================================
   * 棋種設定
   * ================================================================== */
  const GO_LETTERS = 'ABCDEFGHJKLMNOPQRST';   // 圍棋習慣跳過 I
  const GM_LETTERS = 'ABCDEFGHIJKLMNO';

  const GAMES = {
    gomoku: {
      label: '五子棋',
      engine: () => E,
      size: () => 15,
      colorName: { 1: '黑棋', 2: '白棋' },
      // 五子棋座標：A–O 由左至右，1–15 由上至下
      coord: (size, x, y) => GM_LETTERS[x] + (y + 1),
      colLabel: (size, x) => GM_LETTERS[x],
      rowLabel: (size, y) => String(y + 1),
      stars: () => [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]],
    },
    go: {
      label: '圍棋',
      engine: () => Go,
      size: (spec) => (spec && spec.size) || 9,
      colorName: { 1: '黑棋', 2: '白棋' },
      // 圍棋座標：字母跳過 I，數字由下往上
      coord: (size, x, y) => GO_LETTERS[x] + (size - y),
      colLabel: (size, x) => GO_LETTERS[x],
      rowLabel: (size, y) => String(size - y),
      stars: (size) => (Go ? Go.starPoints(size) : []),
    },
  };
  const GAME_IDS = Object.keys(GAMES).filter((id) => GAMES[id].engine());

  /* ==================================================================
   * 從課程資料建立局面（與 tests/tutorial.test.js 用同一套規則）
   * ================================================================== */
  function build(gid, spec) {
    const s = spec || {};
    if (gid === 'gomoku') {
      const g = E.createGame({ renju: !!s.renju });
      (s.play || []).forEach(([x, y]) => E.place(g, x, y));
      (s.black || []).forEach(([x, y]) => { g.board[y][x] = E.BLACK; });
      (s.white || []).forEach(([x, y]) => { g.board[y][x] = E.WHITE; });
      g.current = s.turn === 'w' ? E.WHITE : E.BLACK;
      return g;
    }
    const g = Go.createGame({ size: s.size || 9 });
    (s.play || []).forEach(([x, y]) => Go.place(g, x, y));
    (s.black || []).forEach(([x, y]) => { g.board[y][x] = Go.BLACK; });
    (s.white || []).forEach(([x, y]) => { g.board[y][x] = Go.WHITE; });
    g.current = s.turn === 'w' ? Go.WHITE : Go.BLACK;
    return g;
  }

  /* ---------- 由 claims 產生盤面標記 ---------- */
  function marksFromClaims(gid, game, claims) {
    const out = [];
    if (!claims) return out;
    if (gid === 'gomoku') {
      (claims.wins || []).forEach(([x, y]) => out.push({ x, y, kind: 'win' }));
      (claims.forbidden || []).forEach((f) => out.push({ x: f.x, y: f.y, kind: 'no' }));
      (claims.allowed || []).forEach((a) => out.push({ x: a.x, y: a.y, kind: 'ok' }));
      return out;
    }
    (claims.captures || []).forEach((c) => out.push({ x: c.x, y: c.y, kind: 'ok' }));
    (claims.legal || []).forEach((l) => {
      if (!out.some((m) => m.x === l.x && m.y === l.y)) out.push({ x: l.x, y: l.y, kind: 'ok' });
    });
    (claims.illegal || []).forEach((l) => out.push({ x: l.x, y: l.y, kind: 'no' }));
    (claims.libs || []).forEach((l) => {
      if (!game.board[l.y][l.x]) return;
      const grp = Go.groupAt(game.board, game.size, l.x, l.y);
      grp.libs.forEach((p) => {
        const c = Go.idxToXY(game.size, p);
        out.push({ x: c.x, y: c.y, kind: 'lib' });
      });
    });
    return out;
  }

  /* ==================================================================
   * MiniBoard：一課一個小棋盤
   * ================================================================== */
  let uidSeq = 0;

  function MiniBoard(gid, lesson, host) {
    const uid = ++uidSeq;              // 每個小棋盤的漸層 id 必須各自獨立
    const G = GAMES[gid];
    const spec = lesson.board;
    const seq = Array.isArray(lesson.sequence) ? lesson.sequence : [];
    const size = G.size(spec);
    const view = spec.view || [0, 0, size - 1, size - 1];
    const canInteract = spec.interactive !== false;

    const boardEl = host.querySelector('[data-role="board"]');
    const hintEl = host.querySelector('[data-role="hint"]');
    const seqEl = host.querySelector('[data-role="seqnote"]');

    let game = null;
    let step = 0;             // 已走完 sequence 的前幾步
    let played = [];          // 依序落下的座標（用來標手數）
    let extra = [];           // 使用者自己試下的標記
    let userMarks = [];       // 點選棋塊時顯示的氣
    let playTimer = null;
    let broken = '';

    const self = { stop() { clearTimeout(playTimer); playTimer = null; } };

    function rebuild(n) {
      self.stop();
      broken = '';
      played = [];
      extra = [];
      userMarks = [];
      try { game = build(gid, spec); } catch (err) {
        game = null;
        broken = '這一課的示範局面建不起來：' + (err && err.message ? err.message : String(err));
        return;
      }
      for (let i = 0; i < n; i++) {
        const m = seq[i] || {};
        let ok;
        if (m.pass) ok = gid === 'go' ? Go.pass(game) : false;
        else ok = gid === 'gomoku' ? E.place(game, m.x, m.y) : Go.place(game, m.x, m.y);
        if (!ok) { broken = '第 ' + (i + 1) + ' 步引擎判定不合法，示範停在這裡'; step = i; return; }
        played.push(m.pass ? null : { x: m.x, y: m.y });
      }
      step = n;
    }

    /* ---------- 目前該顯示哪些標記 ---------- */
    function currentMarks() {
      if (!game) return [];
      let claims = null;
      if (step === 0) claims = spec;
      else if (step === seq.length && lesson.then) claims = lesson.then;
      return marksFromClaims(gid, game, claims).concat(userMarks);
    }

    /* ---------- 畫盤 ---------- */
    function render() {
      if (!game) {
        boardEl.innerHTML = '';
        if (hintEl) hintEl.innerHTML = '<span class="bad">' + esc(broken || '局面無法載入') + '</span>';
        return;
      }
      boardEl.innerHTML = svg();
      renderHint();
    }

    const U = 40, PAD = 34;
    const [vx0, vy0, vx1, vy1] = view;
    const cx = (x) => PAD + (x - vx0) * U;
    const cy = (y) => PAD + (y - vy0) * U;
    const W = PAD * 2 + (vx1 - vx0) * U;
    const H = PAD * 2 + (vy1 - vy0) * U;

    function svg() {
      const parts = [];
      parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" class="mini-svg" ' +
        'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' +
        esc(G.label + '示範盤面') + '">');
      parts.push('<defs>' +
        '<radialGradient id="ts-b-' + uid + '" cx="35%" cy="30%" r="80%">' +
        '<stop offset="0%" stop-color="#6a6a72"/><stop offset="45%" stop-color="#26262c"/>' +
        '<stop offset="100%" stop-color="#050507"/></radialGradient>' +
        '<radialGradient id="ts-w-' + uid + '" cx="35%" cy="30%" r="80%">' +
        '<stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#e8e6df"/>' +
        '<stop offset="100%" stop-color="#b5b0a3"/></radialGradient></defs>');
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="8" fill="#d9b071"/>');

      // 格線：盤面真正的邊界收在交叉點上，被裁切的那一側畫到底，表示「還有後續」
      const lx0 = vx0 === 0 ? cx(vx0) : 4;
      const lx1 = vx1 === size - 1 ? cx(vx1) : W - 4;
      const ly0 = vy0 === 0 ? cy(vy0) : 4;
      const ly1 = vy1 === size - 1 ? cy(vy1) : H - 4;
      for (let y = vy0; y <= vy1; y++) {
        parts.push('<line x1="' + lx0 + '" y1="' + cy(y) + '" x2="' + lx1 + '" y2="' + cy(y) +
          '" stroke="#4a3418" stroke-width="1.4"/>');
      }
      for (let x = vx0; x <= vx1; x++) {
        parts.push('<line x1="' + cx(x) + '" y1="' + ly0 + '" x2="' + cx(x) + '" y2="' + ly1 +
          '" stroke="#4a3418" stroke-width="1.4"/>');
      }

      // 星位
      G.stars(size).forEach(([x, y]) => {
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;
        parts.push('<circle cx="' + cx(x) + '" cy="' + cy(y) + '" r="4" fill="#4a3418"/>');
      });

      // 座標
      for (let x = vx0; x <= vx1; x++) {
        parts.push('<text x="' + cx(x) + '" y="' + (PAD - 14) + '" class="co">' +
          esc(G.colLabel(size, x)) + '</text>');
      }
      for (let y = vy0; y <= vy1; y++) {
        parts.push('<text x="' + (PAD - 16) + '" y="' + (cy(y) + 5) + '" class="co">' +
          esc(G.rowLabel(size, y)) + '</text>');
      }

      // 標記（畫在棋子底下，才不會蓋住手數）
      const marks = currentMarks();
      marks.forEach((m) => {
        if (m.x < vx0 || m.x > vx1 || m.y < vy0 || m.y > vy1) return;
        const px = cx(m.x), py = cy(m.y);
        if (m.kind === 'win') {
          parts.push('<circle cx="' + px + '" cy="' + py + '" r="14" fill="none" ' +
            'stroke="#f0c24a" stroke-width="4"/>');
        } else if (m.kind === 'ok') {
          parts.push('<circle cx="' + px + '" cy="' + py + '" r="12" fill="none" ' +
            'stroke="#57c97e" stroke-width="4"/>');
        } else if (m.kind === 'lib') {
          parts.push('<circle cx="' + px + '" cy="' + py + '" r="6" fill="#2f9e5a"/>');
        } else if (m.kind === 'no') {
          const r = 12;
          parts.push('<line x1="' + (px - r) + '" y1="' + (py - r) + '" x2="' + (px + r) +
            '" y2="' + (py + r) + '" stroke="#e0483a" stroke-width="5" stroke-linecap="round"/>' +
            '<line x1="' + (px + r) + '" y1="' + (py - r) + '" x2="' + (px - r) +
            '" y2="' + (py + r) + '" stroke="#e0483a" stroke-width="5" stroke-linecap="round"/>');
        }
      });

      // 棋子
      const numbers = {};
      played.forEach((p, i) => { if (p) numbers[p.x + ',' + p.y] = i + 1; });
      const board = game.board;
      const R = 18;
      for (let y = vy0; y <= vy1; y++) {
        for (let x = vx0; x <= vx1; x++) {
          const v = board[y][x];
          if (!v) continue;
          const px = cx(x), py = cy(y);
          parts.push('<circle cx="' + px + '" cy="' + py + '" r="' + R + '" fill="url(#ts-' +
            (v === 1 ? 'b' : 'w') + '-' + uid + ')" stroke="rgba(0,0,0,.35)" stroke-width="1"/>');
          const n = numbers[x + ',' + y];
          if (n) {
            parts.push('<text x="' + px + '" y="' + (py + 6) + '" class="mv" fill="' +
              (v === 1 ? '#f4f2ec' : '#1b1b20') + '">' + n + '</text>');
          }
        }
      }

      // 五子棋的獲勝連線
      if (gid === 'gomoku' && game.winLine && game.winLine.length) {
        const a = game.winLine[0], b = game.winLine[game.winLine.length - 1];
        parts.push('<line x1="' + cx(a.x) + '" y1="' + cy(a.y) + '" x2="' + cx(b.x) + '" y2="' +
          cy(b.y) + '" stroke="#ff4d4d" stroke-width="5" stroke-linecap="round" opacity=".85"/>');
      }

      // 點擊熱區（放最上層）
      if (canInteract) {
        for (let y = vy0; y <= vy1; y++) {
          for (let x = vx0; x <= vx1; x++) {
            parts.push('<rect class="pt" x="' + (cx(x) - U / 2) + '" y="' + (cy(y) - U / 2) +
              '" width="' + U + '" height="' + U + '" fill="transparent" data-x="' + x +
              '" data-y="' + y + '"/>');
          }
        }
      }
      parts.push('</svg>');
      return parts.join('');
    }

    /* ---------- 說明列 ---------- */
    function claimNotes() {
      const c = step === 0 ? spec : (step === seq.length ? lesson.then : null);
      if (!c) return '';
      const rows = [];
      const at = (x, y) => '<code class="sqref">' + esc(G.coord(size, x, y)) + '</code>';
      (c.forbidden || []).forEach((f) => rows.push(
        '<span class="mk mk-no"></span>' + at(f.x, f.y) + '：' + rich(f.why || '禁手')));
      (c.allowed || []).forEach((a) => rows.push(
        '<span class="mk mk-ok"></span>' + at(a.x, a.y) + '：' + rich(a.why || '可以下')));
      (c.illegal || []).forEach((l) => rows.push(
        '<span class="mk mk-no"></span>' + at(l.x, l.y) + '：' + rich(l.why || '不能下')));
      (c.captures || []).forEach((cp) => rows.push(
        '<span class="mk mk-ok"></span>' + at(cp.x, cp.y) + '：' + rich(cp.why || '可以提子')));
      (c.legal || []).forEach((l) => {
        if ((c.captures || []).some((cp) => cp.x === l.x && cp.y === l.y)) return;
        rows.push('<span class="mk mk-ok"></span>' + at(l.x, l.y) + '：' + rich(l.why || '可以下'));
      });
      (c.libs || []).forEach((l) => rows.push(
        '<span class="mk mk-lib"></span>' + at(l.x, l.y) + ' 這塊有 <b class="good">' + l.n +
        '</b> 口氣：' + rich(l.why || '')));
      if (c.wins && c.wins.length) {
        rows.push('<span class="mk mk-win"></span>' +
          c.wins.map(([x, y]) => at(x, y)).join('、') + '：下這裡就連成五顆，' +
          esc(G.colorName[game.current]) + '獲勝');
      }
      if (c.winPoints) {
        Object.keys(c.winPoints).forEach((ck) => {
          const nm = ck === 'w' ? '白棋' : '黑棋';
          rows.push('<span class="mk mk-win"></span>' + nm + '目前有 <b class="good">' +
            c.winPoints[ck] + '</b> 個「下一手就連五」的點');
        });
      }
      (c.score || []).forEach((sc) => {
        const r = Go.score(game, (sc.dead || []).map(([x, y]) => Go.xyToIdx(size, x, y)));
        rows.push('<span class="mk mk-lib"></span>黑 <b class="good">' + r.black +
          '</b>　白 <b class="good">' + r.white + '</b>（含貼目 ' + r.komi + '）→ <b>' +
          esc(r.winner === 1 ? '黑棋勝' : r.winner === 2 ? '白棋勝' : '和局') + '</b>：' +
          rich(sc.why || ''));
      });
      return rows.length ? '<div class="claims">' + rows.map((r) => '<div>' + r + '</div>').join('') + '</div>' : '';
    }

    function renderHint() {
      if (!hintEl) return;
      if (broken) { hintEl.innerHTML = '<span class="bad">' + esc(broken) + '</span>'; return; }
      const head = extra.length
        ? extra[extra.length - 1]
        : (canInteract
          ? '輪到<b>' + esc(G.colorName[game.current]) + '</b>。點盤上的交叉點，引擎會真的判斷這一手能不能下。'
          : '這個局面用來對照說明。');
      hintEl.innerHTML = '<div class="hint-line">' + head + '</div>' + claimNotes();
    }

    /* ---------- 使用者自己試下 ---------- */
    function onClick(e) {
      const el = e.target.closest('.pt');
      if (!el || !game || !canInteract) return;
      const x = parseInt(el.dataset.x, 10);
      const y = parseInt(el.dataset.y, 10);
      const at = '<code class="sqref">' + esc(G.coord(size, x, y)) + '</code>';
      userMarks = [];

      if (gid === 'gomoku') {
        if (game.winner) {
          extra = ['這一局已經結束了，按「重設」再來一次。'];
          render(); return;
        }
        if (game.board[y][x]) {
          extra = [at + ' 已經有棋子了——下過的子不會移動，也不能疊。'];
          render(); return;
        }
        const me = G.colorName[game.current];
        const reason = game.renju && game.current === E.BLACK
          ? E.forbiddenReason(game.board, x, y) : null;
        if (reason) {
          extra = ['<span class="bad">' + at + ' 是<b>' + esc(reason) +
            '</b>禁手</span>：連珠規則下黑棋不能這樣下（下了判負），引擎直接擋住。'];
          render(); return;
        }
        E.place(game, x, y);
        if (game.winner === E.BLACK || game.winner === E.WHITE) {
          extra = ['<span class="good">' + esc(me) + '下在 ' + at +
            '，五顆連成一線——' + esc(me) + '獲勝！</span>'];
        } else if (game.winner === -1) {
          extra = ['盤面下滿了，和局。'];
        } else {
          extra = [esc(me) + '下在 ' + at + '，換' + esc(G.colorName[game.current]) + '。'];
        }
        render(); return;
      }

      // 圍棋
      if (game.board[y][x]) {
        const grp = Go.groupAt(game.board, size, x, y);
        userMarks = grp.libs.map((p) => {
          const c = Go.idxToXY(size, p);
          return { x: c.x, y: c.y, kind: 'lib' };
        });
        extra = [at + ' 這塊是 <b>' + esc(G.colorName[grp.color]) + '</b>，共 ' + grp.stones.length +
          ' 顆，還有 <b class="good">' + grp.libs.length + '</b> 口氣（綠點）。' +
          (grp.libs.length === 1 ? '<span class="bad">只剩一口氣＝被叫吃！</span>' : '')];
        render(); return;
      }
      const me = G.colorName[game.current];
      const r = Go.legal(game, x, y);
      if (!r.ok) {
        extra = ['<span class="bad">' + at + ' 不能下</span>：' + esc(r.reason) + '。'];
        render(); return;
      }
      Go.place(game, x, y);
      const grp = Go.groupAt(game.board, size, x, y);
      extra = [esc(me) + '下在 ' + at +
        (r.captures.length ? '，<span class="good">提掉 ' + r.captures.length + ' 顆</span>' : '') +
        '；這塊現在有 <b class="good">' + grp.libs.length + '</b> 口氣。'];
      render();
    }

    /* ---------- sequence 導覽 ---------- */
    function goto(n) {
      self.stop();
      rebuild(Math.max(0, Math.min(n, seq.length)));
      render();
      renderSeq();
    }

    function renderSeq() {
      if (!seqEl) return;
      if (broken) { seqEl.innerHTML = '<span class="bad">' + esc(broken) + '</span>'; return; }
      const head = '<span class="step-no">' + step + '/' + seq.length + '</span>';
      if (step === 0) {
        seqEl.innerHTML = head + '尚未開始，按「播放示範」看這幾步怎麼走。';
        return;
      }
      const m = seq[step - 1] || {};
      const where = m.pass
        ? '虛手'
        : '<code class="sqref">' + esc(G.coord(size, m.x, m.y)) + '</code>';
      let tail = '';
      if (step === seq.length) {
        if (gid === 'gomoku' && game && game.winner > 0) {
          tail = '　<span class="good">▷ ' + esc(G.colorName[game.winner]) + '獲勝</span>';
        } else if (gid === 'go' && game && game.phase === 'scoring') {
          tail = '　<span class="good">▷ 進入結算</span>';
        }
      }
      seqEl.innerHTML = head + where + '　' + rich(m.note || '') + tail;
    }

    function play() {
      self.stop();
      if (!seq.length) return;
      if (step >= seq.length) goto(0);
      const tick = () => {
        if (step >= seq.length) { playTimer = null; return; }
        goto(step + 1);
        playTimer = setTimeout(tick, 950);
      };
      playTimer = setTimeout(tick, 260);
    }

    /* ---------- 綁事件 ---------- */
    if (canInteract) {
      boardEl.classList.add('interactive');
      boardEl.addEventListener('click', onClick);
    }
    host.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.act;
        if (a === 'reset') goto(0);
        else if (a === 'play') play();
        else if (a === 'prev') goto(step - 1);
        else if (a === 'next') goto(step + 1);
      });
    });

    goto(0);
    return self;
  }

  /* ==================================================================
   * HTML 組裝
   * ================================================================== */
  function lessonHtml(gid, lesson) {
    const paras = Array.isArray(lesson.paras) ? lesson.paras : [];
    const tips = Array.isArray(lesson.tips) ? lesson.tips : [];
    const spec = lesson.board && typeof lesson.board === 'object' ? lesson.board : null;
    const seq = Array.isArray(lesson.sequence) ? lesson.sequence : [];

    const textCol =
      paras.map((p) => '<p>' + rich(p) + '</p>').join('') +
      (tips.length
        ? '<div class="tut-tips"><div class="tips-label">新手提醒</div><ul>' +
          tips.map((t) => '<li>' + rich(t) + '</li>').join('') + '</ul></div>'
        : '');

    let boardCol = '';
    if (spec) {
      const tools = ['<button data-act="reset">⟲ 重設</button>'];
      if (seq.length) {
        tools.push('<button data-act="play">▶ 播放示範</button>');
        tools.push('<button data-act="prev">◀ 上一步</button>');
        tools.push('<button data-act="next">下一步 ▶</button>');
      }
      boardCol =
        '<div class="lesson-board" data-board="1">' +
        '<div class="mini-wrap" data-role="board"></div>' +
        (spec.caption ? '<div class="board-caption">' + rich(spec.caption) + '</div>' : '') +
        (seq.length ? '<div class="seq-note" data-role="seqnote"></div>' : '') +
        '<div class="board-hint" data-role="hint"></div>' +
        '<div class="board-tools">' + tools.join('') + '</div>' +
        '</div>';
    }

    return '<article class="tut-lesson" id="l-' + esc(lesson.id) + '">' +
      '<div><h3>' + esc(lesson.title || '（未命名課程）') + '</h3>' +
      (lesson.summary ? '<div class="lesson-summary">' + rich(lesson.summary) + '</div>' : '') + '</div>' +
      '<div class="lesson-main"><div class="lesson-text">' + textCol + '</div>' + boardCol + '</div>' +
      '</article>';
  }

  function sectionsOf(gid) {
    const raw = DATA[gid];
    return Array.isArray(raw) ? raw.filter((s) => s && typeof s === 'object') : [];
  }

  let currentGame = GAME_IDS[0];
  let liveBoards = [];

  function renderTab(gid) {
    liveBoards.forEach((b) => b.stop());
    liveBoards = [];
    currentGame = gid;

    const G = GAMES[gid];
    document.title = '新手教學・' + G.label;
    [...$('tut-tabs').children].forEach((b) => {
      const on = b.dataset.game === gid;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const sections = sectionsOf(gid);
    const toc = $('tut-toc');
    const content = $('tut-content');

    if (!sections.length) {
      toc.innerHTML = '<div class="toc-empty">尚無課程</div>';
      content.innerHTML = '<div class="tut-empty">' + esc(G.label) + '的課程還沒寫好。</div>';
      return;
    }

    toc.innerHTML = sections.map((sec) => {
      const lessons = Array.isArray(sec.lessons) ? sec.lessons : [];
      return '<div class="toc-section">' + esc(sec.title || '') + '</div>' +
        lessons.map((l) => l && l.id
          ? '<a href="#l-' + esc(l.id) + '">' + esc(l.title || '') + '</a>' : '').join('');
    }).join('');

    content.innerHTML = sections.map((sec) => {
      const lessons = Array.isArray(sec.lessons) ? sec.lessons : [];
      return '<section class="tut-section"><h2 id="s-' + esc(sec.id || '') + '">' +
        esc(sec.title || '') + '</h2>' +
        lessons.map((l) => (l && typeof l === 'object' ? lessonHtml(gid, l) : '')).join('') +
        '</section>';
    }).join('');

    // 課程 HTML 進 DOM 之後才建立小棋盤
    sections.forEach((sec) => {
      (Array.isArray(sec.lessons) ? sec.lessons : []).forEach((l) => {
        if (!l || !l.id || !l.board) return;
        const host = findHost(content, l.id);
        if (!host) return;
        try {
          liveBoards.push(MiniBoard(gid, l, host));
        } catch (err) {
          host.innerHTML = '<div class="board-hint"><span class="bad">棋盤建立失敗：' +
            esc(err && err.message ? err.message : String(err)) + '</span></div>';
        }
      });
    });
  }

  // 課程 id 可能含 CSS 選擇器不接受的字元，所以不用 querySelector 拼 id
  function findHost(root, id) {
    const all = root.querySelectorAll('.tut-lesson');
    for (let i = 0; i < all.length; i++) {
      if (all[i].id === 'l-' + id) return all[i].querySelector('[data-board]');
    }
    return null;
  }

  /* ---------- 分頁 ---------- */
  function buildTabs() {
    $('tut-tabs').innerHTML = GAME_IDS.map((id) =>
      '<button role="tab" data-game="' + esc(id) + '" aria-selected="false">' +
      esc(GAMES[id].label) + '</button>').join('');
    $('tut-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-game]');
      if (!btn || btn.dataset.game === currentGame) return;
      renderTab(btn.dataset.game);
      window.scrollTo(0, 0);
    });
  }

  if (!GAME_IDS.length) {
    $('tut-content').innerHTML = '<div class="tut-empty">引擎沒有載入，教學無法運作。</div>';
    return;
  }
  buildTabs();
  const want = (location.search.match(/[?&]game=([^&]+)/) || [])[1];
  const initial = (want && GAMES[want] && GAME_IDS.indexOf(want) >= 0) ? want
    : (GAME_IDS.find((id) => sectionsOf(id).length) || GAME_IDS[0]);
  renderTab(initial);

  // 直接帶 #l-xxx 進來時，內容是 JS 生成的，瀏覽器的自動捲動已經來不及，補跳一次
  if (location.hash) {
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView();
  }
})();
