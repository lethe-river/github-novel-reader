// 截图：跑完 test.html 的自带用例后，打开阅读层抓几张图
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'http://127.0.0.1:8137/test.html';
const PORT = 9338;
const PROFILE = join(tmpdir(), 'gnr-shot-' + Date.now());
const OUT = join(HERE, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(200);
  }
  throw new Error('devtools not up');
}

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,1000', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, PAGE,
], { stdio: 'ignore' });

let ws = null, id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.text || ''));
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('saved', name);
}

try {
  await waitHttp('http://127.0.0.1:' + PORT + '/json/version');
  let targets = null, page = null;
  const t0 = Date.now();
  while (!page && Date.now() - t0 < 10000) {
    targets = await waitHttp('http://127.0.0.1:' + PORT + '/json/list');
    page = targets.find((t) => t.type === 'page' && t.url.includes('test.html'));
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('page not found');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // 等自带测试跑完（会导入两本书并留下阅读记录）
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (await ev('!!window.__TESTS__')) break;
    await sleep(300);
  }
  await sleep(300);

  // 打开阅读层 -> 书架
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'r',bubbles:true,cancelable:true}))`);
  await sleep(700);
  await ev(`(document.querySelector('.gnr-tab[data-view="shelf"]')||{click(){}}).click()`);
  await sleep(400);
  await shot('shelf.png');

  // 空格隐藏阅读窗口 -> 露出整个 AI 工作台
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))`);
  await sleep(400);
  await shot('dashboard.png');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))`);
  await sleep(400);

  // 打开第一本书 -> 阅读页
  await ev(`document.querySelector('.gnr-book-acts [data-act="open"]').click()`);
  await sleep(1200);
  await shot('reader.png');

  // 目录
  await ev(`document.querySelector('.gnr-tab[data-view="toc"]').click()`);
  await sleep(500);
  await shot('toc.png');

  // 手机宽度
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  console.log('mobile metrics', await ev(`JSON.stringify({
    vw: innerWidth,
    stage: document.getElementById('gnr-stage').clientWidth,
    stageH: document.getElementById('gnr-stage').clientHeight,
    winW: document.getElementById('gnr-win').getBoundingClientRect().width,
    winH: document.getElementById('gnr-win').getBoundingClientRect().height,
  })`));
  await ev(`document.querySelector('.gnr-tab[data-view="shelf"]').click()`);
  await sleep(500);
  await shot('mobile-shelf.png');
  await ev(`document.querySelector('.gnr-book-acts [data-act="open"]').click()`);
  await sleep(900);
  await shot('mobile-reader.png');
} catch (e) {
  console.error('SHOT ERROR:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { execSync('taskkill /F /T /PID ' + child.pid, { stdio: 'ignore' }); } catch (e) {}
  await sleep(400);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}
