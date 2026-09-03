/* 瀏覽器端 smoke 測試（Playwright headless）：node tests/browser-smoke.js [--shot <dir>]
 *
 * 為什麼常駐在 repo：頂列 UI、視角、渲染與效能這些東西只有真的開瀏覽器才驗得到。
 * 過去每次改版都在暫存區重寫一份一次性腳本，session 結束就被清掉，等於每次從零來過。
 * 這份把已驗證可用的流程固定下來當回歸測試。
 *
 * 只靠 id 與 window.__g3d 操作，不依賴頂列按鈕的文字或位置（頂列會改版）；
 * 按鈕看不見時改用 DOM click，所以按鈕被收進抽屜也不會壞。
 *
 * 環境（缺少時以 exit code 2 結束，與「測試失敗」的 exit 1 區分）：
 *   PLAYWRIGHT_MODULE   playwright 模組資料夾
 *   CHROME_PATH         chromium 執行檔
 * 可調門檻：
 *   SMOKE_PERF=0        跳過效能項目
 *   SMOKE_PERF_JS_MS    單次 render 的 JS 成本上限，毫秒（預設 8）
 *   SMOKE_PERF_FPS      rAF 連轉的 fps 下限（預設 50）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PW = 'C:/Users/Tommy/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright';
const DEFAULT_CHROME = 'C:/Users/Tommy/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const PW_PATH = process.env.PLAYWRIGHT_MODULE || DEFAULT_PW;
const CHROME = process.env.CHROME_PATH || DEFAULT_CHROME;
const PORTS = [8190, 8191, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199];

const PERF_ON = process.env.SMOKE_PERF !== '0';
const PERF_JS_MS = Number(process.env.SMOKE_PERF_JS_MS || 8);
const PERF_FPS = Number(process.env.SMOKE_PERF_FPS || 50);

const shotIdx = process.argv.indexOf('--shot');
const SHOT_DIR = shotIdx >= 0 ? process.argv[shotIdx + 1] : null;
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

/* ---------- 環境檢查：沒裝就 exit 2，不要偽裝成測試失敗 ---------- */
function envFail(msg) {
  console.error('\n環境不齊，無法執行瀏覽器測試：');
  console.error('  ' + msg);
  console.error('\n  需要 Playwright 模組與 chromium 執行檔，可用環境變數指定路徑：');
  console.error('    PLAYWRIGHT_MODULE=<playwright 模組資料夾>  目前：' + PW_PATH);
  console.error('    CHROME_PATH=<chromium 執行檔>              目前：' + CHROME);
  console.error('\n  安裝方式（本專案不裝 npm 依賴，用 npx 取得即可）：');
  console.error('    npx playwright@latest install chromium');
  console.error('\n  （exit code 2 = 環境沒裝；exit code 1 才是測試真的失敗）');
  process.exit(2);
}
let pw;
try {
  pw = require(PW_PATH);
} catch (e) {
  envFail('載入 playwright 失敗：' + e.message);
}
if (!fs.existsSync(CHROME)) envFail('找不到 chromium 執行檔：' + CHROME);

/* ---------- 測試輔助（沿用 tests/*.test.js 的風格） ---------- */
let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name); }
}
function eq(a, b, name) {
  const ok = a === b;
  if (!ok) console.error(`         期望 ${JSON.stringify(b)}，實得 ${JSON.stringify(a)}`);
  assert(ok, name);
}
function near(a, b, tol, name) {
  const ok = Number.isFinite(a) && Math.abs(a - b) <= tol;
  if (!ok) console.error(`         期望 ${b} ±${tol}，實得 ${a}`);
  assert(ok, name);
}
function section(title) { console.log('\n' + title); }

