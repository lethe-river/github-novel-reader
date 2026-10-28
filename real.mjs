// 在真实 github.com 页面上注入脚本，验证触发键、CSP 下的样式和整体外观
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCRIPT = readFileSync(join(HERE, 'github-novel-reader.user.js'), 'utf8');
const PORT = 9339;
const PROFILE = join(tmpdir(), 'gnr-real-' + Date.now());
const OUT = join(HERE, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(250);
  }
  throw new Error('devtools not up');
}

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,1000', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
  'about:blank',
], { stdio: 'ignore' });

let ws = null, id = 0;
const pending = new Map();
const events = new Map();
function waitEvent(method, timeout) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { events.delete(method); reject(new Error('event timeout: ' + method)); }, timeout || 30000);
    events.set(method, (params) => { clearTimeout(t); events.delete(method); resolve(params); });
  });
}
function send(method, params) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}
async function ev(expression, extra) {
  const r = await send('Runtime.evaluate', Object.assign({
    expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true,
  }, extra || {}));
  if (r.exceptionDetails) {
    throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  }
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('saved', name);
}

try {
  await waitHttp('http://127.0.0.1:' + PORT + '/json/version');
  let page = null;
  const t0 = Date.now();
  while (!page && Date.now() - t0 < 25000) {
    const list = await waitHttp('http://127.0.0.1:' + PORT + '/json/list');
    page = list.find((t) => t.type === 'page');
    if (!page) await sleep(300);
  }
  if (!page) throw new Error('page target not found');
  console.log('page:', page.url);

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result);
    } else if (d.method && events.has(d.method)) {
      events.get(d.method)(d.params);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');

  // 显式导航到 github.com，等 load 事件，避免注入被文档替换冲掉
  const loaded = waitEvent('Page.loadEventFired', 60000);
  await send('Page.navigate', { url: 'https://github.com/' });
  await loaded;
  await sleep(1800);

  console.log('title:', await ev('document.title'));
  console.log('readyState before inject:', await ev('document.readyState'));
  console.log('csp:', await ev('(document.querySelector("meta[http-equiv=\\"Content-Security-Policy\\"]")||{}).content || "(none in meta)"'));

  // 注入脚本
  await ev(SCRIPT + '\n//# sourceURL=github-novel-reader.user.js');

  // 等 UI 建好（真实环境里 @run-at document-start，DOMContentLoaded 之后就有监听器）
  let built = false;
  for (let i = 0; i < 40; i++) {
    built = await ev('!!document.getElementById("gnr-root")');
    if (built) break;
    await sleep(250);
  }
  console.log('root exists:', built);
  console.log('style exists:', await ev('!!document.getElementById("gnr-style")'));
  if (!built) throw new Error('shell not built');
  await sleep(500);

  // R 打开
  await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"r",bubbles:true,cancelable:true}))');
  await sleep(1200);
  console.log('visible:', await ev('!document.getElementById("gnr-root").hidden'));
  console.log('shelf rendered:', await ev('!!document.querySelector(".gnr-books, .gnr-empty")'));
  console.log('computed:', await ev('JSON.stringify({pos:getComputedStyle(document.getElementById("gnr-root")).position,z:getComputedStyle(document.getElementById("gnr-root")).zIndex,bg:getComputedStyle(document.getElementById("gnr-root")).backgroundColor})'));
  console.log('rails:', await ev(`JSON.stringify(['gnr-rail-l','gnr-rail-r'].map((id) => {
    const e = document.getElementById(id);
    const r = e.getBoundingClientRect();
    return { id, display: getComputedStyle(e).display, w: Math.round(r.width), x: Math.round(r.left) };
  }))`));
  await shot('real-shelf.png');

  // 导入一本示例书并打开
  const sample = '《真实的书》\n作者：测试\n\n第一章 起风\n窗外起风了，树叶落在窗台上。\n\n第二章 落雨\n雨下了一整夜，巷子里的灯一直亮着。\n';
  await ev(`(function(){
    const dt = new DataTransfer();
    const text = ${JSON.stringify(sample)};
    dt.items.add(new File([text], '真实的书.txt', {type:'text/plain'}));
    const input = document.getElementById('gnr-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  })()`);
  let books = 0;
  for (let i = 0; i < 30; i++) {
    books = await ev('document.querySelectorAll(".gnr-book").length');
    if (books) break;
    await sleep(250);
  }
  console.log('books:', books);
  console.log('book title:', await ev('(document.querySelector(".gnr-book-title")||{}).textContent || ""'));
  await ev('document.querySelector(\'.gnr-book-acts [data-act="open"]\').click()');
  let chapter = '';
  for (let i = 0; i < 30; i++) {
    chapter = await ev('(document.querySelector(".gnr-ch-title")||{}).textContent || ""');
    if (chapter) break;
    await sleep(250);
  }
  console.log('chapter:', chapter);
  await shot('real-reader.png');

  // 空格隐藏 / 显示阅读窗口
  const space = 'document.dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}))';
  await ev(space);
  await sleep(300);
  console.log('space hides window:', await ev('document.getElementById("gnr-win").hidden === true'));
  await ev(space);
  await sleep(300);
  console.log('space shows window:', await ev('document.getElementById("gnr-win").hidden === false'));

  // 拖动标题栏（真实页面坐标系）
  console.log('drag:', await ev(`(function(){
    const bar = document.getElementById('gnr-win-bar');
    const win = document.getElementById('gnr-win');
    const r = bar.getBoundingClientRect();
    const x = r.left + 60, y = r.top + r.height / 2;
    const opt = (cx, cy) => ({ bubbles: true, cancelable: true, button: 0, clientX: cx, clientY: cy, pointerId: 9 });
    const before = { left: win.style.left, top: win.style.top };
    bar.dispatchEvent(new PointerEvent('pointerdown', opt(x, y)));
    bar.dispatchEvent(new PointerEvent('pointermove', opt(x + 40, y + 24)));
    bar.dispatchEvent(new PointerEvent('pointerup', opt(x + 40, y + 24)));
    return JSON.stringify({ before, after: { left: win.style.left, top: win.style.top } });
  })()`));

  // 目录
  await ev('document.querySelector(\'.gnr-tab[data-view="toc"]\').click()');
  await sleep(400);
  console.log('toc rows:', await ev('document.querySelectorAll("#gnr-toc-list .gnr-row").length'));
  await shot('real-toc.png');

  // 关闭，页面要恢复
  await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"r",bubbles:true,cancelable:true}))');
  await sleep(400);
  console.log('closed:', await ev('document.getElementById("gnr-root").hidden'));
  console.log('html overflow:', JSON.stringify(await ev('document.documentElement.style.overflow')));
  console.log('body inert:', await ev('document.body.inert === true'));
  console.log('title back:', await ev('document.title'));

  // 重开：自动回到上次在读的书，推荐栏选中
  await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"r",bubbles:true,cancelable:true}))');
  await sleep(1200);
  console.log('reopen chapter:', await ev('(document.querySelector(".gnr-ch-title")||{}).textContent || ""'));
  console.log('reopen selects 推荐:', await ev('!!document.querySelector(".gnr-tab[data-view=\\"shelf\\"].on")'));
  await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"r",bubbles:true,cancelable:true}))');
} catch (e) {
  console.error('REAL ERROR:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { execSync('taskkill /F /T /PID ' + child.pid, { stdio: 'ignore' }); } catch (e) {}
  await sleep(400);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}
