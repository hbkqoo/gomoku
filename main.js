/* 3D 五子棋：SVG 透視渲染 + 第一人稱視角 + UI */
(function () {
  'use strict';
  const E = GomokuEngine;
  const SIZE = E.SIZE, HALF = (SIZE - 1) / 2;
  const BOARD_HALF = HALF + 1;          // 棋盤板面半寬
  const SLAB_H = 0.6;                   // 棋盤厚度
  const STONE_R = 0.42, STONE_H = 0.24; // 棋子半徑 / 球心高度

  const svg = document.getElementById('scene');
  const layers = {
    bg: document.getElementById('layer-bg'),
    board: document.getElementById('layer-board'),
    stones: document.getElementById('layer-stones'),
    fx: document.getElementById('layer-fx'),
  };
  const statusEl = document.getElementById('status');

  /* ---------- 相機（第一人稱：坐在棋桌旁環顧） ---------- */
  const cam = { yaw: 0, pitch: 0.52, dist: 13.5 };
  let W = 0, H = 0, F = 0, CX = 0, CY = 0;

  function resize() {
    W = svg.clientWidth; H = svg.clientHeight;
    F = Math.min(W, H) * 0.78;
    CX = W / 2; CY = H * 0.5;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    render();
  }

  let camPos, sy_, cy_, sp_, cp_;
  function updateCam() {
    sy_ = Math.sin(cam.yaw); cy_ = Math.cos(cam.yaw);
    sp_ = Math.sin(cam.pitch); cp_ = Math.cos(cam.pitch);
    camPos = {
      x: cam.dist * cp_ * sy_,
      y: cam.dist * sp_,
      z: cam.dist * cp_ * cy_,
    };
  }

  // 世界座標 → 視空間；d 為深度
  const NEAR = 0.25;
  function toView(wx, wy, wz) {
    let x = wx - camPos.x, y = wy - camPos.y, z = wz - camPos.z;
    const x1 = x * cy_ - z * sy_;
    const z1 = x * sy_ + z * cy_;
    const y2 = y * cp_ - z1 * sp_;
    const z2 = y * sp_ + z1 * cp_;
    return { x: x1, y: y2, d: -z2 };
  }
  function viewToScreen(v) {
    return { x: CX + F * v.x / v.d, y: CY - F * v.y / v.d, d: v.d };
  }
  function project(wx, wy, wz) {
    const v = toView(wx, wy, wz);
    return v.d < NEAR ? null : viewToScreen(v);
  }

  // 視空間多邊形對近平面裁剪（Sutherland–Hodgman）
  function clipPoly(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ain = a.d >= NEAR, bin = b.d >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a.d) / (b.d - a.d);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, d: NEAR });
      }
    }
    return out;
  }

  const gx2w = (g) => g - HALF; // 格點 → 世界

  /* ---------- 遊戲狀態 ---------- */
  let game = E.createGame();
  let mode = 'pvp';       // 'pvp' | 'ai'
  let humanSide = E.BLACK;
  let aiSide = E.WHITE;
  let busy = false;       // AI 思考中
  let aiTimer = null;
  let startTime = 0;
  let hoverCell = null;
  let recorded = false;   // 本局已寫入排行榜

  /* ---------- SVG 渲染 ---------- */
  let screenPts = [];

  function polyStr(pts) {
    return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }

  function quad(corners, fill, extra = '') {
    const vs = clipPoly(corners.map((c) => toView(c[0], c[1], c[2])));
    if (vs.length < 3) return '';
    return `<polygon points="${polyStr(vs.map(viewToScreen))}" fill="${fill}" ${extra}/>`;
  }

  // 3D 線段（含近平面裁剪）
  function line3d(ax, ay, az, bx, by, bz, attrs = '') {
    let a = toView(ax, ay, az), b = toView(bx, by, bz);
    if (a.d < NEAR && b.d < NEAR) return '';
    if (a.d < NEAR || b.d < NEAR) {
      const t = (NEAR - a.d) / (b.d - a.d);
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, d: NEAR };
      if (a.d < NEAR) a = m; else b = m;
    }
    const p = viewToScreen(a), q = viewToScreen(b);
    return `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" ${attrs}/>`;
  }

  function render() {
    if (!W) return;
    updateCam();

    /* 背景：天空 + 地板（以地平線分界） */
    const horizon = Math.max(0, Math.min(H, CY - F * Math.tan(cam.pitch)));
    let bg = `<rect x="0" y="0" width="${W}" height="${horizon.toFixed(1)}" fill="url(#g-sky)"/>`;
    bg += `<rect x="0" y="${horizon.toFixed(1)}" width="${W}" height="${(H - horizon).toFixed(1)}" fill="url(#g-floor)"/>`;
    layers.bg.innerHTML = bg;

    /* 棋桌 + 棋盤實體 */
    let b = quad([[-13, -SLAB_H, -13], [13, -SLAB_H, -13], [13, -SLAB_H, 13], [-13, -SLAB_H, 13]], '#3d2b1a');
    const B = BOARD_HALF;
    const top = [[-B, 0, -B], [B, 0, -B], [B, 0, B], [-B, 0, B]];
    const sides = [];
    for (let i = 0; i < 4; i++) {
      const a = top[i], c = top[(i + 1) % 4];
      const mid = toView((a[0] + c[0]) / 2, -SLAB_H / 2, (a[2] + c[2]) / 2);
      sides.push({
        d: mid.d,
        corners: [a, c, [c[0], -SLAB_H, c[2]], [a[0], -SLAB_H, a[2]]],
      });
    }
    sides.sort((p, q) => q.d - p.d);
    for (const s of sides) b += quad(s.corners, '#8a5f28');
    b += quad(top, '#c9963f');

    /* 格線 */
    let lines = '';
    for (let i = 0; i < SIZE; i++) {
      const w = gx2w(i);
      lines += line3d(w, 0.015, -HALF, w, 0.015, HALF);
      lines += line3d(-HALF, 0.015, w, HALF, 0.015, w);
    }
    b += `<g stroke="#5a3d1a" stroke-width="1.1" opacity=".9">${lines}</g>`;

    /* 星位 */
    for (const [sx, sz] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      const p = project(gx2w(sx), 0.02, gx2w(sz));
      if (p) b += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(F * 0.09 / p.d).toFixed(1)}" fill="#5a3d1a"/>`;
    }
    layers.board.innerHTML = b;

    /* 交叉點投影快取（供點擊命中） */
    screenPts = [];
    for (let gy = 0; gy < SIZE; gy++) {
      const row = [];
      for (let gx = 0; gx < SIZE; gx++) row.push(project(gx2w(gx), 0, gx2w(gy)));
      screenPts.push(row);
    }

    /* 棋子（含陰影，遠到近排序） */
    const stones = [];
    for (let gy = 0; gy < SIZE; gy++) {
      for (let gx = 0; gx < SIZE; gx++) {
        const v = game.board[gy][gx];
        if (v) stones.push({ gx, gy, v });
      }
    }
    const squash = 0.42 + 0.58 * sp_;
    let sh = '', st = '';
    const items = stones
      .map((s) => {
        let wx = gx2w(s.gx), wy = STONE_H, wz = gx2w(s.gy), op = 1;
        if (flee.active && s.v === E.WHITE) {
          const off = flee.progress * flee.progress * 26;
          let dx = wx, dz = wz;
          const len = Math.hypot(dx, dz);
          if (len < 0.5) { dx = 0.7; dz = -0.7; } else { dx /= len; dz /= len; }
          wx += dx * off; wz += dz * off;
          wy += flee.progress * 2.5;
          op = Math.max(0, 1 - flee.progress * 1.15);
        }
        if (op <= 0) return null;
        const c = project(wx, wy, wz);
        return c ? { ...s, c, op, wx, wz } : null;
      })
      .filter(Boolean)
      .sort((a, b2) => b2.c.d - a.c.d);
    const last = game.moves[game.moves.length - 1];
    for (const s of items) {
      const rx = F * STONE_R / s.c.d, ry = rx * squash;
      const shp = project(s.wx + 0.08, 0.01, s.wz + 0.08);
      if (shp) sh += `<ellipse cx="${shp.x.toFixed(1)}" cy="${shp.y.toFixed(1)}" rx="${(rx * 1.02).toFixed(1)}" ry="${(rx * sp_ * 0.95).toFixed(1)}" fill="rgba(0,0,0,${(0.28 * s.op).toFixed(2)})"/>`;
      st += `<ellipse cx="${s.c.x.toFixed(1)}" cy="${s.c.y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#g-${s.v === E.BLACK ? 'black' : 'white'})"${s.op < 1 ? ` opacity="${s.op.toFixed(2)}"` : ''}/>`;
      if (last && last.x === s.gx && last.y === s.gy && !game.winner) {
        st += `<circle cx="${s.c.x.toFixed(1)}" cy="${(s.c.y - ry * 0.15).toFixed(1)}" r="${Math.max(2, rx * 0.18).toFixed(1)}" fill="#e5484d"/>`;
      }
    }

    /* 預覽棋子 */
    if (hoverCell && !game.winner && !busy && mode !== 'auto' && !intro.active && game.board[hoverCell.gy][hoverCell.gx] === E.EMPTY) {
      const c = project(gx2w(hoverCell.gx), STONE_H, gx2w(hoverCell.gy));
      if (c) {
        const rx = F * STONE_R / c.d;
        st += `<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * squash).toFixed(1)}" fill="url(#g-${game.current === E.BLACK ? 'black' : 'white'})" opacity=".45"/>`;
      }
    }
    layers.stones.innerHTML = sh + st;

    /* 特效層：開場動畫平台 / 勝利連線 */
    let fx = '';
    if (intro.active) {
      const time = (performance.now() - intro.t0) / 1000;
      const plats = intro.plats
        .map((p) => ({ p, d: toView(p.x, p.y, p.z).d }))
        .sort((a, b2) => b2.d - a.d);
      for (const it of plats) if (it.d > NEAR) fx += platformSvg(it.p, time);
    } else if (game.winLine && !flee.active) {
      const pts = game.winLine
        .map((c) => project(gx2w(c.x), STONE_H + 0.05, gx2w(c.y)))
        .filter(Boolean);
      if (pts.length >= 2) {
        const ends = [...pts].sort((a, b2) => a.x - b2.x || a.y - b2.y);
        const p1 = ends[0], p2 = ends[ends.length - 1];
        fx += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#ffd166" stroke-width="5" stroke-linecap="round" opacity=".85"/>`;
        for (const p of pts) fx += `<circle cx="${p.x}" cy="${p.y}" r="${(F * 0.5 / p.d).toFixed(1)}" fill="none" stroke="#ffd166" stroke-width="2.5"/>`;
      }
    }
    layers.fx.innerHTML = fx;
  }

  /* ---------- 命中測試 ---------- */
  function hitCell(px, py) {
    let best = null, bestD = Infinity;
    for (let gy = 0; gy < SIZE; gy++) {
      for (let gx = 0; gx < SIZE; gx++) {
        const p = screenPts[gy] && screenPts[gy][gx];
        if (!p) continue;
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < bestD) { bestD = d; best = { gx, gy, p }; }
      }
    }
    if (!best) return null;
    const nb = screenPts[best.gy][Math.min(SIZE - 1, best.gx + 1)] || screenPts[best.gy][best.gx - 1];
    const spacing = nb ? Math.hypot(nb.x - best.p.x, nb.y - best.p.y) : 24;
    return bestD <= Math.max(10, spacing * 0.55) ? { gx: best.gx, gy: best.gy } : null;
  }

  /* ---------- 遊戲流程 ---------- */
  function setStatus(t) { statusEl.textContent = t; }

  function turnText() {
    if (mode === 'auto') {
      if (game.winner === -1) return '和局';
      if (game.winner) return game.winner === BOSS ? '大哥（黑棋）獲勝！不敗紀錄繼續' : '挑戰者（白棋）連五了…！';
      if (auto.paused) return '觀戰暫停中';
      return `${game.current === BOSS ? '大哥（黑棋）' : '挑戰者（白棋）'}思考中…`;
    }
    if (game.winner === -1) return '和局';
    if (game.winner) {
      const c = game.winner === E.BLACK ? '黑棋' : '白棋';
      if (mode === 'ai') return game.winner === aiSide ? `電腦（${c}）獲勝！` : `你（${c}）獲勝！`;
      return `${c}獲勝！`;
    }
    const c = game.current === E.BLACK ? '黑棋' : '白棋';
    if (mode === 'ai') return game.current === aiSide ? '電腦思考中…' : `你的回合（${c}）`;
    return `${c}回合`;
  }

  function afterMove() {
    render();
    setStatus(turnText());
    if (game.winner) {
      if (mode !== 'auto' && game.winner > 0 && !recorded) setTimeout(openWinModal, 900);
      return;
    }
    scheduleAI();
  }

  function scheduleAI() {
    if (mode !== 'ai' || game.winner || game.current !== aiSide) return;
    busy = true;
    setStatus('電腦思考中…');
    aiTimer = setTimeout(() => {
      aiTimer = null;
      const mv = E.aiMove(game);
      if (mv) E.place(game, mv.x, mv.y);
      busy = false;
      afterMove();
    }, 380);
  }

  function tryPlace(gx, gy) {
    if (busy || game.winner || mode === 'auto' || intro.active) return;
    if (mode === 'ai' && game.current === aiSide) return;
    if (E.place(game, gx, gy)) {
      hoverCell = null;
      afterMove();
    }
  }

  function doUndo() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; busy = false; }
    if (mode === 'auto') {
      if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
      auto.paused = true;
      auto.ended = false;
      resetCinematic();
      updateAutoUI();
    }
    if (!game.moves.length) return;
    recorded = false;
    E.undo(game);
    if (mode === 'ai' && game.current === aiSide && game.moves.length) E.undo(game);
    closeModal('modal-win');
    afterMove();
  }

  function newGame() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
    busy = false;
    game = E.createGame();
    recorded = false;
    hoverCell = null;
    startTime = Date.now();
    auto.rewinds = 0;
    auto.ended = false;
    auto.paused = false;
    resetCinematic();
    updateAutoUI();
    closeModal('modal-win');
    afterMove();
    if (mode === 'auto') autoNext(500);
  }

  /* ---------- 電腦自動對戰（大哥不能輸） ---------- */
  const BOSS = E.BLACK, RIVAL = E.WHITE;
  const MAX_REWINDS = 3;
  const auto = { timer: null, paused: false, speed: 1, rewinds: 0, ended: false };
  const flee = { active: false, progress: 0 };
  const SKY_NIGHT = ['#1b2a4a', '#3d5578', '#8a9bb5'];
  const SKY_DAWN = ['#f7b267', '#f4845f', '#ffd9a0'];
  const flashEl = document.getElementById('flash');
  const memeEl = document.getElementById('meme');

  function skySet(colors) {
    document.querySelectorAll('#g-sky stop').forEach((s, i) => s.setAttribute('stop-color', colors[i]));
  }
  function lerpColor(a, b, t) {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function resetCinematic() {
    flee.active = false;
    flee.progress = 0;
    skySet(SKY_NIGHT);
    memeEl.classList.remove('show');
  }
  function updateAutoUI() {
    document.getElementById('auto-ctrl').classList.toggle('show', mode === 'auto');
    document.getElementById('rewind-badge').textContent = `時間倒轉 ×${auto.rewinds}`;
    document.getElementById('btn-pause').textContent = auto.paused ? '繼續' : '暫停';
    document.getElementById('btn-speed').textContent = `${auto.speed}x`;
  }

  function autoNext(delay) {
    if (auto.timer) clearTimeout(auto.timer);
    auto.timer = setTimeout(autoStep, delay != null ? delay : 650 / auto.speed);
  }

  function autoStep() {
    auto.timer = null;
    if (mode !== 'auto' || auto.paused || auto.ended) return;
    if (game.winner) return autoResolve();
    const isBoss = game.current === BOSS;
    const mv = E.aiMove(game, isBoss ? null : { jitter: 1, pool: 4 });
    if (mv) E.place(game, mv.x, mv.y);
    render();
    setStatus(turnText());
    if (game.winner) return autoResolve();
    autoNext();
  }

  function autoResolve() {
    if (game.winner === RIVAL) {
      if (auto.rewinds < MAX_REWINDS) rewindTime();
      else playMemeEnding();
    } else {
      auto.ended = true;
      setStatus(turnText());
    }
  }

  // 大哥敗局已定：倒轉時間，回到幾手之前重新選擇
  function rewindTime() {
    auto.rewinds++;
    flashEl.classList.add('on');
    setTimeout(() => {
      const n = Math.min(6, Math.max(1, game.moves.length - 1));
      for (let i = 0; i < n; i++) E.undo(game);
      updateAutoUI();
      render();
      flashEl.classList.remove('on');
      setStatus(`大哥倒轉了時間（第 ${auto.rewinds} 次）`);
      autoNext(900);
    }, 220);
  }

  // 倒轉次數用盡仍敗：天亮、對手逃走、字幕
  function playMemeEnding() {
    auto.ended = true;
    setStatus('天亮了……');
    document.getElementById('meme-sub').textContent =
      `時間倒轉 ×${auto.rewinds} · 判定：逃跑者失格 · 戰績：大哥不敗`;
    const t0 = performance.now();
    const DAWN_MS = 2000, FLEE_MS = 1600;
    (function dawn(now) {
      const t = Math.min(1, (now - t0) / DAWN_MS);
      skySet(SKY_NIGHT.map((c, i) => lerpColor(c, SKY_DAWN[i], t)));
      render();
      if (t < 1) return requestAnimationFrame(dawn);
      flee.active = true;
      const t1 = performance.now();
      (function run(n2) {
        flee.progress = Math.min(1, (n2 - t1) / FLEE_MS);
        render();
        if (flee.progress < 1) return requestAnimationFrame(run);
        memeEl.classList.add('show');
        setStatus('大哥沒有輸！');
      })(t1);
    })(t0);
  }

  document.getElementById('btn-pause').addEventListener('click', () => {
    if (mode !== 'auto') return;
    auto.paused = !auto.paused;
    updateAutoUI();
    if (auto.paused) {
      if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
    } else if (!game.winner && !auto.ended) {
      autoNext(200);
    }
    setStatus(turnText());
  });
  document.getElementById('btn-speed').addEventListener('click', () => {
    const steps = [1, 2, 4, 0.5];
    auto.speed = steps[(steps.indexOf(auto.speed) + 1) % steps.length];
    updateAutoUI();
  });
  document.getElementById('meme-close').addEventListener('click', () => memeEl.classList.remove('show'));
  document.getElementById('meme-again').addEventListener('click', () => {
    memeEl.classList.remove('show');
    openModal('modal-setup');
  });

  /* ---------- 開場動畫（無限城致敬，首次進入播 6 秒） ---------- */
  const INTRO_KEY = 'gomoku3d-intro-seen';
  const intro = { active: false, t0: 0, plats: [] };

  function makePlatforms() {
    const plats = [];
    for (let i = 0; i < 16; i++) {
      const ang = i * 2.4 + (i % 3) * 0.7;
      const rad = 9 + (i % 5) * 4.5;
      plats.push({
        x: Math.cos(ang) * rad,
        z: Math.sin(ang) * rad,
        y: 4 + i * 3.6,
        w: 3 + (i % 3) * 1.6,
        rot: ang,
        spin: (i % 2 ? 1 : -1) * (0.15 + (i % 4) * 0.08),
        shoji: i % 3 === 0,
        lantern: i % 4 === 1,
      });
    }
    return plats;
  }

  function platformSvg(p, time) {
    const r = p.rot + time * p.spin;
    const c = Math.cos(r), s = Math.sin(r);
    const hw = p.w, hd = p.w * 0.62;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
      .map(([ux, uz]) => [p.x + ux * c - uz * s, p.y, p.z + ux * s + uz * c]);
    let out = quad(corners, '#7a5a2e', 'stroke="#43301a" stroke-width="1"');
    if (p.shoji) {
      const a = corners[0], b = corners[1];
      const hgt = 2.6;
      out += quad([a, b, [b[0], p.y + hgt, b[2]], [a[0], p.y + hgt, a[2]]],
        'rgba(240,234,214,.85)', 'stroke="#5a4326" stroke-width="1"');
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        out += line3d(
          a[0] + (b[0] - a[0]) * t, p.y, a[2] + (b[2] - a[2]) * t,
          a[0] + (b[0] - a[0]) * t, p.y + hgt, a[2] + (b[2] - a[2]) * t,
          'stroke="#5a4326"');
      }
    }
    if (p.lantern) {
      const lp = project(p.x, p.y + 1.6, p.z);
      if (lp) out += `<circle cx="${lp.x.toFixed(1)}" cy="${lp.y.toFixed(1)}" r="${(F * 0.5 / lp.d).toFixed(1)}" fill="url(#g-lantern)"/>`;
    }
    return out;
  }

  const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2);

  function playIntro() {
    intro.active = true;
    intro.t0 = performance.now();
    intro.plats = makePlatforms();
    document.getElementById('intro-title').classList.add('show');
    setStatus('無限之城……');
    requestAnimationFrame(introFrame);
  }
  function introFrame(now) {
    if (!intro.active) return;
    const t = Math.min(1, (now - intro.t0) / 6000);
    const e = easeIO(t);
    cam.dist = 55 - (55 - 13.5) * e;
    cam.pitch = 1.25 - (1.25 - 0.52) * e;
    cam.yaw = (1 - e) * Math.PI * 3;
    render();
    if (t >= 1) endIntro();
    else requestAnimationFrame(introFrame);
  }
  function endIntro() {
    if (!intro.active) return;
    intro.active = false;
    intro.plats = [];
    cam.yaw = 0; cam.pitch = 0.52; cam.dist = 13.5;
    document.getElementById('intro-title').classList.remove('show');
    try { localStorage.setItem(INTRO_KEY, '1'); } catch {}
    render();
    setStatus('選擇模式開始對局');
    openModal('modal-setup');
  }

  /* ---------- 視角操作（拖曳/縮放/點擊） ---------- */
  const pointers = new Map();
  let dragging = false, tapStart = null, pinchDist = 0;

  svg.addEventListener('pointerdown', (e) => {
    if (intro.active) { endIntro(); return; }
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      tapStart = { x: e.clientX, y: e.clientY };
      dragging = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      tapStart = null;
    }
  });

  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') {
        const c = hitCell(e.clientX - svg.getBoundingClientRect().left, e.clientY - svg.getBoundingClientRect().top);
        if ((c && (!hoverCell || c.gx !== hoverCell.gx || c.gy !== hoverCell.gy)) || (!c && hoverCell)) {
          hoverCell = c;
          render();
        }
      }
      return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const nd = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        cam.dist = Math.min(30, Math.max(6, cam.dist * pinchDist / nd));
        render();
      }
      pinchDist = nd;
      return;
    }
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 7) {
      dragging = true;
      svg.classList.add('dragging');
    }
    if (dragging) {
      cam.yaw -= dx * 0.005;
      cam.pitch = Math.min(1.35, Math.max(0.18, cam.pitch + dy * 0.004));
      render();
    }
  });

  function endPointer(e) {
    if (pointers.has(e.pointerId) && pointers.size === 1 && !dragging && tapStart) {
      const r = svg.getBoundingClientRect();
      const c = hitCell(e.clientX - r.left, e.clientY - r.top);
      if (c) tryPlace(c.gx, c.gy);
    }
    pointers.delete(e.pointerId);
    if (!pointers.size) {
      dragging = false;
      svg.classList.remove('dragging');
    }
    tapStart = null;
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.min(30, Math.max(6, cam.dist * (e.deltaY > 0 ? 1.08 : 0.93)));
    render();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && e.key === 'z') || e.key === 'u') doUndo();
  });

  /* ---------- 排行榜 ---------- */
  const RANK_KEY = 'gomoku3d-rank';

  const RANK_MAX = 50;
  function loadRank() {
    try {
      const data = JSON.parse(localStorage.getItem(RANK_KEY));
      return Array.isArray(data) ? data.slice(0, RANK_MAX) : [];
    } catch { return []; }
  }
  function saveRank(list) {
    try { localStorage.setItem(RANK_KEY, JSON.stringify(list.slice(0, RANK_MAX))); } catch {}
  }

  function fmtDur(ms) {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`;
  }

  const SIG_MAX_STROKES = 64, SIG_MAX_POINTS = 512;
  function sigSvg(strokes) {
    const paths = (Array.isArray(strokes) ? strokes : [])
      .slice(0, SIG_MAX_STROKES)
      .filter((s) => Array.isArray(s) && s.length >= 2)
      .map((s) => `<polyline points="${s.slice(0, SIG_MAX_POINTS).map((p) => (Array.isArray(p) ? p : []).map(Number).filter((n) => Number.isFinite(n)).join(',')).join(' ')}" fill="none" stroke="#1a2340" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('');
    return `<svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  }

  function renderRank() {
    const list = loadRank();
    const el = document.getElementById('rank-list');
    if (!list.length) {
      el.innerHTML = '<div class="rank-empty">尚無紀錄 — 贏一局來簽名吧！</div>';
      return;
    }
    el.innerHTML = list
      .map((r, i) => `
        <div class="rank-item">
          <span class="no">${i + 1}</span>
          <span class="who">${escapeHtml(r.name)}（${escapeHtml(String(r.side))}棋）</span>
          ${r.sig && r.sig.length ? sigSvg(r.sig) : '<span></span>'}
          <span class="meta">${r.vsAI ? '勝過電腦' : '雙人對戰'} · ${escapeHtml(String(r.moves))} 手 · ${fmtDur(r.ms)} · ${escapeHtml(String(r.date))}</span>
        </div>`)
      .join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 簽名板 ---------- */
  const sigPad = document.getElementById('sig-pad');
  let sigStrokes = [], sigCur = null;

  function sigPoint(e) {
    const r = sigPad.getBoundingClientRect();
    return [
      Math.round((e.clientX - r.left) / r.width * 3000) / 10,
      Math.round((e.clientY - r.top) / r.height * 1000) / 10,
    ];
  }
  function drawSig() { sigPad.innerHTML = sigSvg(sigStrokes).replace(/^<svg[^>]*>|<\/svg>$/g, ''); }

  sigPad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sigPad.setPointerCapture(e.pointerId);
    sigCur = [sigPoint(e)];
    sigStrokes.push(sigCur);
  });
  sigPad.addEventListener('pointermove', (e) => {
    if (!sigCur) return;
    sigCur.push(sigPoint(e));
    drawSig();
  });
  sigPad.addEventListener('pointerup', () => { sigCur = null; drawSig(); });
  sigPad.addEventListener('pointercancel', () => { sigCur = null; });
  document.getElementById('sig-clear').addEventListener('click', () => {
    sigStrokes = []; sigCur = null; sigPad.innerHTML = '';
  });

  /* ---------- 彈窗 ---------- */
  function openModal(id) { document.getElementById(id).classList.add('show'); }
  function closeModal(id) { document.getElementById(id).classList.remove('show'); }

  function openWinModal() {
    const humanWon = mode === 'pvp' || game.winner === humanSide;
    const c = game.winner === E.BLACK ? '黑' : '白';
    document.getElementById('win-title').textContent =
      humanWon ? `${c}棋獲勝！` : '電腦獲勝！';
    document.getElementById('win-detail').textContent = humanWon
      ? `共 ${game.moves.length} 手 · 用時 ${fmtDur(Date.now() - startTime)}，簽名留下你的戰績吧！`
      : `共 ${game.moves.length} 手。悔棋可以回到落敗前，再試一次！`;
    const canSign = humanWon;
    document.getElementById('win-name').parentElement.style.display = canSign ? '' : 'none';
    sigPad.parentElement.style.display = canSign ? '' : 'none';
    document.getElementById('btn-save').style.display = canSign ? '' : 'none';
    document.getElementById('btn-skip').textContent = canSign ? '跳過' : '關閉';
    sigStrokes = []; sigPad.innerHTML = '';
    openModal('modal-win');
  }

  document.getElementById('btn-save').addEventListener('click', () => {
    const name = document.getElementById('win-name').value.trim() || '無名氏';
    const list = loadRank();
    list.push({
      name,
      sig: sigStrokes.filter((s) => s.length >= 2),
      side: game.winner === E.BLACK ? '黑' : '白',
      vsAI: mode === 'ai',
      moves: game.moves.length,
      ms: Date.now() - startTime,
      date: new Date().toLocaleDateString('zh-TW'),
    });
    list.sort((a, b) => (b.vsAI - a.vsAI) || (a.moves - b.moves) || (a.ms - b.ms));
    saveRank(list);
    recorded = true;
    closeModal('modal-win');
    renderRank();
    openModal('modal-rank');
  });
  document.getElementById('btn-skip').addEventListener('click', () => {
    recorded = true;
    closeModal('modal-win');
  });

  document.getElementById('btn-rank').addEventListener('click', () => {
    renderRank();
    openModal('modal-rank');
  });
  document.getElementById('btn-rank-close').addEventListener('click', () => closeModal('modal-rank'));
  document.getElementById('btn-rank-clear').addEventListener('click', () => {
    if (confirm('確定清空所有排行紀錄？')) {
      saveRank([]);
      renderRank();
    }
  });

  /* ---------- 開局設定 ---------- */
  function segInit(id, cb) {
    const seg = document.getElementById(id);
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      cb(btn);
    });
  }
  segInit('seg-mode', (btn) => {
    mode = btn.dataset.mode;
    document.getElementById('field-side').style.display = mode === 'ai' ? '' : 'none';
    document.getElementById('auto-desc').style.display = mode === 'auto' ? '' : 'none';
  });
  segInit('seg-side', (btn) => {
    humanSide = +btn.dataset.side;
    aiSide = humanSide === E.BLACK ? E.WHITE : E.BLACK;
  });
  document.getElementById('field-side').style.display = 'none';

  document.getElementById('btn-start').addEventListener('click', () => {
    closeModal('modal-setup');
    newGame();
  });
  document.getElementById('btn-new').addEventListener('click', () => openModal('modal-setup'));
  document.getElementById('btn-undo').addEventListener('click', doUndo);

  /* ---------- 啟動 ---------- */
  window.addEventListener('resize', resize);
  resize();
  let introSeen = true;
  try { introSeen = !!localStorage.getItem(INTRO_KEY); } catch {}
  if (introSeen) {
    setStatus('選擇模式開始對局');
    openModal('modal-setup');
  } else {
    playIntro();
  }

  window.__g3d = {
    get game() { return game; },
    screenPt: (gx, gy) => screenPts[gy] && screenPts[gy][gx],
    cam,
    render,
    auto,
    intro,
    flee,
    rewindTime,
    playMemeEnding,
    endIntro,
  };
})();
