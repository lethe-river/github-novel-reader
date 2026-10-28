// 用 CDP 驱动无头 Chrome 跑 test.html（虚拟时间会让 IndexedDB 停摆，所以走真实时间）
import { spawn, execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = process.env.GNR_TEST_URL || 'http://127.0.0.1:8137/test.html';
const PAGE_NAME = PAGE.split('/').pop().split('?')[0];
const PORT = 9337;
const PROFILE = join(tmpdir(), 'gnr-cdp-' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('chrome devtools not up: ' + url);
}

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  PAGE,
], { stdio: 'ignore' });

let ws = null;
let msgId = 0;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

try {
  await waitHttp('http://127.0.0.1:' + PORT + '/json/version');
  let targets = await waitHttp('http://127.0.0.1:' + PORT + '/json/list');
  let page = targets.find((t) => t.type === 'page' && t.url.includes(PAGE_NAME));
  const t0 = Date.now();
  while (!page && Date.now() - t0 < 8000) {
    await sleep(200);
    targets = await waitHttp('http://127.0.0.1:' + PORT + '/json/list');
    page = targets.find((t) => t.type === 'page' && t.url.includes(PAGE_NAME));
  }
  if (!page) throw new Error('test page target not found');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  };

  await send('Runtime.enable');

  const deadline = Date.now() + 40000;
  let results = null;
  while (Date.now() < deadline) {
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ done: !!window.__TESTS__, tests: window.__TESTS__ || null, title: document.title })',
      returnByValue: true,
    });
    let v = null;
    try { v = JSON.parse(r.result.value); } catch (e) {}
    if (v && v.done) { results = v.tests; break; }
    await sleep(300);
  }

  if (!results) {
    console.log('TIMEOUT waiting for tests');
    const r = await send('Runtime.evaluate', {
      expression: 'document.getElementById("out") && document.getElementById("out").textContent',
      returnByValue: true,
    });
    console.log(r.result.value || '(no #out)');
    process.exitCode = 1;
  } else {
    console.log(results.join('\n'));
    const fails = results.filter((x) => x.startsWith('FAIL'));
    process.exitCode = fails.length ? 1 : 0;
  }
} catch (e) {
  console.error('RUNNER ERROR:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { execSync('taskkill /F /T /PID ' + child.pid, { stdio: 'ignore' }); } catch (e) {}
  await sleep(400);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}