/* ---------- 本機靜態伺服器（服務 repo 目錄） ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.ico': 'image/x-icon',
};
function startServer() {
  const srv = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const p = path.join(ROOT, rel);
    // 不讓路徑跳出 repo（測試自己用，但別留一個目錄穿越的壞習慣）
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= PORTS.length) return reject(new Error('8190–8199 都被占用，無法起測試伺服器'));
      const port = PORTS[i++];
      srv.once('error', (err) => { if (err.code === 'EADDRINUSE') tryNext(); else reject(err); });
      srv.listen(port, '127.0.0.1', () => resolve({ srv, port }));
    };
    tryNext();
  });
}

/* ---------- 頁面操作輔助 ---------- */
const consoleErrors = [];   // 整場收集，最後一次 assert
function watchPage(page, label) {
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${label}] console.error: ${m.text()}`); });
}

// 按鈕看得見就用真的滑鼠點，看不見（例如被收進抽屜）就用 DOM click
async function tap(page, sel) {
  const el = await page.$(sel);
  if (!el) throw new Error('找不到元素：' + sel);
  if (await el.isVisible()) await el.click();
  else await page.$eval(sel, (e) => e.click());
}
async function shot(page, name) {
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
}
// 開頁 → 等 __g3d 就緒 → 跳過 6 秒開場 → 等開局視窗
async function boot(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__g3d, null, { timeout: 15000 });
  await page.evaluate(() => window.__g3d.endIntro && window.__g3d.endIntro());
  await page.waitForSelector('#modal-setup.show', { timeout: 5000 });
}
// 從開局視窗開一局（棋種／盤面／模式全部用 data-* 屬性選，不看文字）
async function startGame(page, { game, size, mode }) {
  await tap(page, `#seg-game button[data-game="${game}"]`);
  if (size) await tap(page, `#seg-size button[data-size="${size}"]`);
  await tap(page, `#seg-mode button[data-mode="${mode}"]`);
  await tap(page, '#btn-start');
  await page.waitForFunction(() => !document.querySelector('.modal.show'), null, { timeout: 5000 });
  await page.evaluate(() => window.__g3d.endIntro && window.__g3d.endIntro());
  await page.waitForFunction(() => window.__g3d.game && window.__g3d.game.moves.length === 0, null, { timeout: 5000 });
  await page.evaluate(() => window.__g3d.render());
}
// 點某個交叉點：每次都重抓 #scene 的位置再加上投影座標
async function clickPoint(page, gx, gy) {
  const p = await page.evaluate(([x, y]) => {
    const pt = window.__g3d.screenPt(x, y);
    if (!pt) return null;
    const b = document.getElementById('scene').getBoundingClientRect();
    return { x: b.x + pt.x, y: b.y + pt.y };
  }, [gx, gy]);
  if (!p) throw new Error(`交叉點 (${gx},${gy}) 沒有投影座標，可能盤面還沒渲染`);
  await page.mouse.click(p.x, p.y);
}
async function playSeq(page, seq) {
  let n = await page.evaluate(() => window.__g3d.game.moves.length);
  for (const [gx, gy] of seq) {
    await clickPoint(page, gx, gy);
    n += 1;
    await page.waitForFunction((k) => window.__g3d.game.moves.length === k, n, { timeout: 5000 });
  }
  return n;
}
// 拖曳 #scene（用來驗證鎖定視角），距離拉大避免被當成「點擊落子」
async function drag(page, dx) {
  const b = await page.evaluate(() => {
    const r = document.getElementById('scene').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const cx = b.x + b.w / 2, cy = b.y + b.h * 0.28;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + (dx * i) / 8, cy);
  await page.mouse.up();
  await page.waitForTimeout(80);
}
// 套用視角後重繪，並掃描 SVG 幾何屬性有沒有 NaN
// （投影一旦除出 NaN，畫面會靜默變空白、完全不噴錯，只能這樣抓）
async function renderAndScan(page, cfg) {
  return page.evaluate((c) => {
    Object.assign(window.__g3d.view, c);
    window.__g3d.applyView();
    window.__g3d.render();
    const bad = [];
    const els = document.querySelectorAll('#scene ellipse, #scene polygon, #scene path');
    for (const el of els) {
      for (const a of el.attributes) {
        if (a.value.indexOf('NaN') >= 0 || a.value.indexOf('Infinity') >= 0) {
          bad.push(el.tagName + '.' + a.name + '="' + a.value + '"');
        }
      }
    }
    return {
      bad: bad.slice(0, 5),
      scanned: els.length,
      board: document.getElementById('layer-board').childElementCount,
      stones: document.getElementById('layer-stones').childElementCount,
    };
  }, cfg);
}

/* ---------- 主流程 ---------- */
(async () => {
  const t0 = Date.now();
  const { srv, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  console.log(`測試伺服器 ${base}（repo：${ROOT}）`);
  // 解掉 vsync 與背景節流：預設 rAF 卡在螢幕更新率（約 60 fps），
  // 上限貼著門檻時只要機器忙一下就掉到門檻以下，測試會變成擲骰子。
  // 解掉上限之後量到的是「渲染管線一秒能跑幾輪」，是更穩也更靈敏的回歸訊號。
  const browser = await pw.chromium.launch({
    executablePath: CHROME,
    args: ['--disable-gpu-vsync', '--disable-frame-rate-limit',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  let ctx, page;
  try {
    ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
    page = await ctx.newPage();
    watchPage(page, '桌面');
    await boot(page, base + '/');

    /* ---- 2. 五子棋 15 路雙人：交替落 5 手 ---- */
    section('五子棋 15 路雙人');
    await startGame(page, { game: 'gomoku', mode: 'pvp' });
    eq(await page.evaluate(() => window.__g3d.size), 15, '五子棋盤面為 15 路');
    eq(await page.evaluate(() => window.__g3d.gameId), 'gomoku', '目前棋種是五子棋');
    // 黑 (7,7)(7,8)(7,9)、白 (3,3)(3,4)：三連不會提前分勝負
    const gseq = [[7, 7], [3, 3], [7, 8], [3, 4], [7, 9]];
    eq(await playSeq(page, gseq), 5, '交替點 5 手後棋譜有 5 手');
    const gboard = await page.evaluate((seq) => seq.map(([x, y]) => window.__g3d.game.board[y][x]), gseq);
    eq(gboard.join(','), '1,2,1,2,1', '5 手各自落在指定交叉點且黑白交替');
    const gmoves = await page.evaluate(() => window.__g3d.game.moves.map((m) => `${m.x},${m.y}`).join(' '));
    eq(gmoves, gseq.map((p) => p.join(',')).join(' '), '棋譜座標與點擊順序一致');
    await shot(page, '01-gomoku');

    /* ---- 3. 悔棋 ---- */
    section('悔棋');
    await tap(page, '#btn-undo');
    await page.waitForFunction(() => window.__g3d.game.moves.length < 5, null, { timeout: 5000 });
    const afterUndo = await page.evaluate(() => window.__g3d.game.moves.length);
    assert(afterUndo < 5, `悔棋後手數變少（5 → ${afterUndo}）`);
    const topEmpty = await page.evaluate(() => window.__g3d.game.board[9][7] === 0);
    assert(topEmpty, '最後一手的交叉點被清空');

    /* ---- 4. 圍棋 9 路雙人：提子 ---- */
    section('圍棋 9 路提子');
    await tap(page, '#btn-new');
    await page.waitForSelector('#modal-setup.show', { timeout: 5000 });
    await startGame(page, { game: 'go', size: '9', mode: 'pvp' });
    eq(await page.evaluate(() => window.__g3d.size), 9, '圍棋盤面為 9 路');
    // 黑 (4,4) 被白四面圍住；黑的其他手下在左邊不相干處
    await playSeq(page, [[4, 4], [3, 4], [0, 0], [5, 4], [0, 2], [4, 3], [0, 4], [4, 5]]);
    const cap = await page.evaluate(() => ({
      pt: window.__g3d.game.board[4][4],
      white: window.__g3d.game.captured ? window.__g3d.game.captured[2] : null,
      black: window.__g3d.game.captured ? window.__g3d.game.captured[1] : null,
      moves: window.__g3d.game.moves.length,
    }));
    eq(cap.moves, 8, '提子局面共下了 8 手');
    eq(cap.pt, 0, '被圍死的黑子所在點變成空點');
    eq(cap.white, 1, '白方提子數 +1');
    eq(cap.black, 0, '黑方提子數仍為 0');
    const stonesOnBoard = await page.evaluate(() =>
      window.__g3d.game.board.flat().filter((v) => v !== 0).length);
    eq(stonesOnBoard, 7, '盤上剩 7 顆（8 手扣掉被提的 1 顆）');
    await shot(page, '02-go-capture');

    /* ---- 5. 2D／3D 切換 ---- */
    section('2D／3D 視角切換');
    await tap(page, '#btn-view');
    await page.waitForFunction(() => window.__g3d.view.mode === '2d', null, { timeout: 3000 });
    eq(await page.evaluate(() => window.__g3d.view.mode), '2d', '切換後 view.mode 為 2d');
    assert(await page.evaluate(() => document.getElementById('scene').classList.contains('view-2d')),
      '#scene 帶上 view-2d 樣式');
    await shot(page, '03-2d');
    await tap(page, '#btn-view');
    await page.waitForFunction(() => window.__g3d.view.mode === '3d', null, { timeout: 3000 });
    eq(await page.evaluate(() => window.__g3d.view.mode), '3d', '再切一次回到 3d');
    assert(!(await page.evaluate(() => document.getElementById('scene').classList.contains('view-2d'))),
      '#scene 的 view-2d 樣式被移除');

    /* ---- 6. 回正與鎖定 ---- */
    section('回正與鎖定視角');
    await page.evaluate(() => { window.__g3d.view.yaw = 0.9; window.__g3d.view.dist = 1.6; window.__g3d.applyView(); });
    near(await page.evaluate(() => window.__g3d.view.yaw), 0.9, 1e-6, '先把 yaw 撥到 0.9');
    await tap(page, '#btn-recenter');
    const v = await page.evaluate(() => ({ ...window.__g3d.view }));
    near(v.yaw, 0, 1e-6, '回正後 yaw 回到預設 0');
    near(v.pitch, 0.52, 1e-6, '回正後 pitch 回到預設 0.52');
    near(v.dist, 1, 1e-6, '回正後 dist 回到預設 1');
    // 未鎖定時拖曳應該會轉動
    const yawBeforeFree = await page.evaluate(() => window.__g3d.view.yaw);
    await drag(page, 160);
    const yawAfterFree = await page.evaluate(() => window.__g3d.view.yaw);
    assert(Math.abs(yawAfterFree - yawBeforeFree) > 1e-3, '未鎖定時拖曳會改變 yaw（對照組）');
    // 鎖定後拖曳不該轉動
    await tap(page, '#btn-lock');
    assert(await page.evaluate(() => window.__g3d.view.locked === true), '按下鎖定後 view.locked 為 true');
    const yawLocked = await page.evaluate(() => window.__g3d.view.yaw);
    await drag(page, -160);
    near(await page.evaluate(() => window.__g3d.view.yaw), yawLocked, 1e-9, '鎖定後拖曳不改變 yaw');
    await tap(page, '#btn-lock');
    assert(await page.evaluate(() => window.__g3d.view.locked === false), '再按一次解除鎖定');
    await tap(page, '#btn-recenter');

    /* ---- 7. 渲染健全性 ---- */
    section('渲染健全性（各視角皆無 NaN）');
    // 極端值取自 main.js clampView()：pitch 0.18–1.35、dist 0.45–2.2
    const views = [
      ['3D 預設視角', { mode: '3d', yaw: 0, pitch: 0.52, dist: 1 }],
      ['2D 俯視', { mode: '2d' }],
      ['最近距離 dist=0.45', { mode: '3d', dist: 0.45 }],
      ['最遠距離 dist=2.2', { mode: '3d', dist: 2.2 }],
      ['最低俯角 pitch=0.18', { mode: '3d', dist: 1, pitch: 0.18 }],
      ['最高俯角 pitch=1.35', { mode: '3d', dist: 1, pitch: 1.35 }],
    ];
    for (const [name, cfg] of views) {
      const r = await renderAndScan(page, cfg);
      assert(r.board > 0 && r.stones > 0, `${name}：棋盤層 ${r.board} 個、棋子層 ${r.stones} 個元素`);
      assert(r.bad.length === 0, `${name}：${r.scanned} 個幾何元素的屬性皆無 NaN`);
      if (r.bad.length) console.error('         ' + r.bad.join(' | '));
      await shot(page, '04-view-' + name.replace(/[^\w.=-]+/g, '_'));
    }
    await page.evaluate(() => {
      Object.assign(window.__g3d.view, { mode: '3d', yaw: 0, pitch: 0.52, dist: 1 });
      window.__g3d.applyView();
    });

    /* ---- 8. 效能：19 路填滿 361 顆 ---- */
    section('效能（19 路填滿 361 顆）');
    if (!PERF_ON) {
      console.log('  SKIP  SMOKE_PERF=0，跳過效能項目');
    } else {
      // 用全新分頁量：同一個分頁玩過好幾局之後，殘留的特效與 hover 狀態會讓數字失真
      const ppage = await ctx.newPage();
      watchPage(ppage, '效能');
      await boot(ppage, base + '/');
      await startGame(ppage, { game: 'go', size: '19', mode: 'pvp' });
      const perf = await ppage.evaluate(() => {
        const g = window.__g3d, b = g.game.board, n = g.size;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[y][x] = ((x + y) % 2) + 1;
        g.render();
        let js = Infinity;
        // 首輪是暖機雜訊，且機器同時在跑別的東西時每輪都會被拖慢，
        // 所以取多輪最小值（最小值＝這台機器沒被打擾時的真實成本）
        for (let k = 0; k < 10; k++) {
          const t = performance.now();
          for (let i = 0; i < 20; i++) { g.view.yaw += 0.002; g.applyView(); g.render(); }
          js = Math.min(js, (performance.now() - t) / 20);
        }
        return { js, stones: document.getElementById('layer-stones').childElementCount };
      });
      eq(perf.stones > 0, true, `棋子層渲染出 ${perf.stones} 個元素`);
      let fps = 0;
      // rAF 連轉 60 幀為一輪，取最大值：首輪是暖機雜訊，
      // 而 rAF 有 vsync 上限（約 60 fps），任何一次背景干擾都只會往下拉、不會往上灌水，
      // 所以「多輪取最大」才是這台機器實際跑得動的速度。
      for (let k = 0; k < 6; k++) {
        fps = Math.max(fps, await ppage.evaluate(() => new Promise((res) => {
          const g = window.__g3d; let i = 0; const t = performance.now();
          const step = () => {
            g.view.yaw += 0.01; g.applyView(); g.render();
            if (++i < 60) requestAnimationFrame(step);
            else res(60000 / (performance.now() - t));
          };
          requestAnimationFrame(step);
        })));
      }
      console.log(`        實測：render JS ${perf.js.toFixed(2)} ms/次、rAF ${fps.toFixed(1)} fps`);
      assert(perf.js <= PERF_JS_MS, `單次 render 的 JS 成本 ${perf.js.toFixed(2)} ms ≤ ${PERF_JS_MS} ms`);
      assert(fps >= PERF_FPS, `連續轉動幀率 ${fps.toFixed(1)} fps ≥ ${PERF_FPS} fps`);
      await ppage.evaluate(() => { window.__g3d.view.yaw = 0; window.__g3d.applyView(); });
      await shot(ppage, '05-perf-19');
      await ppage.close();
    }

    /* ---- 9. 手機視口 390×844 ---- */
    section('手機視口 390×844');
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const mpage = await mctx.newPage();
    watchPage(mpage, '手機');
    await boot(mpage, base + '/');
    await startGame(mpage, { game: 'gomoku', mode: 'pvp' });
    const m = await mpage.evaluate(() => ({
      scene: Math.round(document.getElementById('scene').getBoundingClientRect().height),
      scrollW: document.documentElement.scrollWidth,
      bodyW: document.body.scrollWidth,
    }));
    console.log(`        實測：#scene 高 ${m.scene}px（視口 844px，${(m.scene / 844 * 100).toFixed(0)}%）、scrollWidth ${m.scrollW}px`);
    assert(m.scene >= 844 * 0.6, `#scene 高度 ${m.scene}px ≥ 視口 60%（${Math.round(844 * 0.6)}px）`);
    assert(m.scrollW <= 390, `頁面無橫向捲動（scrollWidth ${m.scrollW} ≤ 390）`);
    assert(m.bodyW <= 390, `body 無橫向溢出（scrollWidth ${m.bodyW} ≤ 390）`);
    await shot(mpage, '06-mobile');
    await mctx.close();

    /* ---- 10. 教學頁 tutorial.html ---- */
    section('教學頁 tutorial.html');
    const tpage = await ctx.newPage();
    watchPage(tpage, '教學頁');
    await tpage.goto(base + '/tutorial.html');
    await tpage.waitForSelector('svg.mini-svg', { timeout: 10000 });
    const t = await tpage.evaluate(() => ({
      svgs: document.querySelectorAll('svg.mini-svg').length,
      lessons: document.querySelectorAll('.tut-lesson').length,
      shapes: document.querySelectorAll('svg.mini-svg circle, svg.mini-svg line, svg.mini-svg rect').length,
    }));
    assert(t.svgs >= 1, `至少一個課程盤面渲染出 SVG（實得 ${t.svgs} 個）`);
    assert(t.lessons >= 1, `課程區塊有渲染出來（實得 ${t.lessons} 課）`);
    assert(t.shapes > 0, `課程盤面內有實際圖形元素（實得 ${t.shapes} 個）`);
    await shot(tpage, '07-tutorial');
    await tpage.close();

    /* ---- 1. 全程零錯誤（最後一併驗） ---- */
    section('全程無 JS 錯誤');
    if (consoleErrors.length) consoleErrors.slice(0, 10).forEach((e) => console.error('         ' + e));
    eq(consoleErrors.length, 0, '整場測試期間零 pageerror、零 console.error');
  } catch (e) {
    failed++;
    console.error('  FAIL  測試流程中斷：' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e));
    if (page) { try { await shot(page, 'error'); } catch {} }
  } finally {
    try { await browser.close(); } catch {}
    await new Promise((r) => srv.close(r));
  }

  console.log(`\n通過 ${passed}，失敗 ${failed}（耗時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
  process.exit(failed ? 1 : 0);
})();
