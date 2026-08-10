/* 3D 棋弈（五子棋 × 圍棋）：SVG 透視渲染 + 第一人稱視角 + UI */
(function () {
  'use strict';

  /* ---------- 棋種設定 ----------
     整份 UI 只認 GAMES[id] 這張表，不認「五子棋」或「圍棋」。
     新增第三種棋 ＝ 加一筆設定 ＋ 一個同形 API 的引擎。
     兩個引擎的 EMPTY/BLACK/WHITE 都是 0/1/2，所以顏色常數可以共用。 */
  const GAMES = {
    gomoku: {
      id: 'gomoku',
      label: '五子棋',
      heading: '3D 五子棋',
      docTitle: '3D 五子棋 — 第一人稱對弈',
      get engine() { return window.GomokuEngine; },
      sizes: [15],
      defaultSize: 15,
      stars: () => [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]],
      // 哪些功能對這個棋種有意義（沒有的按鈕會整顆隱藏）
      features: {
        renju: true, auto: true, lessons: true, puzzles: true, openings: true,
        online: true, coach: true, heat: true, hint: true, rank: true,
        replay: true, pass: false, winLine: true,
      },
      newGame(o) { return window.GomokuEngine.createGame({ renju: o.renju }); },
      place(g, x, y) { return window.GomokuEngine.place(g, x, y); },
      undo(g) { return window.GomokuEngine.undo(g); },
      isOver(g) { return !!g.winner; },
      canMove(g) { return !g.winner; },
      // 同形的分時搜尋介面：五子棋是同步的，包成「一步就完成」
      aiSearch(g, opts) {
        let result = null, done = false;
        return {
          step() {
            if (!done) { result = window.GomokuEngine.aiMove(g, opts); done = true; }
            return true;
          },
          best() { return result; },
        };
      },
      replayBoard(g, n) {
        const b = Array.from({ length: g.board.length }, () => new Array(g.board.length).fill(0));
        for (let k = 0; k < n; k++) { const m = g.moves[k]; b[m.y][m.x] = m.player; }
        return b;
      },
      // 落子被拒時給玩家的理由（沒有理由就回 null，不出聲）
      illegalReason(g, x, y) {
        if (!g.renju || g.current !== 1) return null;
        const r = window.GomokuEngine.forbiddenReason(g.board, x, y);
        return r ? `禁手！黑棋不能下「${r}」` : null;
      },
      levelDesc: {
        easy: '入門：新手級。偏重自己進攻、幾乎不防守，用「活三做活四」就能贏它。',
        medium: '進階：會擋你的活三、往後算一回合，一般玩家的對手。',
        hard: '困難：往後算兩三回合，看得到雙威脅組合、會設陷阱。',
        master: '大師：更深更廣的搜尋（每手最多約 0.4 秒），全力求勝。',
      },
    },

    go: {
      id: 'go',
      label: '圍棋',
      heading: '3D 圍棋',
      docTitle: '3D 圍棋 — 第一人稱對弈',
      get engine() { return window.GoEngine; },
      sizes: [9, 13, 19],
      defaultSize: 19,
      stars: (n) => window.GoEngine.starPoints(n),
      features: {
        renju: false, auto: false, lessons: false, puzzles: false, openings: false,
        online: false, coach: false, heat: false, hint: false, rank: false,
        replay: true, pass: true, winLine: false,
      },
      newGame(o) { return window.GoEngine.createGame({ size: o.size }); },
      place(g, x, y) { return window.GoEngine.place(g, x, y); },
      undo(g) { return window.GoEngine.undo(g); },
      isOver(g) { return g.phase === 'over'; },
      canMove(g) { return g.phase === 'play'; },
      aiSearch(g, opts) {
        const s = window.GoAI.createSearch(g, opts);
        return { step: (ms) => s.step(ms), best: () => s.best() };
      },
      replayBoard(g, n) { return window.GoEngine.replayBoard(g, n); },
      illegalReason(g, x, y) {
        const r = window.GoEngine.legal(g, x, y);
        return r.ok ? null : r.reason;
      },
      levelDesc: {
        easy: '入門：只想幾百盤，會提子但看不遠，新手的對手。',
        medium: '進階：每手想上萬盤，會做眼、會斷、會收官。',
        hard: '困難：每手約 2 秒的深度搜尋，9 路上相當難纏。',
        master: '大師：每手約 4 秒，全力求勝（19 路仍受限於純網頁的運算量）。',
      },
    },
  };

  let G = GAMES.gomoku;                 // 目前棋種設定
  let E = G.engine;                     // 目前引擎（與 G 同步切換）
  let SIZE = G.defaultSize;             // 盤面路數（圍棋會變）
  let HALF = (SIZE - 1) / 2;
  let BOARD_HALF = HALF + 1;            // 棋盤板面半寬
  const SLAB_H = 0.6;                   // 棋盤厚度
  const STONE_R = 0.42, STONE_H = 0.24; // 棋子半徑 / 球心高度

  function applyBoardSize(n) {
    SIZE = n;
    HALF = (SIZE - 1) / 2;
    BOARD_HALF = HALF + 1;
  }

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

  /* ---------- 視角模式：2D 俯視 / 回正 / 鎖定 ---------- */
  // 換過鍵名：舊版存的是絕對距離（13.5），新版存的是「相對盤面大小的倍率」，
  // 沿用舊值會讓 9 路貼到臉上、19 路遠在天邊。
  const VIEW_KEY = 'g3d-view';
  const CAM_DEFAULT = { yaw: 0, pitch: 0.52, dist: 1 };
  // 相機距離隨盤面大小走：1.7 × 板面半寬。15 路時等於 13.6，與改版前幾乎一致。
  const DIST_K = 1.7, DIST_K_2D = 1.875;
  const dist3d = () => BOARD_HALF * DIST_K * view.dist;
  const dist2d = () => BOARD_HALF * DIST_K_2D;
  // 2D 俯視＝把相機搬到棋盤正上方直視。pitch 取「逼近」π/2 而不取等值：
  // 剛好 π/2 時 tan(pitch) 會溢位、視空間基底退化，投影會除出 Infinity／NaN，
  // 畫面會靜默變成整片空白（不會噴錯，很難查）。
  const CAM_2D = { yaw: 0, pitch: Math.PI / 2 - 0.002 };
  // view 存的是「3D 模式下的角度」。2D 只是暫時改用 CAM_2D 顯示，
  // 切回 3D 時原本的角度要原封不動回來（與西洋棋一致）。
  const view = { mode: '3d', yaw: CAM_DEFAULT.yaw, pitch: CAM_DEFAULT.pitch, dist: CAM_DEFAULT.dist, locked: false };
  const TAU = Math.PI * 2;
  const canOrbit = () => view.mode === '3d' && !view.locked;

  function numOr(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function clampView() {
    // 先轉數值再夾範圍：localStorage 可能被寫進字串或 null，
    // NaN 會一路傳染到 sin/cos，整個場景靜默消失。
    let y = numOr(view.yaw, CAM_DEFAULT.yaw) % TAU;
    if (y > Math.PI) y -= TAU;
    if (y <= -Math.PI) y += TAU;
    view.yaw = y;
    view.pitch = Math.min(1.35, Math.max(0.18, numOr(view.pitch, CAM_DEFAULT.pitch)));
    view.dist = Math.min(2.2, Math.max(0.45, numOr(view.dist, CAM_DEFAULT.dist)));
    view.locked = view.locked === true;   // 只認真正的 true
    view.mode = view.mode === '2d' ? '2d' : '3d';
  }
  function loadView() {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY));
      if (v && typeof v === 'object') Object.assign(view, v);
    } catch {}
    clampView();
  }
  function saveView() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {}
  }
  function syncCam() {
    const is2d = view.mode === '2d';
    const src = is2d ? CAM_2D : view;
    cam.yaw = src.yaw; cam.pitch = src.pitch;
    cam.dist = is2d ? dist2d() : dist3d();
  }
  // 是否還停在預設角度（決定「回正」要不要亮起來）
  function viewIsDefault() {
    return Math.abs(view.yaw - CAM_DEFAULT.yaw) < 1e-6 &&
      Math.abs(view.pitch - CAM_DEFAULT.pitch) < 1e-6 &&
      Math.abs(view.dist - CAM_DEFAULT.dist) < 1e-6;
  }
  // 在第一次 render 之前就把相機擺好，避免開場閃一下預設視角
  loadView();
  syncCam();

  function applyView() {
    clampView();
    const is3d = view.mode === '3d';
    svg.classList.toggle('view-2d', !is3d);
    svg.classList.toggle('locked', view.locked);

    const btnView = document.getElementById('btn-view');
    btnView.textContent = is3d ? '2D 視角' : '3D 視角';
    btnView.title = is3d ? '切換成 2D 俯視（從正上方直視棋盤）' : '切回 3D 立體視角';

    const btnLock = document.getElementById('btn-lock');
    btnLock.textContent = view.locked ? '🔒 已鎖定' : '🔓 鎖定視角';
    btnLock.setAttribute('aria-pressed', view.locked ? 'true' : 'false');
    btnLock.title = view.locked
      ? '目前已鎖定：拖曳與縮放不會改變視角（「回正」仍可用）'
      : '鎖定視角，避免下棋時不小心拖動角度';
    btnLock.disabled = !is3d;   // 2D 沒有角度可鎖

    const btnRecenter = document.getElementById('btn-recenter');
    btnRecenter.disabled = !is3d || viewIsDefault();
    btnRecenter.title = is3d ? '把視角方向、俯角與縮放回到預設值' : '2D 俯視沒有角度可回正';

    document.getElementById('hint').textContent = !is3d
      ? '2D 俯視 · 點擊交叉點落子'
      : view.locked
        ? '視角已鎖定 · 點擊交叉點落子'
        : '拖曳環顧四周 · 滾輪/雙指縮放 · 點擊交叉點落子';

    // 開場動畫正在自己開相機，這時只更新 UI、不要搶方向盤
    if (!intro.active) { syncCam(); render(); }
  }

  function toggleViewMode() {
    view.mode = view.mode === '3d' ? '2d' : '3d';
    saveView();
    applyView();
  }
  // 一鍵回正：只還原角度與縮放，不動 2D/3D 模式與鎖定狀態。
  // 鎖定時仍然可用——鎖定擋的是拖曳／滾輪這類「不小心改到」，不是使用者明確按下的動作。
  function recenterView() {
    if (view.mode !== '3d') return;
    view.yaw = CAM_DEFAULT.yaw;
    view.pitch = CAM_DEFAULT.pitch;
    view.dist = CAM_DEFAULT.dist;
    saveView();
    applyView();
  }
  function toggleViewLock() {
    if (view.mode !== '3d') return;
    view.locked = !view.locked;
    saveView();
    applyView();
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

  // 熱力圖配色：norm 0→1 映射為 藍→青→綠→黃→紅
  const HEAT_STOPS = [
    [40, 90, 200], [40, 180, 200], [60, 200, 90], [240, 200, 40], [230, 60, 50],
  ];
  function heatColor(t) {
    const c = Math.max(0, Math.min(1, t)) * (HEAT_STOPS.length - 1);
    const i = Math.min(HEAT_STOPS.length - 2, Math.floor(c));
    const f = c - i, a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1];
    const ch = (k) => Math.round(a[k] + (b[k] - a[k]) * f);
    return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
  }

  /* ---------- 遊戲狀態 ---------- */
  let game = E.createGame();
  let mode = 'pvp';       // 'pvp' | 'ai' | 'auto' | 'lesson'
  let setupMode = 'pvp';  // 開局設定選單目前選的模式（與 mode 分開，避免教學模式污染）
  let humanSide = E.BLACK;
  let aiSide = E.WHITE;
  let aiLevel = 'medium'; // 'easy' | 'medium' | 'hard' | 'master'
  let renjuOn = false;    // 禁手規則
  let busy = false;       // AI 思考中
  let aiTimer = null;
  let aiRAF = null;      // 分時 AI 搜尋的 rAF 控制代碼
  let startTime = 0;
  let hoverCell = null;
  let recorded = false;   // 本局已寫入排行榜
  let coachOn = false;    // 教練模式：即時威脅高亮
  let heatOn = false;     // AI 思考熱力圖
  let hintCell = null;    // 「提示」按鈕的建議點
  const coachCache = { key: '', list: [] };
  const heatCache = { key: '', list: [] };
  const replay = { active: false, index: 0, board: null }; // 棋譜回放
  const lessonState = { active: null, idx: -1, moves: 0, busyAI: false };
  let net = null;         // 線上連線（WebRTC）
  let mySide = E.BLACK;   // 線上對戰中我方執色
  const lessons = typeof GomokuLessons !== 'undefined' ? GomokuLessons : [];

  /* ---------- 落子/勝利特效 ---------- */
  let fxOn = true;        // 活潑特效開關
  try { fxOn = localStorage.getItem('gomoku3d-fx') !== '0'; } catch {}
  const fxList = [];      // 進行中的特效：{ kind:'place'|'win', gx, gy, player, line, t0 }
  let fxRAF = null;
  const FX_DUR = { place: 480, win: 1200 };
  const easeOutBack = (t) => { const c = 1.70158, c3 = c + 1; return 1 + c3 * (t - 1) ** 3 + c * (t - 1) ** 2; };

  // 針對「最後落下的一子」觸發特效；勝利時追加勝利特效
  function fxAfterPlace() {
    if (!fxOn) return;
    const m = game.moves[game.moves.length - 1];
    if (!m) return;
    fxList.push({ kind: 'place', gx: m.x, gy: m.y, player: m.player, t0: performance.now() });
    if (G.features.winLine && game.winner > 0 && game.winLine) {
      fxList.push({ kind: 'win', line: game.winLine, player: m.player, t0: performance.now() });
    }
    ensureFxLoop();
  }

  function ensureFxLoop() {
    if (fxRAF) return;
    const step = () => {
      const now = performance.now();
      for (let i = fxList.length - 1; i >= 0; i--) {
        if (now - fxList[i].t0 > FX_DUR[fxList[i].kind]) fxList.splice(i, 1);
      }
      render();
      if (fxList.length) fxRAF = requestAnimationFrame(step);
      else { fxRAF = null; render(); }
    };
    fxRAF = requestAnimationFrame(step);
  }

  // 產生落子/勝利特效的 SVG（畫在 fx 層）
  function fxSvg(now) {
    let out = '';
    for (const f of fxList) {
      const p = Math.min(1, (now - f.t0) / FX_DUR[f.kind]);
      if (f.kind === 'place') {
        const c = project(gx2w(f.gx), STONE_H, gx2w(f.gy));
        if (!c) continue;
        const base = F * STONE_R / c.d;
        // 擴散光環
        const rr = base * (1 + p * 1.9);
        out += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${rr.toFixed(1)}" fill="none" stroke="#ffd166" stroke-width="${(2.6 * (1 - p)).toFixed(2)}" opacity="${(0.85 * (1 - p)).toFixed(2)}"/>`;
        // 火花
        const nSp = 7;
        for (let k = 0; k < nSp; k++) {
          const ang = (k / nSp) * Math.PI * 2 + f.gx * 0.7 + f.gy * 1.3;
          const dist = base * (0.3 + p * 2.2);
          const sx = c.x + Math.cos(ang) * dist, sy = c.y + Math.sin(ang) * dist * 0.6;
          const sr = Math.max(0.5, base * 0.12 * (1 - p));
          out += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="#ffe08a" opacity="${(0.9 * (1 - p)).toFixed(2)}"/>`;
        }
      } else if (f.kind === 'win') {
        // 勝利：從連線中點爆出的衝擊波環 + 粒子
        const mid = f.line[Math.floor(f.line.length / 2)];
        const c = project(gx2w(mid.x), STONE_H, gx2w(mid.y));
        if (!c) continue;
        const base = F * STONE_R / c.d;
        for (let w = 0; w < 2; w++) {
          const wp = Math.min(1, p * 1.4 - w * 0.25);
          if (wp <= 0) continue;
          const rr = base * (1 + wp * 7);
          out += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${rr.toFixed(1)}" fill="none" stroke="${w ? '#ffb35c' : '#ffd166'}" stroke-width="${(3.5 * (1 - wp)).toFixed(2)}" opacity="${(0.8 * (1 - wp)).toFixed(2)}"/>`;
        }
        const nP = 18;
        for (let k = 0; k < nP; k++) {
          const ang = (k / nP) * Math.PI * 2 + k * 0.3;
          const dist = base * (0.5 + p * 5.5);
          const sx = c.x + Math.cos(ang) * dist, sy = c.y + Math.sin(ang) * dist * 0.65 - p * base * 1.5;
          const sr = Math.max(0.6, base * 0.16 * (1 - p));
          out += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="${k % 2 ? '#ffd166' : '#fff1b8'}" opacity="${(0.95 * (1 - p)).toFixed(2)}"/>`;
        }
      }
    }
    return out;
  }

  /* ---------- 音效（Web Audio 合成，不需音檔） ---------- */
  const sound = (() => {
    let ctx = null, enabled = true;
    try { enabled = localStorage.getItem('gomoku3d-sound') !== '0'; } catch {}
    function ac() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, dur, gain, delay, type) {
      const c = ac(), t = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      get enabled() { return enabled; },
      toggle() {
        enabled = !enabled;
        try { localStorage.setItem('gomoku3d-sound', enabled ? '1' : '0'); } catch {}
        return enabled;
      },
      stone() { // 清脆的落子聲：高頻敲擊＋短噪音
        if (!enabled) return;
        try {
          tone(1500, 0.07, 0.35);
          const c = ac(), t = c.currentTime;
          const nb = c.createBuffer(1, 1500, c.sampleRate);
          const data = nb.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 200);
          const src = c.createBufferSource(); src.buffer = nb;
          const ng = c.createGain(); ng.gain.value = 0.18;
          src.connect(ng).connect(c.destination); src.start(t);
        } catch {}
      },
      win() { // 勝利小琶音
        if (!enabled) return;
        try { tone(660, 0.16, 0.25); tone(880, 0.16, 0.25, 0.12); tone(1320, 0.3, 0.25, 0.24); } catch {}
      },
      deny() { // 禁手／下錯提示
        if (!enabled) return;
        try { tone(220, 0.12, 0.2, 0, 'square'); } catch {}
      },
    };
  })();

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

    if (intro.active) { renderNeonIntro(); return; }

    /* 背景：天空 + 地板（以地平線分界） */
    const horizon = Math.max(0, Math.min(H, CY - F * Math.tan(cam.pitch)));
    let bg = `<rect x="0" y="0" width="${W}" height="${horizon.toFixed(1)}" fill="url(#g-sky)"/>`;
    bg += `<rect x="0" y="${horizon.toFixed(1)}" width="${W}" height="${(H - horizon).toFixed(1)}" fill="url(#g-floor)"/>`;
    layers.bg.innerHTML = bg;

    /* 棋桌 + 棋盤實體 */
    const T = BOARD_HALF + 5;   // 棋桌比棋盤大一圈，隨盤面大小一起長
    let b = quad([[-T, -SLAB_H, -T], [T, -SLAB_H, -T], [T, -SLAB_H, T], [-T, -SLAB_H, T]], '#3d2b1a');
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

    /* 星位（各棋種／各盤面大小的星位由 GAMES 表決定） */
    for (const [sx, sz] of G.stars(SIZE)) {
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

    /* 棋子（含陰影，遠到近排序）；回放模式顯示截至 replay.index 的盤面 */
    const dispBoard = replay.active ? replay.board : game.board;
    const dispMoves = replay.active ? game.moves.slice(0, replay.index) : game.moves;
    const stones = [];
    for (let gy = 0; gy < SIZE; gy++) {
      for (let gx = 0; gx < SIZE; gx++) {
        const v = dispBoard[gy][gx];
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
        // 確認死子階段：被標成死的子畫得很淡，一眼看得出來哪些不算數
        if (scoring.active && scoring.dead.has(s.gy * SIZE + s.gx)) op *= 0.28;
        if (op <= 0) return null;
        const c = project(wx, wy, wz);
        return c ? { ...s, c, op, wx, wz } : null;
      })
      .filter(Boolean)
      .sort((a, b2) => b2.c.d - a.c.d);
    const last = dispMoves[dispMoves.length - 1];
    const showLastMark = replay.active || !G.isOver(game);
    // 剛落下的棋子彈跳登場（pop）
    const fxNow = performance.now();
    const popMap = (fxOn && !replay.active && fxList.length) ? new Map(
      fxList.filter((f) => f.kind === 'place').map((f) => [f.gy * SIZE + f.gx, f.t0])
    ) : null;
    for (const s of items) {
      let rx = F * STONE_R / s.c.d, ry = rx * squash;
      if (popMap) {
        const t0 = popMap.get(s.gy * SIZE + s.gx);
        if (t0 !== undefined) {
          const pp = (fxNow - t0) / 200;
          if (pp < 1) { const sc = Math.max(0.15, easeOutBack(Math.max(0, pp))); rx *= sc; ry *= sc; }
        }
      }
      const shp = project(s.wx + 0.08, 0.01, s.wz + 0.08);
      if (shp) sh += `<ellipse cx="${shp.x.toFixed(1)}" cy="${shp.y.toFixed(1)}" rx="${(rx * 1.02).toFixed(1)}" ry="${(rx * sp_ * 0.95).toFixed(1)}" fill="rgba(0,0,0,${(0.28 * s.op).toFixed(2)})"/>`;
      st += `<ellipse cx="${s.c.x.toFixed(1)}" cy="${s.c.y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#g-${s.v === E.BLACK ? 'black' : 'white'})"${s.op < 1 ? ` opacity="${s.op.toFixed(2)}"` : ''}/>`;
      if (last && last.x === s.gx && last.y === s.gy && showLastMark) {
        // 最後一手：紅色圓環標記
        st += `<ellipse cx="${s.c.x.toFixed(1)}" cy="${s.c.y.toFixed(1)}" rx="${(rx * 1.28).toFixed(1)}" ry="${(ry * 1.28).toFixed(1)}" fill="none" stroke="#e5484d" stroke-width="2.2" opacity=".9"/>`;
      }
    }

    /* 預覽棋子 */
    if (hoverCell && G.canMove(game) && !busy && mode !== 'auto' && !intro.active && !replay.active && game.board[hoverCell.gy][hoverCell.gx] === E.EMPTY) {
      const c = project(gx2w(hoverCell.gx), STONE_H, gx2w(hoverCell.gy));
      if (c) {
        const rx = F * STONE_R / c.d;
        st += `<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * squash).toFixed(1)}" fill="url(#g-${game.current === E.BLACK ? 'black' : 'white'})" opacity=".45"/>`;
      }
    }
    layers.stones.innerHTML = sh + st;

    /* 特效層：勝利連線 */
    let fx = '';
    /* 確認死子階段：在空點與死子的位置畫出地盤歸屬 */
    if (scoring.active && scoring.result) {
      const owner = scoring.result.owner;
      let terr = '';
      for (let gy = 0; gy < SIZE; gy++) {
        for (let gx = 0; gx < SIZE; gx++) {
          const p = gy * SIZE + gx;
          const ow = owner[p];
          if (!ow) continue;                                   // 單官不標
          const isStone = game.board[gy][gx] !== E.EMPTY;
          if (isStone && !scoring.dead.has(p)) continue;        // 活著的子本身不用標
          const c = project(gx2w(gx), 0.06, gx2w(gy));
          if (!c) continue;
          const r = F * 0.10 / c.d;
          const h = r * squash;
          terr += `<rect x="${(c.x - r).toFixed(1)}" y="${(c.y - h).toFixed(1)}" ` +
            `width="${(r * 2).toFixed(1)}" height="${(h * 2).toFixed(1)}" ` +
            `fill="${ow === E.BLACK ? '#14141a' : '#f4f1e8'}" opacity=".82" ` +
            `stroke="rgba(0,0,0,.4)" stroke-width="1"/>`;
        }
      }
      fx += terr;
    }

    if (G.features.winLine && game.winLine && !flee.active && (!replay.active || replay.index >= game.moves.length)) {
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

    /* 教練模式：威脅點高亮（僅玩家回合、非回放/觀戰/教學 AI 思考中） */
    const coachVisible = coachOn && !replay.active && !intro.active && mode !== 'auto' &&
      G.canMove(game) && !busy && !lessonState.busyAI &&
      (mode !== 'ai' || game.current !== aiSide);
    if (coachVisible) {
      const key = mode + ':' + game.moves.length + ':' + game.current;
      if (coachCache.key !== key) {
        coachCache.key = key;
        coachCache.list = E.hints(game);
      }
      // 依急迫度過濾：有連五級威脅時只顯示連五級，避免滿盤標記
      const listAll = coachCache.list;
      const urgent = listAll.filter((h) => h.kind === 'win' || h.kind === 'block');
      const strong = listAll.filter((h) => h.kind === 'attack' || h.kind === 'danger');
      const weak = listAll.filter((h) => h.kind === 'three' || h.kind === 'watch');
      const forb = listAll.filter((h) => h.kind === 'forbidden');
      const shown = urgent.length ? urgent : (strong.length ? strong : weak);
      const COACH_COLOR = {
        win: '#ffd166', block: '#e5484d', attack: '#ff9f43',
        danger: '#f06595', three: '#4dabf7', watch: '#74c0fc',
      };
      for (const h of shown) {
        const p = project(gx2w(h.x), 0.03, gx2w(h.y));
        if (!p) continue;
        const r = F * 0.32 / p.d;
        fx += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${COACH_COLOR[h.kind]}" stroke-width="2.4" opacity=".9"/>`;
      }
      for (const h of forb) {
        const p = project(gx2w(h.x), 0.03, gx2w(h.y));
        if (!p) continue;
        const r = F * 0.2 / p.d;
        fx += `<g stroke="#e03131" stroke-width="2.2" opacity=".85">` +
          `<line x1="${(p.x - r).toFixed(1)}" y1="${(p.y - r).toFixed(1)}" x2="${(p.x + r).toFixed(1)}" y2="${(p.y + r).toFixed(1)}"/>` +
          `<line x1="${(p.x - r).toFixed(1)}" y1="${(p.y + r).toFixed(1)}" x2="${(p.x + r).toFixed(1)}" y2="${(p.y - r).toFixed(1)}"/></g>`;
      }
    }

    /* AI 思考熱力圖：候選點依評分上色（藍→青→黃→紅），最佳點加白環 */
    const heatVisible = heatOn && !replay.active && !intro.active && mode !== 'auto' &&
      G.canMove(game) && !busy && !lessonState.busyAI &&
      (mode !== 'ai' || game.current !== aiSide);
    if (heatVisible) {
      const key = 'h:' + mode + ':' + game.moves.length + ':' + game.current;
      if (heatCache.key !== key) {
        heatCache.key = key;
        heatCache.list = E.analyzeMoves(game, { top: 30 });
      }
      const list = heatCache.list;
      // 依深度排序（遠先畫），近的蓋在上面
      const drawn = list
        .map((m) => ({ m, p: project(gx2w(m.x), 0.03, gx2w(m.y)) }))
        .filter((o) => o.p)
        .sort((a, b2) => b2.p.d - a.p.d);
      for (const { m, p } of drawn) {
        const r = F * 0.4 / p.d;
        fx += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${heatColor(m.norm)}" opacity="${(0.22 + 0.5 * m.norm).toFixed(2)}"/>`;
      }
      if (list.length) {
        const best = list[0]; // analyzeMoves 已依分數排序，第一個是 AI 首選
        const bp = project(gx2w(best.x), 0.04, gx2w(best.y));
        if (bp) {
          const r = F * 0.42 / bp.d;
          fx += `<circle cx="${bp.x.toFixed(1)}" cy="${bp.y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#fff" stroke-width="2.6"/>`;
        }
      }
    }

    /* 「提示」建議點：金色雙環 */
    if (hintCell && !replay.active && !G.isOver(game)) {
      const p = project(gx2w(hintCell.x), 0.03, gx2w(hintCell.y));
      if (p) {
        const r = F * 0.36 / p.d;
        fx += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#ffd166" stroke-width="3"/>` +
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(r * 0.55).toFixed(1)}" fill="#ffd166" opacity=".35"/>`;
      }
    }

    /* 落子/勝利活潑特效 */
    if (fxOn && fxList.length && !replay.active) fx += fxSvg(fxNow);

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

  // 圍棋的狀態列：輪次 + 提子數 + 終局結果
  function goTurnText() {
    const caps = `　提子 黑 ${game.captured[E.BLACK]}／白 ${game.captured[E.WHITE]}`;
    if (game.phase === 'over') {
      const w = game.winner === E.BLACK ? '黑棋' : game.winner === E.WHITE ? '白棋' : '';
      if (game.reason === 'resign') return `${w}獲勝（對方認輸）`;
      const r = game.result;
      if (!r) return '對局結束';
      if (r.winner === -1) return `和局（黑 ${r.black}／白 ${r.white}）`;
      return `${w}勝 ${Math.abs(r.diff)} 目（黑 ${r.black}／白 ${r.white}）`;
    }
    if (game.phase === 'scoring') return '雙方虛手 — 準備結算';
    const c = game.current === E.BLACK ? '黑棋' : '白棋';
    const last = game.moves[game.moves.length - 1];
    const passed = last && last.pass ? '　對方剛虛手' : '';
    if (mode === 'ai') {
      return (game.current === aiSide ? '電腦思考中…' : `你的回合（${c}）`) + passed + caps;
    }
    return `${c}回合${passed}${caps}`;
  }

  function turnText() {
    if (G.id === 'go') return goTurnText();
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
    if (mode === 'online') {
      const meC = mySide === E.BLACK ? '黑棋' : '白棋';
      return game.current === mySide ? `你的回合（${meC}）` : '等待對方落子…';
    }
    return `${c}回合`;
  }

  // 每個棋種只顯示對它有意義的功能鈕
  const FEATURE_BTN = {
    coach: 'btn-coach', heat: 'btn-heat', lessons: 'btn-lessons',
    puzzles: 'btn-puzzles', openings: 'btn-openings', online: 'btn-online',
    rank: 'btn-rank',
  };
  function applyFeatureVisibility() {
    for (const k in FEATURE_BTN) {
      const el = document.getElementById(FEATURE_BTN[k]);
      if (el) el.style.display = G.features[k] ? '' : 'none';
    }
  }

  function updateTopbar() {
    applyFeatureVisibility();
    const goCtrl = document.getElementById('go-ctrl');
    goCtrl.classList.toggle('show', G.features.pass && !replay.active);
    document.getElementById('btn-pass').disabled =
      !G.canMove(game) || busy || scoring.active || (mode === 'ai' && game.current === aiSide);
    document.getElementById('btn-resign').disabled = G.isOver(game);
    document.getElementById('btn-replay').style.display =
      (G.features.replay && G.isOver(game) && mode !== 'auto' && !replay.active && game.moves.length) ? '' : 'none';
    document.getElementById('replay-ctrl').classList.toggle('show', replay.active);
    document.getElementById('btn-hint').style.display =
      (G.features.hint && (coachOn || mode === 'lesson' || mode === 'puzzle')) ? '' : 'none';
    document.getElementById('btn-coach').classList.toggle('on', coachOn);
    document.getElementById('btn-heat').classList.toggle('on', heatOn);
    document.getElementById('btn-fx').classList.toggle('on', fxOn);
    document.getElementById('btn-sound').textContent = sound.enabled ? '🔊' : '🔇';
  }

  function afterMove() {
    render();
    setStatus(turnText());
    updateTopbar();
    if (G.features.pass && game.phase === 'scoring' && !scoring.active) return enterScoring();
    if (G.isOver(game)) {
      if (game.winner > 0 && G.features.winLine) sound.win();
      if (G.features.rank && mode !== 'auto' && mode !== 'lesson' && mode !== 'puzzle' && mode !== 'online' && game.winner > 0 && !recorded) setTimeout(openWinModal, 900);
      return;
    }
    scheduleAI();
  }

  /* ---------- 圍棋終局：虛手 → 確認死子 → 數子 ----------
     機器判死不可能 100% 準，所以這一階段的重點是「讓玩家能改」：
     點任何一塊棋就切換它的死活，比分即時跟著變。 */
  const scoring = { active: false, dead: new Set(), result: null };

  function enterScoring() {
    scoring.active = true;
    scoring.dead = new Set();
    scoring.result = null;
    setStatus('雙方虛手 — 正在判斷死子…');
    updateTopbar();
    render();
    // guessDead 要跑幾百盤模擬，丟到下一幀才跑，先讓「判斷中」畫得出來
    requestAnimationFrame(() => {
      if (!scoring.active) return;
      try {
        scoring.dead = window.GoAI.guessDead(game, { sims: 800 }).dead;
      } catch { scoring.dead = new Set(); }
      refreshScore();
    });
  }

  function refreshScore() {
    if (!scoring.active) return;
    scoring.result = E.score(game, scoring.dead);
    render();
    updateScoreBar();
    setStatus('確認死子：點棋子切換死活，確定後按「確認結算」');
  }

  function toggleDeadAt(gx, gy) {
    if (!scoring.active || game.board[gy][gx] === E.EMPTY) return;
    const grp = E.groupAt(game.board, SIZE, gx, gy);
    const makeDead = !scoring.dead.has(grp.stones[0]);
    for (const q of grp.stones) {
      if (makeDead) scoring.dead.add(q); else scoring.dead.delete(q);
    }
    sound.stone();
    refreshScore();
  }

  function updateScoreBar() {
    const bar = document.getElementById('score-bar');
    bar.classList.toggle('show', scoring.active && !!scoring.result);
    if (!scoring.active || !scoring.result) return;
    const r = scoring.result;
    const lead = r.diff > 0 ? `黑領先 ${r.diff} 目`
      : r.diff < 0 ? `白領先 ${-r.diff} 目` : '平手';
    document.getElementById('score-text').textContent =
      `黑 ${r.black}　白 ${r.white}（含貼目 ${r.komi}）　${lead}`;
  }

  function leaveScoring() {
    scoring.active = false;
    scoring.dead = new Set();
    scoring.result = null;
    updateScoreBar();
  }

  function finishScoring() {
    if (!scoring.active) return;
    const r = E.finalize(game, scoring.dead);
    const dead = scoring.dead;
    leaveScoring();
    scoring.result = r;           // 收局後仍留著明細供顯示
    scoring.dead = dead;
    render();
    setStatus(turnText());
    updateTopbar();
    sound.win();
    showScoreModal(r);
  }

  function resumeFromScoring() {
    if (!scoring.active) return;
    E.resumePlay(game);
    leaveScoring();
    render();
    setStatus(turnText());
    updateTopbar();
    scheduleAI();
  }

  function doPass() {
    if (!G.features.pass || !G.canMove(game) || busy || replay.active || intro.active) return;
    if (mode === 'ai' && game.current === aiSide) return;
    E.pass(game);
    hoverCell = null;
    hintCell = null;
    afterMove();
  }

  function doResign() {
    if (!G.features.pass || G.isOver(game) || replay.active) return;
    // 與電腦對戰時認輸的一定是玩家；雙人對戰時是當下輪到的一方
    const side = mode === 'ai' ? humanSide : game.current;
    const who = side === E.BLACK ? '黑棋' : '白棋';
    if (!confirm(`確定${who}認輸嗎？`)) return;
    cancelAI();
    leaveScoring();
    E.resign(game, side);
    render();
    setStatus(turnText());
    updateTopbar();
    showScoreModal(null);
  }

  function showScoreModal(r) {
    const t = document.getElementById('sc-title');
    const d = document.getElementById('sc-detail');
    if (!r || game.reason === 'resign') {
      t.textContent = `${game.winner === E.BLACK ? '黑棋' : '白棋'}獲勝`;
      d.innerHTML = '<p>對手認輸，對局結束。</p>';
    } else {
      const w = r.winner === E.BLACK ? '黑棋' : r.winner === E.WHITE ? '白棋' : '';
      t.textContent = r.winner === -1 ? '和局' : `${w}勝 ${Math.abs(r.diff)} 目`;
      d.innerHTML =
        '<table class="sc-table">' +
        '<tr><th>項目</th><th>黑</th><th>白</th></tr>' +
        `<tr><td>活子</td><td>${r.blackStones}</td><td>${r.whiteStones}</td></tr>` +
        `<tr><td>圍地</td><td>${r.blackTerritory}</td><td>${r.whiteTerritory}</td></tr>` +
        `<tr><td>貼目</td><td>—</td><td>${r.komi}</td></tr>` +
        `<tr class="sum"><td>合計</td><td>${r.black}</td><td>${r.white}</td></tr>` +
        '</table>' +
        `<p class="hint-text">中國規則數子：活子 ＋ 己方單獨圍住的空點。單官 ${r.dame} 點雙方都不計，` +
        `死子 黑 ${r.deadBlack}／白 ${r.deadWhite} 已從盤上扣除。</p>`;
    }
    openModal('modal-score');
  }

  document.getElementById('btn-pass').addEventListener('click', doPass);
  document.getElementById('btn-resign').addEventListener('click', doResign);
  document.getElementById('btn-score-done').addEventListener('click', finishScoring);
  document.getElementById('btn-score-resume').addEventListener('click', resumeFromScoring);
  document.getElementById('btn-score-close').addEventListener('click', () => closeModal('modal-score'));
  document.getElementById('btn-score-new').addEventListener('click', () => {
    closeModal('modal-score');
    openModal('modal-setup');
  });

  // 分時驅動 AI：每幀只算 28ms，讓瀏覽器有空重繪。
  // 圍棋的 MCTS 一手要想好幾秒，同步跑會把整個畫面凍住。
  function runAI(opts, onMove) {
    const search = G.aiSearch(game, opts);
    const tick = () => {
      aiRAF = null;
      if (!search.step(28)) { aiRAF = requestAnimationFrame(tick); return; }
      onMove(search.best());
    };
    aiRAF = requestAnimationFrame(tick);
  }

  // AI 的著手可能是虛手（圍棋）
  function applyAIMove(mv) {
    if (!mv) return false;
    if (mv.pass) { if (E.pass) E.pass(game); return true; }
    if (G.place(game, mv.x, mv.y)) { sound.stone(); fxAfterPlace(); return true; }
    return false;
  }

  function cancelAI() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (aiRAF) { cancelAnimationFrame(aiRAF); aiRAF = null; }
    busy = false;
  }

  function scheduleAI() {
    if (mode !== 'ai' || !G.canMove(game) || game.current !== aiSide) return;
    busy = true;
    setStatus('電腦思考中…');
    aiTimer = setTimeout(() => {
      aiTimer = null;
      runAI({ level: aiLevel }, (mv) => {
        applyAIMove(mv);
        busy = false;
        afterMove();
      });
    }, 380);
  }

  function tryPlace(gx, gy) {
    if (scoring.active) return toggleDeadAt(gx, gy);
    if (busy || !G.canMove(game) || mode === 'auto' || intro.active || replay.active) return;
    if (mode === 'online') return onlinePlace(gx, gy);
    if (mode === 'lesson' || mode === 'puzzle') return lessonPlace(gx, gy);
    if (mode === 'ai' && game.current === aiSide) return;
    if (G.place(game, gx, gy)) {
      sound.stone();
      fxAfterPlace();
      hoverCell = null;
      hintCell = null;
      afterMove();
    } else {
      const why = G.illegalReason(game, gx, gy);
      if (why) { sound.deny(); setStatus(why); }
    }
  }

  function doUndo() {
    if (replay.active) return exitReplay();
    cancelAI();
    if (scoring.active) leaveScoring();   // 確認死子時悔棋 = 退回對局並收回上一手虛手
    if (mode === 'auto') {
      if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
      auto.paused = true;
      auto.ended = false;
      resetCinematic();
      updateAutoUI();
    }
    if (mode === 'lesson' || mode === 'puzzle') return lessonUndo();
    if (mode === 'online') {
      if (!game.moves.length) return;
      G.undo(game);
      hintCell = null;
      if (net) net.send({ t: 'undo' });
      afterMove();
      return;
    }
    if (!game.moves.length) return;
    recorded = false;
    hintCell = null;
    G.undo(game);
    if (mode === 'ai' && game.current === aiSide && game.moves.length) G.undo(game);
    closeModal('modal-win');
    afterMove();
  }

  function newGame() {
    cancelAI();
    if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
    if (net) { try { net.close(); } catch {} net = null; } // 開始單機局即離線
    replay.active = false;
    lessonState.active = null;
    leaveScoring();
    closeModal('modal-score');
    game = G.newGame({ renju: renjuOn && mode !== 'auto', size: SIZE });
    applyBoardSize(game.board.length);   // 盤面大小以實際建出來的棋局為準
    applyView();                          // 相機距離隨盤面大小重算
    recorded = false;
    hoverCell = null;
    hintCell = null;
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
    // 觀戰模式雙方都用單手啟發式（depth: 0）：保持原作的強弱平衡，
    // 大哥太強的話對手永遠贏不了，時間倒轉與結局彩蛋就不會觸發
    const mv = E.aiMove(game, isBoss ? { depth: 0 } : { jitter: 1, pool: 4 });
    if (mv) { E.place(game, mv.x, mv.y); sound.stone(); fxAfterPlace(); }
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

  /* ---------- 開場動畫（霓虹 Tron 風，首次進入播 6 秒） ---------- */
  const INTRO_KEY = 'gomoku3d-intro-neon'; // 換鍵：舊訪客會再看到一次新版霓虹開場
  const intro = { active: false, t0: 0 };
  const NEON_CYAN = '#38e8ff', NEON_MAG = '#c368ff', NEON_GRN = '#54ffb0';

  // 霓虹發光線：粗半透明底層 + 細亮核心，模擬輝光（不依賴 SVG filter）
  function neonLine(a, b, color, w, glowOp, coreOp) {
    return line3d(a[0], a[1], a[2], b[0], b[1], b[2],
      `stroke="${color}" stroke-width="${(w * 3.4).toFixed(1)}" stroke-linecap="round" opacity="${glowOp.toFixed(2)}"`) +
      line3d(a[0], a[1], a[2], b[0], b[1], b[2],
        `stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${coreOp.toFixed(2)}"`);
  }

  function renderNeonIntro() {
    const time = (performance.now() - intro.t0) / 1000;
    const prog = Math.min(1, time / 6);

    /* 背景：深空黑 + 地平線輝光帶 */
    const horizon = Math.max(0, Math.min(H, CY - F * Math.tan(cam.pitch)));
    let bg = `<rect x="0" y="0" width="${W}" height="${H}" fill="#05070e"/>`;
    bg += `<rect x="0" y="${(horizon - 70).toFixed(1)}" width="${W}" height="140" fill="url(#g-neon-horizon)" opacity="0.75"/>`;
    layers.bg.innerHTML = bg;

    let s = '';
    /* 地板霓虹網格 */
    const EXT = 24, STEP = 2;
    for (let i = -EXT; i <= EXT; i += STEP) {
      const fade = Math.max(0.05, 1 - Math.abs(i) / (EXT + 4));
      s += neonLine([i, 0.02, -EXT], [i, 0.02, EXT], NEON_CYAN, 1.1, 0.14 * fade, 0.6 * fade);
      s += neonLine([-EXT, 0.02, i], [EXT, 0.02, i], NEON_CYAN, 1.1, 0.14 * fade, 0.6 * fade);
    }
    /* 能量方環：從中心向外擴散的方形脈衝 */
    for (let k = 0; k < 5; k++) {
      const r = (time * 5 + k * 3.2) % 16;
      if (r < 0.4) continue;
      const col = k % 2 ? NEON_MAG : NEON_GRN;
      const a = Math.max(0, 1 - r / 16);
      const c = [[-r, 0.03, -r], [r, 0.03, -r], [r, 0.03, r], [-r, 0.03, r]];
      for (let e = 0; e < 4; e++) s += neonLine(c[e], c[(e + 1) % 4], col, 1.4, 0.18 * a, 0.85 * a);
    }
    /* 棋盤四角光柱（脈動） */
    const B = BOARD_HALF;
    const pulse = 4 + 2 * Math.sin(time * 3);
    for (const [cx, cz] of [[-B, -B], [B, -B], [B, B], [-B, B]]) {
      s += neonLine([cx, 0, cz], [cx, pulse, cz], NEON_MAG, 1.6, 0.16, 0.8);
    }
    /* 棋盤通電浮現：15×15 內格 + 外框，後段亮起 */
    const gridA = Math.max(0, (prog - 0.25) / 0.75);
    if (gridA > 0) {
      for (let i = 0; i < SIZE; i++) {
        const w = gx2w(i);
        s += neonLine([w, 0.04, -HALF], [w, 0.04, HALF], NEON_CYAN, 1, 0.1 * gridA, 0.8 * gridA);
        s += neonLine([-HALF, 0.04, w], [HALF, 0.04, w], NEON_CYAN, 1, 0.1 * gridA, 0.8 * gridA);
      }
      const ob = [[-B, 0.05, -B], [B, 0.05, -B], [B, 0.05, B], [-B, 0.05, B]];
      for (let e = 0; e < 4; e++) s += neonLine(ob[e], ob[(e + 1) % 4], NEON_GRN, 2, 0.22 * gridA, gridA);
    }
    layers.board.innerHTML = s;
    layers.stones.innerHTML = '';
    layers.fx.innerHTML = '';
  }

  const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2);

  function playIntro() {
    intro.active = true;
    intro.t0 = performance.now();
    document.getElementById('intro-title').classList.add('show', 'neon');
    setStatus('系統啟動中……');
    requestAnimationFrame(introFrame);
  }
  function introFrame(now) {
    if (!intro.active) return;
    const t = Math.min(1, (now - intro.t0) / 6000);
    const e = easeIO(t);
    // 只做平順的俯衝入座，不旋轉（避免暈眩）；yaw 固定、僅極輕微收斂
    const near = BOARD_HALF * DIST_K, far = near * 2.96;
    cam.dist = far - (far - near) * e;
    cam.pitch = 1.05 - (1.05 - 0.52) * e;
    cam.yaw = (1 - e) * 0.12;
    render();
    if (t >= 1) endIntro();
    else requestAnimationFrame(introFrame);
  }
  function endIntro() {
    if (!intro.active) return;
    intro.active = false;
    document.getElementById('intro-title').classList.remove('show', 'neon');
    try { localStorage.setItem(INTRO_KEY, '1'); } catch {}
    applyView();   // 落回使用者保存的視角（含 2D／鎖定狀態）並重繪
    setStatus('選擇模式開始對局');
    openModal('modal-setup');
  }

  /* ---------- 視角操作（拖曳/縮放/點擊） ---------- */
  const pointers = new Map();
  let dragging = false, tapStart = null, pinchDist = 0, viewDirty = false;

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
      if (pinchDist > 0 && canOrbit()) {
        view.dist = view.dist * pinchDist / nd;
        applyView();
        viewDirty = true;
      }
      pinchDist = nd;
      return;
    }
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 7) {
      // dragging 旗標即使在鎖定／2D 也要立起來：它同時負責「這一下是拖曳不是點擊」，
      // 否則手指滑過棋盤放開就會意外落子。
      dragging = true;
      if (canOrbit()) svg.classList.add('dragging');
    }
    if (dragging && canOrbit()) {
      view.yaw -= dx * 0.005;
      view.pitch = view.pitch + dy * 0.004;
      applyView();
      viewDirty = true;
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
      // 手勢結束才寫 localStorage，拖曳過程不要每幀寫一次
      if (viewDirty) { viewDirty = false; saveView(); }
    }
    tapStart = null;
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', (e) => {
    if (!canOrbit()) return;   // 鎖定／2D 時不攔截滾輪，讓瀏覽器照常處理
    e.preventDefault();
    view.dist = view.dist * (e.deltaY > 0 ? 1.08 : 0.93);
    applyView();
    saveView();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (replay.active) {
      if (e.key === 'ArrowLeft') return setReplayIndex(replay.index - 1);
      if (e.key === 'ArrowRight') return setReplayIndex(replay.index + 1);
      if (e.key === 'Escape') return exitReplay();
    }
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
  // 程式性地把某個 seg 切到指定選項（換棋種時要收拾不適用的選擇）
  function selectSeg(id, key, value) {
    const seg = document.getElementById(id);
    if (!seg) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[key] === String(value)));
  }

  let setupGameId = 'gomoku';
  let setupSize = GAMES.gomoku.defaultSize;

  // 依「目前選的棋種 × 目前選的模式」決定哪些欄位該出現
  function refreshSetupFields() {
    const cfg = GAMES[setupGameId];
    const autoBtn = document.querySelector('#seg-mode button[data-mode="auto"]');
    if (autoBtn) autoBtn.style.display = cfg.features.auto ? '' : 'none';
    // 「電腦對電腦」是五子棋專屬的觀戰模式，換到圍棋要把它收起來並退回雙人對戰
    if (!cfg.features.auto && setupMode === 'auto') {
      setupMode = 'pvp';
      selectSeg('seg-mode', 'mode', 'pvp');
    }
    document.getElementById('field-board').style.display = cfg.sizes.length > 1 ? '' : 'none';
    document.getElementById('field-side').style.display = setupMode === 'ai' ? '' : 'none';
    document.getElementById('field-level').style.display = setupMode === 'ai' ? '' : 'none';
    document.getElementById('field-rules').style.display =
      (cfg.features.renju && setupMode !== 'auto') ? '' : 'none';
    document.getElementById('auto-desc').style.display =
      (setupMode === 'auto' && cfg.features.auto) ? '' : 'none';
    setLevelDesc();
  }

  segInit('seg-game', (btn) => {
    setupGameId = btn.dataset.game;
    setupSize = GAMES[setupGameId].defaultSize;
    selectSeg('seg-size', 'size', setupSize);
    refreshSetupFields();
  });
  segInit('seg-size', (btn) => { setupSize = +btn.dataset.size; });
  segInit('seg-mode', (btn) => {
    setupMode = btn.dataset.mode;
    refreshSetupFields();
  });
  segInit('seg-side', (btn) => {
    humanSide = +btn.dataset.side;
    aiSide = humanSide === E.BLACK ? E.WHITE : E.BLACK;
  });
  // 難度說明依棋種不同（同樣叫「困難」，兩種棋的內涵差很多）
  const setLevelDesc = () => {
    const d = (GAMES[setupGameId] || G).levelDesc || {};
    document.getElementById('level-desc').textContent = d[aiLevel] || '';
  };
  segInit('seg-level', (btn) => { aiLevel = btn.dataset.level; setLevelDesc(); });
  refreshSetupFields();

  // 切換棋種：換引擎、換盤面大小、換標題與功能鈕
  function applyGameConfig(id, size) {
    G = GAMES[id] || GAMES.gomoku;
    E = G.engine;
    applyBoardSize(G.sizes.indexOf(size) >= 0 ? size : G.defaultSize);
    document.title = G.docTitle;
    const h = document.getElementById('app-title');
    if (h) h.textContent = G.heading;
    applyFeatureVisibility();
  }

  document.getElementById('btn-start').addEventListener('click', () => {
    mode = setupMode;
    renjuOn = document.getElementById('chk-renju').checked;
    applyGameConfig(setupGameId, setupSize);
    closeModal('modal-setup');
    newGame();
  });
  document.getElementById('btn-new').addEventListener('click', () => {
    if (mode === 'online' && net && net.open) {
      onlineReset();
      net.send({ t: 'new' });
      setStatus('已重新開局（雙方同步）');
      return;
    }
    openModal('modal-setup');
  });
  document.getElementById('btn-undo').addEventListener('click', doUndo);

  /* ---------- 棋譜回放 ---------- */
  function setReplayIndex(i) {
    replay.index = Math.max(0, Math.min(game.moves.length, i));
    replay.board = G.replayBoard(game, replay.index);
    document.getElementById('rp-pos').textContent = `${replay.index}/${game.moves.length}`;
    render();
    setStatus(`回放中：第 ${replay.index}/${game.moves.length} 手`);
  }
  function enterReplay() {
    if (!game.moves.length) return;
    replay.active = true;
    hoverCell = null;
    setReplayIndex(0);
    updateTopbar();
  }
  function exitReplay() {
    replay.active = false;
    render();
    setStatus(turnText());
    updateTopbar();
  }
  document.getElementById('btn-replay').addEventListener('click', enterReplay);
  document.getElementById('rp-first').addEventListener('click', () => setReplayIndex(0));
  document.getElementById('rp-prev').addEventListener('click', () => setReplayIndex(replay.index - 1));
  document.getElementById('rp-next').addEventListener('click', () => setReplayIndex(replay.index + 1));
  document.getElementById('rp-last').addEventListener('click', () => setReplayIndex(game.moves.length));
  document.getElementById('rp-close').addEventListener('click', exitReplay);

  /* ---------- 教練模式與提示 ---------- */
  document.getElementById('btn-coach').addEventListener('click', () => {
    coachOn = !coachOn;
    coachCache.key = '';
    updateTopbar();
    render();
    if (coachOn) setStatus('教練模式開啟：棋盤標出雙方威脅點');
  });
  document.getElementById('btn-heat').addEventListener('click', () => {
    heatOn = !heatOn;
    heatCache.key = '';
    updateTopbar();
    render();
    if (heatOn) setStatus('AI 熱力圖：顏色越紅代表 AI 越想下該點（白環為首選）');
  });
  document.getElementById('btn-hint').addEventListener('click', () => {
    if (game.winner || busy || replay.active || intro.active || lessonState.busyAI) return;
    if (mode === 'ai' && game.current === aiSide) return;
    if (mode === 'auto') return;
    setStatus('分析中…');
    setTimeout(() => {
      const mv = E.aiMove(game, { level: 'hard' });
      if (mv) {
        hintCell = mv;
        render();
        setStatus(mode === 'lesson' ? '金色標記是建議的下一手' : '提示：金色標記是建議的下一手');
      }
    }, 30);
  });
  document.getElementById('btn-sound').addEventListener('click', () => {
    sound.toggle();
    updateTopbar();
  });
  document.getElementById('btn-view').addEventListener('click', toggleViewMode);
  document.getElementById('btn-recenter').addEventListener('click', recenterView);
  document.getElementById('btn-lock').addEventListener('click', toggleViewLock);
  document.getElementById('btn-fx').addEventListener('click', () => {
    fxOn = !fxOn;
    try { localStorage.setItem('gomoku3d-fx', fxOn ? '1' : '0'); } catch {}
    if (!fxOn) { fxList.length = 0; if (fxRAF) { cancelAnimationFrame(fxRAF); fxRAF = null; } }
    updateTopbar();
    render();
    setStatus(fxOn ? '落子特效已開啟' : '落子特效已關閉');
  });

  /* ---------- 教學關卡 ---------- */
  const LESSON_KEY = 'gomoku3d-lessons-done';
  function loadLessonDone() {
    try {
      const d = JSON.parse(localStorage.getItem(LESSON_KEY));
      return new Set(Array.isArray(d) ? d : []);
    } catch { return new Set(); }
  }
  function saveLessonDone(set) {
    try { localStorage.setItem(LESSON_KEY, JSON.stringify([...set])); } catch {}
  }

  function renderLessonList() {
    const done = loadLessonDone();
    document.getElementById('lesson-list').innerHTML = lessons
      .map((L, i) => `
        <button class="lesson-item${done.has(L.id) ? ' done' : ''}" data-i="${i}">
          <span class="lt">${done.has(L.id) ? '✓ ' : ''}${escapeHtml(L.subtitle)}｜${escapeHtml(L.title)}</span>
          <span class="ld">${escapeHtml(L.desc)}</span>
          ${L.tip ? `<span class="ltip">${escapeHtml(L.tip)}</span>` : ''}
        </button>`)
      .join('');
  }

  function renderTips() {
    const tips = lessons.tips || [];
    document.getElementById('tips-pane').innerHTML =
      '<p class="hint-text">看懂這幾招，新手也能贏。想動手練就切到「動手練習」。</p>' +
      tips.map((t, i) => `
        <div class="tip-card">
          <span class="tip-no">${i + 1}</span>
          <div><span class="tip-h">${escapeHtml(t.h)}</span><span class="tip-b">${escapeHtml(t.b)}</span></div>
        </div>`).join('');
  }

  function switchTeachTab(tab) {
    document.querySelectorAll('.teach-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    document.getElementById('tips-pane').style.display = tab === 'tips' ? '' : 'none';
    document.getElementById('drill-pane').style.display = tab === 'drill' ? '' : 'none';
  }
  document.querySelector('.teach-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.teach-tab');
    if (b) switchTeachTab(b.dataset.tab);
  });

  function lessonStatus() {
    const L = lessonState.active;
    setStatus(`【${L.title}】${L.goal} — 你執黑棋`);
  }

  function startLesson(i) {
    const L = lessons[i];
    if (!L) return;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
    busy = false;
    mode = 'lesson';
    lessonState.idx = i;
    lessonState.active = L;
    lessonState.moves = 0;
    lessonState.busyAI = false;
    replay.active = false;
    game = E.createGame();
    for (const [x, y] of L.setup) E.place(game, x, y);
    recorded = true; // 教學局不進排行榜
    hoverCell = null;
    hintCell = null;
    resetCinematic();
    updateAutoUI();
    closeModal('modal-lessons');
    closeModal('modal-lesson-done');
    render();
    lessonStatus();
    updateTopbar();
  }

  function lessonPlace(gx, gy) {
    if (lessonState.busyAI || !lessonState.active) return;
    const L = lessonState.active;
    if (!E.place(game, gx, gy)) return;
    sound.stone();
    fxAfterPlace();
    hoverCell = null;
    hintCell = null;
    lessonState.moves++;
    render();
    if (game.winner === E.BLACK) return lessonComplete();
    // 判題：這一手之後對手（白）必須仍是必敗，且未超過步數上限
    const stillWinning = E.forcedLoss(game, L.checkDepth);
    if (!stillWinning || lessonState.moves > L.maxMoves) {
      sound.deny();
      setStatus(stillWinning ? '超過本關步數上限了，退回重試' : '這一手讓必勝機會溜走了，退回重試（可按「提示」）');
      lessonState.busyAI = true;
      setTimeout(() => {
        E.undo(game);
        lessonState.moves--;
        lessonState.busyAI = false;
        render();
      }, 1100);
      return;
    }
    // 對手全力防守
    lessonState.busyAI = true;
    setStatus('對手防守中…');
    setTimeout(() => {
      const mv = E.aiMove(game, { level: 'hard' });
      if (mv) { E.place(game, mv.x, mv.y); sound.stone(); fxAfterPlace(); }
      lessonState.busyAI = false;
      render();
      if (game.winner === E.BLACK) return lessonComplete();
      lessonStatus();
    }, 480);
  }

  function lessonUndo() {
    if (lessonState.busyAI || !lessonState.active) return;
    const base = lessonState.active.setup.length;
    // 退回到玩家回合（一次退掉白的回應與玩家的一手）
    while (game.moves.length > base && game.current !== E.BLACK) E.undo(game);
    if (game.moves.length > base) {
      E.undo(game);
      lessonState.moves = Math.max(0, lessonState.moves - 1);
    }
    hintCell = null;
    render();
    lessonStatus();
  }

  function lessonComplete() {
    const L = lessonState.active;
    sound.win();
    render();
    if (L.kind === 'puzzle') return puzzleComplete(L);
    const done = loadLessonDone();
    done.add(L.id);
    saveLessonDone(done);
    setStatus(`【${L.title}】過關！`);
    document.getElementById('ld-title').textContent = `過關！${L.title}`;
    document.getElementById('ld-text').textContent = L.explain;
    document.getElementById('ld-next').style.display = lessonState.idx + 1 < lessons.length ? '' : 'none';
    document.getElementById('ld-next').textContent = '下一關';
    document.getElementById('ld-list').textContent = '關卡列表';
    lessonState.completeKind = 'lesson';
    setTimeout(() => openModal('modal-lesson-done'), 700);
  }

  document.getElementById('btn-lessons').addEventListener('click', () => {
    renderTips();
    renderLessonList();
    switchTeachTab('tips');
    openModal('modal-lessons');
  });
  document.getElementById('btn-lessons-close').addEventListener('click', () => closeModal('modal-lessons'));
  document.getElementById('lesson-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.lesson-item');
    if (btn) startLesson(+btn.dataset.i);
  });
  document.getElementById('ld-next').addEventListener('click', () => {
    closeModal('modal-lesson-done');
    if (lessonState.completeKind === 'puzzle') return startPractice(lessonState.active.tier);
    startLesson(lessonState.idx + 1);
  });
  document.getElementById('ld-list').addEventListener('click', () => {
    closeModal('modal-lesson-done');
    if (lessonState.completeKind === 'puzzle') { openPuzzleMenu(); return; }
    renderLessonList();
    openModal('modal-lessons');
  });

  /* ---------- 殘局謎題（每日 + 練習） ---------- */
  const puzzlesApi = typeof GomokuPuzzles !== 'undefined' ? GomokuPuzzles : null;
  const PUZZLE_KEY = 'gomoku3d-puzzles-solved';
  let practiceSeed = 1;

  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function loadSolved() {
    try { return JSON.parse(localStorage.getItem(PUZZLE_KEY)) || {}; } catch { return {}; }
  }
  function saveSolved(obj) {
    try { localStorage.setItem(PUZZLE_KEY, JSON.stringify(obj)); } catch {}
  }

  function openPuzzleMenu() {
    if (!puzzlesApi) return;
    const today = todayStr();
    const tier = puzzlesApi.dailyTier(today);
    const label = puzzlesApi.TIERS[tier].label;
    const solved = loadSolved();
    document.getElementById('daily-info').textContent =
      `${today}（難度：${label}）${solved[today] ? ' ✓ 今日已破解' : ''}`;
    document.getElementById('puzzle-msg').textContent = '';
    openModal('modal-puzzles');
  }

  // 產生中：鎖住選單、顯示訊息，async 完成後 startPuzzle
  function generatingUI(msg) {
    document.getElementById('puzzle-msg').textContent = msg;
    document.querySelectorAll('#modal-puzzles button[data-puzzle]').forEach((b) => (b.disabled = true));
  }
  function generatingDone() {
    document.querySelectorAll('#modal-puzzles button[data-puzzle]').forEach((b) => (b.disabled = false));
  }

  function startDaily() {
    if (!puzzlesApi) return;
    const today = todayStr();
    generatingUI('生成今日謎題中…');
    puzzlesApi.dailyAsync(today, (p) => {
      generatingDone();
      if (!p) { document.getElementById('puzzle-msg').textContent = '今日謎題生成失敗，請改試練習題'; return; }
      closeModal('modal-puzzles');
      const label = puzzlesApi.TIERS[p.tier].label;
      startPuzzle(p, { isDaily: true, dateStr: today, title: `每日謎題 ${today}（${label}）` });
    });
  }

  function startPractice(tier) {
    if (!puzzlesApi) return;
    const t = tier || 'medium';
    const label = puzzlesApi.TIERS[t].label;
    generatingUI(`生成${label}練習題中…`);
    const seed = (Date.now() + (practiceSeed++) * 7919) >>> 0;
    puzzlesApi.generateAsync(seed, t, (p) => {
      generatingDone();
      if (!p) { document.getElementById('puzzle-msg').textContent = '生成失敗，再試一次'; return; }
      closeModal('modal-puzzles');
      startPuzzle(p, { isDaily: false, title: `${label}練習題` });
    });
  }

  function startPuzzle(puzzle, meta) {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
    busy = false;
    mode = 'puzzle';
    replay.active = false;
    lessonState.active = {
      kind: 'puzzle',
      title: meta.title,
      goal: `${puzzle.K} 手內找出殺著取勝`,
      explain: '漂亮，你找到了致勝殺法！' + (meta.isDaily ? '（每日謎題完成，明天再來挑戰新題）' : ''),
      setup: puzzle.moves.map((m) => [m.x, m.y]),
      checkDepth: puzzle.depth,
      maxMoves: puzzle.K,
      isDaily: meta.isDaily,
      dateStr: meta.dateStr,
      tier: puzzle.tier,
    };
    lessonState.moves = 0;
    lessonState.busyAI = false;
    game = E.createGame();
    for (const [x, y] of lessonState.active.setup) E.place(game, x, y);
    recorded = true;
    hoverCell = null;
    hintCell = null;
    resetCinematic();
    updateAutoUI();
    render();
    lessonStatus();
    updateTopbar();
  }

  function puzzleComplete(L) {
    if (L.isDaily && L.dateStr) {
      const solved = loadSolved();
      solved[L.dateStr] = true;
      saveSolved(solved);
    }
    setStatus(`【${L.title}】破解成功！`);
    document.getElementById('ld-title').textContent = '破解成功！';
    document.getElementById('ld-text').textContent = L.explain;
    document.getElementById('ld-next').style.display = '';
    document.getElementById('ld-next').textContent = '再一題';
    document.getElementById('ld-list').textContent = '謎題選單';
    lessonState.completeKind = 'puzzle';
    setTimeout(() => openModal('modal-lesson-done'), 700);
  }

  document.getElementById('btn-puzzles').addEventListener('click', openPuzzleMenu);
  document.getElementById('btn-puzzles-close').addEventListener('click', () => closeModal('modal-puzzles'));
  document.getElementById('modal-puzzles').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-puzzle]');
    if (!btn) return;
    const kind = btn.dataset.puzzle;
    if (kind === 'daily') startDaily();
    else startPractice(kind);
  });

  /* ---------- 開局定式圖鑑 ---------- */
  const openings = typeof GomokuOpenings !== 'undefined' ? GomokuOpenings : [];
  let openingSel = 0;

  function renderOpeningList() {
    const groups = [['direct', '直接型（白 2 下在正上方）'], ['indirect', '間接型（白 2 下在右上斜角）']];
    let html = '';
    for (const [type, label] of groups) {
      html += `<div class="op-group">${label}</div>`;
      openings.forEach((o, i) => {
        if (o.type !== type) return;
        html += `<button class="op-item${i === openingSel ? ' on' : ''}" data-i="${i}">` +
          `<span class="op-name">${o.star ? '★ ' : ''}${escapeHtml(o.name)}</span>` +
          `<span class="op-ev ${evClass(o.ev)}">${escapeHtml(o.ev)}</span></button>`;
      });
    }
    document.getElementById('opening-list').innerHTML = html;
  }

  function evClass(ev) {
    if (ev.indexOf('黑必勝') === 0) return 'ev-bw';
    if (ev.indexOf('白必勝') === 0) return 'ev-ww';
    if (ev.indexOf('黑') === 0) return 'ev-b';
    if (ev.indexOf('白') === 0) return 'ev-w';
    return 'ev-even';
  }

  // 小型 2D 棋形預覽（中心 ±3 = 7×7 區域，標示手數）
  function openingBoardSvg(o) {
    const R = 3, N = 2 * R + 1, CELL = 42, PAD = 24;
    const sz = PAD * 2 + (N - 1) * CELL;
    const gx = (dx) => PAD + (dx + R) * CELL;
    let s = `<svg viewBox="0 0 ${sz} ${sz}" class="op-board">`;
    s += `<rect x="0" y="0" width="${sz}" height="${sz}" rx="8" fill="#c9963f"/>`;
    for (let i = 0; i < N; i++) {
      const p = PAD + i * CELL;
      s += `<line x1="${PAD}" y1="${p}" x2="${sz - PAD}" y2="${p}" stroke="#5a3d1a" stroke-width="1.2"/>`;
      s += `<line x1="${p}" y1="${PAD}" x2="${p}" y2="${sz - PAD}" stroke="#5a3d1a" stroke-width="1.2"/>`;
    }
    s += `<circle cx="${gx(0)}" cy="${gx(0)}" r="3.5" fill="#5a3d1a"/>`; // 天元星位
    o.moves.forEach((m, idx) => {
      const isBlack = idx % 2 === 0;
      const cx = gx(m[0]), cy = gx(m[1]);
      s += `<circle cx="${cx}" cy="${cy}" r="${CELL * 0.42}" fill="url(#g-${isBlack ? 'black' : 'white'})" stroke="#0006" stroke-width="1"/>`;
      s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="700" fill="${isBlack ? '#fff' : '#111'}">${idx + 1}</text>`;
    });
    s += '</svg>';
    return s;
  }

  function renderOpeningDetail() {
    const o = openings[openingSel];
    if (!o) return;
    const el = document.getElementById('opening-detail');
    el.innerHTML =
      openingBoardSvg(o) +
      `<div class="op-info">` +
      `<h3>${escapeHtml(o.name)} <small>${escapeHtml(o.jp)}</small></h3>` +
      `<div class="op-tags"><span class="op-tag">${o.typeLabel}型 第 ${o.no} 號</span>` +
      `<span class="op-tag ${evClass(o.ev)}">${escapeHtml(o.ev)}</span></div>` +
      `<p>黑1 天元 → 白2 → 黑3。${o.note ? escapeHtml(o.note) : ''}</p>` +
      `<p class="op-fine">評價為連珠標準規則（含禁手）下的理論結論，供認識棋形參考，與本遊戲實戰勝負無必然關係。</p>` +
      `<button class="primary" id="btn-play-opening">從此局面開始對弈（你執黑）</button>` +
      `</div>`;
    document.getElementById('btn-play-opening').addEventListener('click', () => startFromOpening(o));
  }

  function selectOpening(i) {
    openingSel = i;
    renderOpeningList();
    renderOpeningDetail();
  }

  function startFromOpening(o) {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
    busy = false;
    mode = 'ai';
    humanSide = E.BLACK; aiSide = E.WHITE;
    replay.active = false;
    lessonState.active = null;
    game = E.createGame({ renju: renjuOn });
    for (const [dx, dy] of o.moves) E.place(game, 7 + dx, 7 + dy);
    recorded = false;
    hoverCell = null;
    hintCell = null;
    startTime = Date.now();
    resetCinematic();
    updateAutoUI();
    closeModal('modal-openings');
    setStatus(`「${o.name}」開局 — 電腦將接第 4 手，你執黑`);
    afterMove(); // 目前輪到白＝aiSide，會自動接手
  }

  document.getElementById('btn-openings').addEventListener('click', () => {
    if (!openings.length) return;
    renderOpeningList();
    renderOpeningDetail();
    openModal('modal-openings');
  });
  document.getElementById('btn-openings-close').addEventListener('click', () => closeModal('modal-openings'));
  document.getElementById('opening-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.op-item');
    if (btn) selectOpening(+btn.dataset.i);
  });

  /* ---------- 線上對戰（WebRTC P2P，邀請碼／回應碼手動互換） ---------- */
  const NET = typeof GomokuNet !== 'undefined' ? GomokuNet : null;

  function onlineHandlers(sideOnOpen) {
    return {
      onOpen: () => onlineConnected(sideOnOpen),
      onMessage: onNetMessage,
      onClose: onlineDisconnect,
    };
  }

  function onlineConnected(side) {
    mySide = side;
    mode = 'online';
    busy = false;
    replay.active = false;
    lessonState.active = null;
    game = E.createGame(); // 線上不啟用禁手，避免兩端判定不一致
    recorded = true;
    hoverCell = null;
    hintCell = null;
    startTime = Date.now();
    resetCinematic();
    updateAutoUI();
    closeModal('modal-online');
    render();
    updateTopbar();
    setStatus(side === E.BLACK ? '已連線！你執黑，請先下' : '已連線！你執白，等黑方落子');
  }

  function onlinePlace(gx, gy) {
    if (!net || !net.open) { setStatus('尚未連線'); return; }
    if (game.current !== mySide) { setStatus('現在是對方的回合'); return; }
    if (E.place(game, gx, gy)) {
      sound.stone();
      fxAfterPlace();
      hoverCell = null;
      hintCell = null;
      net.send({ t: 'move', x: gx, y: gy });
      afterMove();
    }
  }

  function onNetMessage(m) {
    if (!m || mode !== 'online') return;
    if (m.t === 'move') {
      if (game.winner) return;
      if (game.current === mySide) return; // 只接受對方回合的落子
      if (E.place(game, m.x, m.y)) { sound.stone(); fxAfterPlace(); afterMove(); }
    } else if (m.t === 'undo') {
      if (game.moves.length) { E.undo(game); afterMove(); }
    } else if (m.t === 'new') {
      onlineReset();
    }
  }

  function onlineReset() {
    game = E.createGame();
    recorded = true;
    hoverCell = null;
    hintCell = null;
    render();
    setStatus(turnText());
    updateTopbar();
  }

  let disconnecting = false;
  function onlineDisconnect() {
    if (mode !== 'online' && !net) return;
    if (disconnecting) return;
    disconnecting = true;
    try { if (net) net.close(); } catch {}
    net = null;
    if (mode === 'online') {
      mode = 'pvp';
      setStatus('連線已結束，回到單機。可從「連線」重新配對。');
      updateTopbar();
    }
    resetOnlineUI();
    setTimeout(() => { disconnecting = false; }, 300);
  }

  function resetOnlineUI() {
    const connected = net && net.open;
    document.getElementById('online-choose').style.display = connected ? 'none' : '';
    document.getElementById('online-host').style.display = 'none';
    document.getElementById('online-guest').style.display = 'none';
    document.getElementById('online-connected').style.display = connected ? '' : 'none';
    ['host-offer', 'host-answer', 'guest-offer', 'guest-answer'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('online-msg').textContent = '';
  }

  function openOnlineMenu() {
    if (!NET || !NET.supported) {
      resetOnlineUI();
      document.getElementById('online-msg').textContent = '此瀏覽器不支援 WebRTC，無法線上對戰。';
      openModal('modal-online');
      return;
    }
    resetOnlineUI();
    openModal('modal-online');
  }

  const onlineMsg = (t) => (document.getElementById('online-msg').textContent = t);

  document.getElementById('btn-online').addEventListener('click', openOnlineMenu);
  document.getElementById('btn-online-close').addEventListener('click', () => closeModal('modal-online'));

  document.getElementById('btn-host').addEventListener('click', async () => {
    try {
      onlineMsg('產生邀請碼中…');
      net = await NET.host(onlineHandlers(E.BLACK));
      document.getElementById('online-choose').style.display = 'none';
      document.getElementById('online-host').style.display = '';
      document.getElementById('host-offer').value = net.offerCode;
      onlineMsg('把「邀請碼」傳給朋友，等他回傳「回應碼」貼在下面。');
    } catch (e) { onlineMsg('建立失敗：' + e.message); }
  });
  document.getElementById('host-connect').addEventListener('click', async () => {
    const code = document.getElementById('host-answer').value.trim();
    if (!code) return onlineMsg('請先貼上朋友的回應碼');
    try { onlineMsg('連線中…'); await net.acceptAnswer(code); }
    catch (e) { onlineMsg('回應碼無效或連線失敗：' + e.message); }
  });

  document.getElementById('btn-guest').addEventListener('click', () => {
    document.getElementById('online-choose').style.display = 'none';
    document.getElementById('online-guest').style.display = '';
    onlineMsg('貼上朋友給你的邀請碼，再按「產生回應碼」。');
  });
  document.getElementById('guest-gen').addEventListener('click', async () => {
    const code = document.getElementById('guest-offer').value.trim();
    if (!code) return onlineMsg('請先貼上朋友的邀請碼');
    try {
      onlineMsg('產生回應碼中…');
      net = await NET.join(code, onlineHandlers(E.WHITE));
      document.getElementById('guest-answer').value = net.answerCode;
      onlineMsg('把「回應碼」傳回給朋友，他貼上後就會連線。');
    } catch (e) { onlineMsg('邀請碼無效：' + e.message); }
  });

  function copyField(id, okMsg) {
    const ta = document.getElementById(id);
    ta.select();
    const text = ta.value;
    const done = () => onlineMsg(okMsg);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => { try { document.execCommand('copy'); done(); } catch {} });
    } else { try { document.execCommand('copy'); done(); } catch {} }
  }
  document.getElementById('copy-offer').addEventListener('click', () => copyField('host-offer', '已複製邀請碼，傳給朋友吧！'));
  document.getElementById('copy-answer').addEventListener('click', () => copyField('guest-answer', '已複製回應碼，傳回給朋友吧！'));
  document.getElementById('btn-disconnect').addEventListener('click', () => { onlineDisconnect(); closeModal('modal-online'); });

  /* ---------- 啟動 ---------- */
  window.addEventListener('resize', resize);
  resize();
  applyGameConfig(setupGameId, setupSize);   // 標題與功能鈕同步預設棋種
  updateTopbar(); // 讓特效/音效等開關按鈕一開始就反映狀態
  applyView();    // 視角三顆鈕的文字/停用狀態同步保存的視角
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
    get mode() { return mode; },
    get gameId() { return G.id; },
    scoring,
    doPass, doResign, finishScoring, resumeFromScoring,
    get size() { return SIZE; },
    GAMES,
    applyGameConfig,
    get mySide() { return mySide; },
    get netOpen() { return !!(net && net.open); },
    screenPt: (gx, gy) => screenPts[gy] && screenPts[gy][gx],
    cam,
    view,
    applyView,
    render,
    auto,
    intro,
    flee,
    rewindTime,
    playMemeEnding,
    endIntro,
  };
})();
