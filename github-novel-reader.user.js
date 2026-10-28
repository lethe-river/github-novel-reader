// ==UserScript==
// @name         GitHub · 知识库阅读
// @namespace    local.github.libread
// @version      1.0.0
// @description  在 GitHub 页面按 R 呼出中性文档风小说阅读器：书架（TXT 导入）/ 目录 / 正文，左右 AI 伪装栏，进度自动保存；再按 R 返回
// @author       local
// @match        https://github.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // 同一页面被注入两次（扩展 + 篡改猴）时只跑一份
  if (window.__gnrInstalled) return;
  window.__gnrInstalled = true;

  /* ============================================================
   *  配置：想改行为只动这里
   * ============================================================ */
  const CFG = {
    KEY: 'r',                 // 呼出 / 返回的触发键
    SITE: '知识库',            // 顶栏站名
    CHUNK: 6000,              // 没有章节标记时，按多少字切一节
    MAX_MB: 40,               // 单个导入文件的大小上限
    PRE_MIN: 100,             // 第一个章节标记之前正文超过多少字才做成「前言」
    FONT_MIN: 13,
    FONT_MAX: 26,
    LH_STEPS: [1.6, 1.8, 2.0, 2.2],
  };

  const LS_KEY = {
    settings: 'gnr.settings.v1',
    lastBook: 'gnr.lastBook.v1',
  };

  const S = {
    open: false,
    built: false,
    dataLoaded: false,
    openingBook: false,
    restoring: false,
    view: 'shelf',            // shelf | toc | reader
    panelVisible: true,
    book: null,
    text: null,
    chapter: 0,
    ratio: 0,
    books: [],
    positions: {},
    settings: { fontSize: 17, lineHeight: 1.8, serif: false },
    tocFilter: '',
    lastFocus: null,
    prevOverflow: '',
    prevBodyOverflow: '',
  };

  let rootEl = null;
  let stageEl = null;
  let winEl = null;
  let bodyEl = null;
  let footEl = null;
  let footPctEl = null;
  let footBarEl = null;
  let footChEl = null;
  let toastEl = null;
  let toastTimer = 0;
  let saveTimer = 0;
  let scrollRaf = 0;
  let readerSeq = 0;   // 每次重绘阅读页 +1，用来作废上一章还没跑完的分段渲染/滚动恢复

  /* ============================================================
   *  样式：中性文档观感，白纸黑字、无圆角、无阴影
   * ============================================================ */
  const CSS = `
#gnr-root, #gnr-root *, #gnr-root *::before, #gnr-root *::after { box-sizing: border-box; }
#gnr-root {
  position: fixed; inset: 0; z-index: 2147483200;
  display: flex; flex-direction: column;
  background: #fff; color: #1a1a1a; color-scheme: light;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  font-size: 14px; line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
#gnr-root[hidden] { display: none !important; }
#gnr-root [hidden] { display: none !important; }
#gnr-root button { border-radius: 0; box-shadow: none; }
#gnr-root input { border-radius: 0; box-shadow: none; }

/* ---------- 顶栏 ---------- */
.gnr-head {
  flex: none; height: 56px; display: flex; align-items: stretch;
  padding: 0 28px; background: #fff; border-bottom: 1px solid #e5e5e5;
}
.gnr-brand {
  display: flex; align-items: center; margin-right: 20px;
  font-size: 15px; font-weight: 600; letter-spacing: .02em; white-space: nowrap;
}
.gnr-brand::before {
  content: ""; width: 9px; height: 9px; border: 1px solid #1a1a1a; margin-right: 9px;
}
.gnr-tabs { display: flex; align-items: stretch; gap: 2px; }
.gnr-tab {
  appearance: none; background: none; border: none; border-bottom: 2px solid transparent;
  padding: 0 14px; margin: 0; color: #6b6b6b; font-size: 13px; cursor: pointer;
}
.gnr-tab:hover { color: #1a1a1a; }
.gnr-tab.on { color: #1a1a1a; font-weight: 600; border-bottom-color: #1a1a1a; }
.gnr-head-meta {
  margin-left: auto; display: flex; align-items: center; gap: 14px;
  font-size: 12px; color: #9a9a9a;
}
.gnr-clock { font-variant-numeric: tabular-nums; }
.gnr-keyhint { border: 1px solid #d8d8d8; padding: 1px 6px; font-size: 11px; color: #6b6b6b; line-height: 1.6; }
.gnr-fake-nav { display: flex; align-items: stretch; gap: 2px; }
.gnr-fake-nav span { display: flex; align-items: center; padding: 0 13px; font-size: 13px; color: #9a9a9a; }
.gnr-fake-nav span.on { color: #1a1a1a; font-weight: 600; border-bottom: 2px solid #1a1a1a; }
.gnr-head-btn {
  appearance: none; background: #fff; border: 1px solid #d8d8d8; color: #6b6b6b;
  font-size: 11px; line-height: 1.6; padding: 1px 8px; cursor: pointer;
}
#gnr-root .gnr-head-btn:hover { background: #f5f5f5; }
#gnr-root .gnr-head-btn.on { border-color: #1a1a1a; color: #1a1a1a; }

/* ---------- 主区：左右伪装栏 + 中间舞台 ---------- */
.gnr-main { flex: 1; min-height: 0; display: flex; align-items: stretch; overflow: hidden; }
.gnr-stage { flex: 1; min-width: 0; min-height: 0; position: relative; overflow: hidden; background: #fff; }
.gnr-dash { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; }
.gnr-dash-col { width: 100%; max-width: 860px; margin: 0 auto; padding: 26px 24px 80px; }
.gnr-dash-head {
  display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
  padding-bottom: 14px; border-bottom: 1px solid #e5e5e5;
}
.gnr-dash-meta { font-size: 11px; color: #9a9a9a; }
.gnr-stats { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #e5e5e5; }
.gnr-stat { padding: 16px 14px 15px 0; border-right: 1px solid #ededed; min-width: 0; }
.gnr-stat:last-child { border-right: none; }
.gnr-stat span { display: block; font-size: 11px; color: #9a9a9a; }
.gnr-stat b { display: block; margin-top: 4px; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.gnr-stat i { display: block; margin-top: 2px; font-style: normal; font-size: 11px; color: #9a9a9a; }
.gnr-dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 36px; }
.gnr-block { padding: 18px 0 14px; border-bottom: 1px solid #ececec; min-width: 0; }
.gnr-block-h {
  display: flex; justify-content: space-between; gap: 10px;
  margin-bottom: 10px; font-size: 12px; font-weight: 600; color: #1a1a1a;
}
.gnr-block-h span { font-weight: 400; color: #9a9a9a; }
.gnr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.gnr-table th {
  text-align: left; font-weight: 400; color: #9a9a9a;
  padding: 4px 6px 4px 0; border-bottom: 1px solid #ededed; white-space: nowrap;
}
.gnr-table td {
  padding: 5px 6px 5px 0; border-bottom: 1px dashed #ededed; color: #3a3a3a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;
}
.gnr-table td.ok { color: #1a1a1a; }
.gnr-hit { list-style: none; margin: 0; padding: 0; font-size: 12px; }
.gnr-hit li {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 5px 0; border-bottom: 1px dashed #ededed;
}
.gnr-hit li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gnr-hit i { font-style: normal; color: #9a9a9a; font-variant-numeric: tabular-nums; flex: none; }
.gnr-log { margin: 0; font: 11px/1.8 "Consolas", "Courier New", monospace; color: #6b6b6b; white-space: pre-wrap; }

/* ---------- 阅读窗口：可拖动、可缩放 ---------- */
.gnr-win {
  position: absolute; z-index: 20; display: flex; flex-direction: column;
  background: #fff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .08);
  container-type: inline-size;
}
.gnr-win[hidden] { display: none !important; }
.gnr-win-bar {
  flex: none; height: 44px; display: flex; align-items: center; gap: 10px;
  padding: 0 8px 0 12px; border-bottom: 1px solid #e5e5e5; background: #fff;
  cursor: move; user-select: none; touch-action: none;
}
.gnr-win-grip { flex: none; color: #b5b5b5; font-size: 12px; letter-spacing: -1px; }
.gnr-win-title {
  flex: none; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: #6b6b6b;
}
.gnr-win-bar .gnr-tabs { margin-left: 4px; }
.gnr-win-bar .gnr-tab { height: 43px; padding: 0 12px; font-size: 12px; }
.gnr-win-space { margin-left: auto; font-size: 11px; color: #b5b5b5; white-space: nowrap; }
.gnr-win-btn {
  flex: none; appearance: none; background: #fff; border: 1px solid #d8d8d8; color: #6b6b6b;
  width: 24px; height: 22px; padding: 0; line-height: 1; font-size: 12px; cursor: pointer;
}
#gnr-root .gnr-win-btn:hover { background: #f5f5f5; }
.gnr-rz { position: absolute; z-index: 6; }
.gnr-rz[data-dir="n"] { top: -3px; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.gnr-rz[data-dir="s"] { bottom: -3px; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.gnr-rz[data-dir="e"] { right: -3px; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.gnr-rz[data-dir="w"] { left: -3px; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.gnr-rz[data-dir="ne"] { right: -4px; top: -4px; width: 12px; height: 12px; cursor: nesw-resize; }
.gnr-rz[data-dir="nw"] { left: -4px; top: -4px; width: 12px; height: 12px; cursor: nwse-resize; }
.gnr-rz[data-dir="se"] { right: -4px; bottom: -4px; width: 14px; height: 14px; cursor: nwse-resize; }
.gnr-rz[data-dir="sw"] { left: -4px; bottom: -4px; width: 12px; height: 12px; cursor: nesw-resize; }

/* ---------- 窗口内容 ---------- */
.gnr-body {
  flex: 1; min-height: 0; display: flex; justify-content: center;
  overflow-y: auto; overflow-x: hidden; background: #fff;
}
/* 竖向滚动条隐藏，滚轮 / 方向键 / PageUp / PageDown 照常 */
.gnr-body, .gnr-dash { scrollbar-width: none; -ms-overflow-style: none; }
.gnr-body::-webkit-scrollbar, .gnr-dash::-webkit-scrollbar { width: 0; height: 0; }
.gnr-col { width: 100%; max-width: 820px; padding: 22px 24px 56px; }

/* ---------- 通用 ---------- */
.gnr-view-head, .gnr-toc-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
  padding-bottom: 14px; border-bottom: 1px solid #e5e5e5;
}
.gnr-h2 { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.3; }
.gnr-sub { margin-top: 5px; font-size: 12px; color: #9a9a9a; }
.gnr-actions { display: flex; gap: 8px; flex: none; }
.gnr-btn {
  appearance: none; background: #fff; border: 1px solid #d8d8d8; color: #1a1a1a;
  font-size: 12px; line-height: 1.4; padding: 5px 11px; cursor: pointer; white-space: nowrap;
  margin: 0;
}
#gnr-root .gnr-btn:hover { background: #f5f5f5; }
#gnr-root .gnr-btn:disabled { color: #bdbdbd; border-color: #e5e5e5; cursor: default; background: #fff; }
#gnr-root .gnr-btn--pri { border-color: #1a1a1a; }
#gnr-root .gnr-btn--pri:hover { background: #1a1a1a; color: #fff; }
#gnr-root .gnr-btn--danger { background: #1a1a1a; border-color: #1a1a1a; color: #fff; }

/* ---------- 书架 ---------- */
.gnr-books { list-style: none; margin: 0; padding: 0; }
.gnr-book { display: flex; gap: 20px; padding: 18px 2px 16px; border-bottom: 1px dashed #e5e5e5; }
.gnr-book-main { flex: 1; min-width: 0; }
.gnr-book-title { font-size: 15px; font-weight: 600; color: #1a1a1a; cursor: pointer; }
.gnr-book-title:hover { text-decoration: underline; }
.gnr-badge {
  display: inline-block; margin-left: 8px; padding: 0 5px;
  border: 1px solid #d8d8d8; font-size: 11px; font-weight: 400; color: #6b6b6b; vertical-align: 1px;
}
.gnr-book-sub {
  margin-top: 4px; font-size: 12px; color: #9a9a9a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gnr-book-bar { margin-top: 10px; height: 4px; background: #ededed; max-width: 460px; }
.gnr-book-bar i { display: block; height: 100%; background: #9a9a9a; }
.gnr-book-side {
  flex: none; min-width: 138px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
}
.gnr-pct { font-size: 13px; font-variant-numeric: tabular-nums; }
.gnr-time { font-size: 11px; color: #9a9a9a; }
.gnr-book-acts { display: flex; gap: 6px; margin-top: 4px; }
.gnr-book-acts .gnr-btn { padding: 3px 8px; font-size: 11px; }
.gnr-rename {
  width: min(320px, 100%); font-family: inherit; font-size: 15px; font-weight: 600; color: #1a1a1a;
  background: #fff; border: none; border-bottom: 1px solid #1a1a1a; padding: 0 0 2px; outline: none;
}

/* ---------- 空状态 ---------- */
.gnr-empty { padding: 90px 20px; text-align: center; }
.gnr-eh { font-size: 16px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
.gnr-ep { font-size: 12px; color: #9a9a9a; line-height: 1.9; margin-bottom: 18px; }

/* ---------- 目录 ---------- */
.gnr-filter {
  width: 180px; font-family: inherit; font-size: 12px; color: #1a1a1a;
  background: #fff; border: 1px solid #d8d8d8; padding: 5px 9px; outline: none;
}
#gnr-root .gnr-filter:focus { border-color: #1a1a1a; }
.gnr-toc-list { list-style: none; margin: 0; padding: 6px 0 0; }
.gnr-row {
  display: flex; align-items: baseline; gap: 14px;
  padding: 9px 4px; border-bottom: 1px dashed #ededed; cursor: pointer;
}
#gnr-root .gnr-row:hover { background: #f7f7f7; }
.gnr-row .i { flex: none; width: 46px; font-size: 11px; color: #9a9a9a; font-variant-numeric: tabular-nums; }
.gnr-row .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.gnr-row .p { flex: none; font-size: 11px; color: #6b6b6b; font-variant-numeric: tabular-nums; }
#gnr-root .gnr-row.on { background: #f7f7f7; }
.gnr-row.on .t { font-weight: 600; }
.gnr-row.on .i { color: #1a1a1a; }
.gnr-row.vol .t { font-weight: 600; color: #6b6b6b; }

/* ---------- 阅读器 ---------- */
.gnr-reader-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px;
  padding-bottom: 12px; border-bottom: 1px solid #e5e5e5; font-size: 12px; color: #9a9a9a;
}
.gnr-back {
  appearance: none; background: none; border: none; margin: 0; padding: 0;
  font-size: 12px; color: #6b6b6b; cursor: pointer;
}
#gnr-root .gnr-back:hover { color: #1a1a1a; text-decoration: underline; }
.gnr-reader-title {
  min-width: 0; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #1a1a1a; font-weight: 600; font-size: 13px;
}
.gnr-tools { margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px; flex: none; }
.gnr-tools .gnr-btn { padding: 2px 8px; font-size: 12px; }
.gnr-article { padding: 34px 0 10px; }
.gnr-ch-title { margin: 0; font-size: 24px; line-height: 1.4; font-weight: 600; overflow-wrap: break-word; }
.gnr-ch-meta { margin: 8px 0 30px; font-size: 12px; color: #9a9a9a; font-variant-numeric: tabular-nums; }
.gnr-text p {
  margin: 0 0 .92em; text-indent: 2em; text-align: justify; overflow-wrap: break-word;
  font-size: var(--gnr-fs, 17px); line-height: var(--gnr-lh, 1.8);
}
.gnr-text p.gnr-note { text-indent: 0; color: #9a9a9a; }
.gnr-text.serif p {
  font-family: "Songti SC", "STSong", "SimSun", "Noto Serif SC", "Source Han Serif SC", Georgia, serif;
}
.gnr-ch-nav {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  margin-top: 34px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #9a9a9a;
}
.gnr-ch-nav .gnr-btn { padding: 6px 14px; font-size: 13px; }
.gnr-ch-nav .mid { font-variant-numeric: tabular-nums; }

/* ---------- 窗口底栏 ---------- */
.gnr-foot {
  flex: none; height: 34px; display: flex; align-items: center; gap: 12px;
  padding: 0 14px; border-top: 1px solid #e5e5e5; font-size: 11px; color: #9a9a9a;
}
.gnr-prog { flex: 1; max-width: 520px; height: 3px; background: #ededed; }
.gnr-prog i { display: block; height: 100%; background: #9a9a9a; }
.gnr-foot .num { font-variant-numeric: tabular-nums; color: #6b6b6b; }
.gnr-foot .hint { margin-left: auto; }

/* ---------- 左右伪装栏（保持原有观感，参与主区布局，不再被舞台盖住） ---------- */
.gnr-rail {
  flex: none; width: 328px; padding: 40px 0 24px 28px;
  font-size: 12px; line-height: 1.7; color: #6b6b6b;
  pointer-events: none; user-select: none; overflow: hidden;
}
.gnr-rail--r { width: 328px; padding: 40px 28px 24px 0; }
.gnr-rail-h {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 13px; font-weight: 600; color: #1a1a1a;
  border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; margin-bottom: 10px;
}
.gnr-rail-h .gnr-clock { font-weight: 400; color: #9a9a9a; }
.gnr-rail-g { font-size: 11px; letter-spacing: .08em; color: #9a9a9a; margin: 14px 0 4px; }
.gnr-rail ul { list-style: none; margin: 0; padding: 0; }
.gnr-rail li {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 3px 0; border-bottom: 1px dashed #ededed;
}
.gnr-rail li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gnr-rail li i { font-style: normal; color: #9a9a9a; font-variant-numeric: tabular-nums; flex: none; }
.gnr-rail li i.on { color: #1a1a1a; }
.gnr-kv { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dashed #ededed; }
.gnr-kv b { color: #1a1a1a; font-weight: 600; font-variant-numeric: tabular-nums; }
.gnr-bar { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.gnr-bar > span { width: 32px; flex: none; }
.gnr-bar-t { flex: 1; height: 5px; background: #ededed; }
.gnr-bar-t > i { display: block; height: 100%; background: #9a9a9a; transition: width .6s linear; }
.gnr-bar > em { font-style: normal; width: 34px; text-align: right; font-variant-numeric: tabular-nums; flex: none; }
@media (max-width: 1520px) {
  .gnr-rail { width: 266px; padding-left: 20px; }
  .gnr-rail--r { width: 266px; padding-left: 0; padding-right: 20px; }
}
@media (max-width: 1360px) { .gnr-rail { display: none !important; } }

/* ---------- 提示 ---------- */
.gnr-toast {
  position: fixed; left: 50%; bottom: 56px; transform: translateX(-50%);
  max-width: 80vw; padding: 8px 16px; z-index: 30;
  background: #1a1a1a; color: #fff; font-size: 12px; line-height: 1.5;
}

/* ---------- 拖入 ---------- */
#gnr-root.gnr-drag::after {
  content: "松开导入 .txt"; position: fixed; inset: 14px; z-index: 40;
  display: flex; align-items: center; justify-content: center;
  border: 2px dashed #9a9a9a; background: rgba(255, 255, 255, .88);
  font-size: 18px; color: #6b6b6b; pointer-events: none;
}

@media (max-width: 720px) {
  .gnr-head { padding: 0 16px; }
  .gnr-brand { margin-right: 8px; }
  .gnr-fake-nav { display: none; }
  .gnr-dash-col { padding: 18px 16px 60px; }
  .gnr-stats { grid-template-columns: 1fr 1fr; }
  .gnr-stat:nth-child(2n) { border-right: none; }
  .gnr-dash-grid { grid-template-columns: 1fr; }
  .gnr-col { padding: 18px 16px 44px; }
  .gnr-local { display: none; }
  .gnr-keyhint { display: none; }
  .gnr-head-meta { gap: 8px; }
  .gnr-reader-title { max-width: 100%; }
  .gnr-tools { margin-left: 0; }
  .gnr-foot .hint { display: none; }
  .gnr-book { gap: 12px; }
  .gnr-book-side { min-width: 96px; }
  .gnr-book-acts { flex-wrap: wrap; justify-content: flex-end; }
}

/* 窗口被拖得很窄时按窗口宽度排版（不是视口宽度） */
@container (max-width: 560px) {
  .gnr-win-title { display: none; }
  .gnr-win-space { display: none; }
  .gnr-win-bar { gap: 6px; padding: 0 6px 0 10px; }
  .gnr-win-bar .gnr-tab { padding: 0 10px; }
  #gnr-win .gnr-col { padding: 16px 14px 44px; }
  #gnr-win .gnr-foot { gap: 8px; padding: 0 10px; }
  #gnr-win .gnr-foot .hint { display: none; }
  #gnr-win .gnr-reader-title { max-width: 100%; }
  #gnr-win .gnr-tools { margin-left: 0; }
  #gnr-win .gnr-book { gap: 12px; }
  #gnr-win .gnr-book-side { min-width: 92px; }
  #gnr-win .gnr-book-acts { flex-wrap: wrap; justify-content: flex-end; }
  #gnr-win .gnr-ch-title { font-size: 21px; }
}
`;

  /* ============================================================
   *  小工具
   * ============================================================ */
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  const clampNum = (n, a, b) => Math.max(a, Math.min(b, n));

  function fmtChars(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 10000).toFixed(0) + ' 万字';
    if (n >= 10000) return (n / 10000).toFixed(1) + ' 万字';
    return n.toLocaleString('zh-CN') + ' 字';
  }

  function fmtAgo(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + ' 分钟前';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' 小时前';
    const days = Math.floor(hours / 24);
    if (days < 30) return days + ' 天前';
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  function genId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  /* ============================================================
   *  IndexedDB
   *  书籍元数据、正文、阅读位置分三个 store：
   *  书架只读元数据，打开书时才取正文，避免每次都把几 MB 正文读进内存。
   * ============================================================ */
  let dbPromise = null;

  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('gnr-db', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('texts')) d.createObjectStore('texts', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('positions')) d.createObjectStore('positions', { keyPath: 'bookId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return dbPromise;
  }

  async function idbGet(store, key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = d.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function idbAll(store) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = d.transaction(store, 'readonly').objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }

  async function idbPut(store, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('tx aborted'));
    });
  }

  async function idbDel(store, key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ============================================================
   *  文本解码：中文 TXT 常见的几种编码
   *  UTF-8 BOM / UTF-16 BOM / 无 BOM 的 UTF-16 / UTF-8 / GB18030
   * ============================================================ */
  function decodeBuffer(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(u8.subarray(2));
    }
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(u8.subarray(2));
    }
    // 无 BOM 的 UTF-16：ASCII 字符会让一侧字节大量为 0
    const n = Math.min(u8.length, 4096) & ~1;
    if (n >= 64) {
      let zeroEven = 0, zeroOdd = 0;
      for (let i = 0; i < n; i += 2) {
        if (u8[i] === 0) zeroEven++;
        if (u8[i + 1] === 0) zeroOdd++;
      }
      const pairs = n / 2;
      if (zeroOdd > pairs * 0.4 && zeroEven < pairs * 0.05) return new TextDecoder('utf-16le').decode(u8);
      if (zeroEven > pairs * 0.4 && zeroOdd < pairs * 0.05) return new TextDecoder('utf-16be').decode(u8);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      try { return new TextDecoder('gb18030').decode(u8); }
      catch (e2) { return new TextDecoder('utf-8').decode(u8); }
    }
  }

  function normalizeText(t) {
    return String(t)
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '');
  }

  /* ============================================================
   *  章节解析
   * ============================================================ */
  const CN_NUM = '0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟';
  const RE_HEAD = new RegExp(
    '^(?:正文[\\s\\u3000]*)?(?:' +
    '第[' + CN_NUM + ']{1,10}[\\s\\u3000]*[章回节卷部篇集话幕]' +
    '|(?:序章|序言|楔子|引子|前言|后记|尾声|终章|番外|外传|附录)' +
    '|(?:Chapter|CHAPTER|Prologue|Epilogue|Part)[\\s\\u3000]*[0-9IVXLCDM]+' +
    ')'
  );
  const RE_LEAD = /^[☆★◆◇■□●○※*_\-—~～\s　]+/;
  const RE_VOLUME = new RegExp('^第[' + CN_NUM + ']{1,10}[\\s\\u3000]*卷');

  function isChapterTitle(raw) {
    const t = String(raw || '').trim();
    if (!t || t.length > 80) return false;
    if (/^#{1,6}\s+\S/.test(t)) return true;
    return RE_HEAD.test(t.replace(RE_LEAD, ''));
  }

  function cleanTitle(raw) {
    let s = String(raw || '').trim().replace(/^#{1,6}\s*/, '');
    s = s.replace(RE_LEAD, '');
    return s.slice(0, 80);
  }

  function chapterType(title) {
    return RE_VOLUME.test(title) ? 'volume' : 'chapter';
  }

  function chunkChapters(text) {
    const out = [];
    const size = CFG.CHUNK;
    let i = 0;
    let n = 1;
    while (i < text.length) {
      let end = Math.min(text.length, i + size);
      if (end < text.length) {
        const nl = text.lastIndexOf('\n', end);
        if (nl > i + size * 0.4) end = nl;
      }
      out.push({ title: '第 ' + n + ' 节', start: i, end, type: 'chunk' });
      i = end;
      n++;
      if (out.length > 100000) break;
    }
    if (!out.length) out.push({ title: '正文', start: 0, end: text.length, type: 'chunk' });
    if (out.length === 1) out[0].title = '正文';
    return out;
  }

  function guessTitle(text, filename) {
    const stem = String(filename || '').replace(/\.[^.]+$/, '').trim();
    const first = text.split('\n').map((s) => s.trim()).find(Boolean) || '';
    let cand = first.replace(/^#{1,6}\s*/, '').trim();
    if (/^《.*》$/.test(cand)) cand = cand.slice(1, -1).trim();
    if (cand && cand.length <= 40 &&
        !isChapterTitle(cand) &&
        !/[。！？!?…」』]$/.test(cand) &&
        !/^作者[\s:：]/.test(cand)) {
      return cand;
    }
    return stem || '未命名';
  }

  function parseBook(text, filename) {
    // 先按行切一遍，记录每行的起始偏移
    const lines = [];
    let pos = 0;
    while (pos <= text.length) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0) nl = text.length;
      lines.push({ start: pos, text: text.slice(pos, nl) });
      if (nl >= text.length) break;
      pos = nl + 1;
    }

    const marks = [];
    for (const ln of lines) {
      const t = ln.text.trim();
      if (!t || !isChapterTitle(t)) continue;
      marks.push({ start: ln.start, title: cleanTitle(t) });
    }

    let chapters;
    if (marks.length) {
      chapters = [];
      const first = marks[0];
      if (text.slice(0, first.start).trim().length >= CFG.PRE_MIN) {
        chapters.push({ title: '前言', start: 0, end: first.start, type: 'pre' });
      }
      marks.forEach((m, idx) => {
        const end = idx + 1 < marks.length ? marks[idx + 1].start : text.length;
        chapters.push({ title: m.title, start: m.start, end, type: chapterType(m.title) });
      });
    } else {
      chapters = chunkChapters(text);
    }

    const chars = chapters.reduce((a, c) => a + Math.max(0, c.end - c.start), 0);
    return { title: guessTitle(text, filename), chapters, chars };
  }

  /* ============================================================
   *  设置
   * ============================================================ */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY.settings);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object') return;
      if (Number.isFinite(v.fontSize)) S.settings.fontSize = clampNum(v.fontSize, CFG.FONT_MIN, CFG.FONT_MAX);
      if (Number.isFinite(v.lineHeight)) S.settings.lineHeight = v.lineHeight;
      if (typeof v.serif === 'boolean') S.settings.serif = v.serif;
    } catch (e) { /* 隐私模式里 localStorage 可能不可用 */ }
  }

  function saveSettings() {
    try { localStorage.setItem(LS_KEY.settings, JSON.stringify(S.settings)); } catch (e) {}
  }

  function applyReadingStyle() {
    if (!rootEl) return;
    rootEl.style.setProperty('--gnr-fs', S.settings.fontSize + 'px');
    rootEl.style.setProperty('--gnr-lh', String(S.settings.lineHeight));
    const textEl = document.getElementById('gnr-text');
    if (textEl) textEl.classList.toggle('serif', !!S.settings.serif);
    const serifBtn = rootEl.querySelector('[data-act="serif"]');
    if (serifBtn) serifBtn.textContent = S.settings.serif ? '宋体' : '黑体';
    const lhBtn = rootEl.querySelector('[data-act="lh"]');
    if (lhBtn) lhBtn.textContent = '行距 ' + S.settings.lineHeight.toFixed(1);
  }

  /* ============================================================
   *  UI 构建
   * ============================================================ */
  function injectStyle() {
    if (document.getElementById('gnr-style')) return;
    const st = document.createElement('style');
    st.id = 'gnr-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  const RAIL_LEFT = `
    <div class="gnr-rail-h">AI 工作台</div>
    <div class="gnr-rail-g">模型</div>
    <ul>
      <li><span>claude-opus-5-5</span><i class="on">在线</i></li>
      <li><span>claude-sonnet-5-5</span><i class="on">在线</i></li>
      <li><span>codex-mini</span><i>空闲</i></li>
      <li><span>embedding-v4</span><i>空闲</i></li>
    </ul>
    <div class="gnr-rail-g">知识库</div>
    <ul>
      <li><span>代码语料 / main</span><i>2.4k</i></li>
      <li><span>文档索引 / 2026-Q4</span><i>1.8k</i></li>
      <li><span>评审记录</span><i>384</i></li>
      <li><span>依赖图 / nightly</span><i>96</i></li>
    </ul>
    <div class="gnr-rail-g">近期任务</div>
    <ul>
      <li><span>增量索引</span><i class="on">完成</i></li>
      <li><span>嵌入重算</span><i class="on">完成</i></li>
      <li><span>检索抽检</span><i>排队</i></li>
    </ul>`;

  const RAIL_RIGHT = `
    <div class="gnr-rail-h">运行状态 <span class="gnr-clock">--:--</span></div>
    <div class="gnr-rail-g">推理队列</div>
    <div class="gnr-kv"><span>待处理</span><b data-live="queue">3</b></div>
    <div class="gnr-kv"><span>进行中</span><b>1</b></div>
    <div class="gnr-kv"><span>平均时延</span><b data-live="latency">412 ms</b></div>
    <div class="gnr-rail-g">上下文用量</div>
    <div class="gnr-bar"><span>输入</span><div class="gnr-bar-t"><i data-live="bar-in" style="width:64%"></i></div><em data-live="pct-in">64%</em></div>
    <div class="gnr-bar"><span>输出</span><div class="gnr-bar-t"><i data-live="bar-out" style="width:38%"></i></div><em data-live="pct-out">38%</em></div>
    <div class="gnr-bar"><span>缓存</span><div class="gnr-bar-t"><i data-live="bar-cache" style="width:71%"></i></div><em data-live="pct-cache">71%</em></div>
    <div class="gnr-rail-g">最近调用</div>
    <ul>
      <li><span>search / code</span><i class="on">ok</i></li>
      <li><span>embed / batch-32</span><i class="on">ok</i></li>
      <li><span>summarize / 8k</span><i class="on">ok</i></li>
      <li><span>review / diff</span><i class="on">ok</i></li>
    </ul>
    <div class="gnr-rail-g">索引</div>
    <div class="gnr-kv"><span>分片</span><b>2 048</b></div>
    <div class="gnr-kv"><span>最后重建</span><b>今天</b></div>`;

  function buildShell() {
    rootEl = document.createElement('div');
    rootEl.id = 'gnr-root';
    rootEl.hidden = true;
    rootEl.tabIndex = -1;
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-modal', 'true');
    rootEl.setAttribute('aria-label', CFG.SITE);
    rootEl.innerHTML = `
      <header class="gnr-head">
        <div class="gnr-brand">${esc(CFG.SITE)}</div>
        <nav class="gnr-fake-nav">
          <span class="on">工作台</span><span>索引</span><span>评测</span><span>日志</span>
        </nav>
        <div class="gnr-head-meta">
          <span class="gnr-local">本地 · 只读</span>
          <span class="gnr-clock">--:--</span>
          <button type="button" class="gnr-head-btn on" data-act="panel-toggle" title="显示 / 隐藏阅读窗口（空格）">窗口</button>
          <span class="gnr-keyhint">R 返回</span>
        </div>
      </header>
      <div class="gnr-main" id="gnr-main">
      <aside class="gnr-rail gnr-rail--l" id="gnr-rail-l"></aside>
      <div class="gnr-stage" id="gnr-stage">
        <div class="gnr-dash" id="gnr-dash">
          <div class="gnr-dash-col">
            <div class="gnr-dash-head">
              <div>
                <h2 class="gnr-h2">工作区概览</h2>
                <div class="gnr-sub">knowledge-base / main · 只读视图</div>
              </div>
              <div class="gnr-dash-meta">同步于 <span class="gnr-clock">--:--</span></div>
            </div>
            <div class="gnr-stats">
              <div class="gnr-stat"><span>索引仓库</span><b>24</b><i>+3 今日</i></div>
              <div class="gnr-stat"><span>语料分片</span><b>2 048</b><i>覆盖 98.2%</i></div>
              <div class="gnr-stat"><span>今日检索</span><b>1 284</b><i>命中率 92.1%</i></div>
              <div class="gnr-stat"><span>平均时延</span><b>386 ms</b><i>P95 640 ms</i></div>
            </div>
            <div class="gnr-dash-grid">
              <section class="gnr-block">
                <div class="gnr-block-h">最近索引任务 <span>查看全部</span></div>
                <table class="gnr-table">
                  <thead><tr><th>仓库</th><th>变更</th><th>状态</th><th>耗时</th></tr></thead>
                  <tbody>
                    <tr><td>octocat/Hello-World</td><td>124</td><td class="ok">完成</td><td>42s</td></tr>
                    <tr><td>vercel/next.js</td><td>1 208</td><td class="ok">完成</td><td>6m 12s</td></tr>
                    <tr><td>rust-lang/rust</td><td>3 402</td><td>进行中</td><td>—</td></tr>
                    <tr><td>tensorflow/tensorflow</td><td>892</td><td>排队</td><td>—</td></tr>
                  </tbody>
                </table>
              </section>
              <section class="gnr-block">
                <div class="gnr-block-h">检索命中 <span>今日</span></div>
                <ul class="gnr-hit">
                  <li><span>auth middleware token refresh</span><i>0.94</i></li>
                  <li><span>sync worker retry policy</span><i>0.91</i></li>
                  <li><span>repo index incremental diff</span><i>0.88</i></li>
                  <li><span>embedding batch size tuning</span><i>0.86</i></li>
                  <li><span>cache invalidation hooks</span><i>0.83</i></li>
                </ul>
              </section>
              <section class="gnr-block">
                <div class="gnr-block-h">模型调用 <span>近 1 小时</span></div>
                <div class="gnr-bar"><span>代码</span><div class="gnr-bar-t"><i style="width:72%"></i></div><em>72%</em></div>
                <div class="gnr-bar"><span>文档</span><div class="gnr-bar-t"><i style="width:58%"></i></div><em>58%</em></div>
                <div class="gnr-bar"><span>摘要</span><div class="gnr-bar-t"><i style="width:44%"></i></div><em>44%</em></div>
                <div class="gnr-bar"><span>嵌入</span><div class="gnr-bar-t"><i style="width:81%"></i></div><em>81%</em></div>
              </section>
              <section class="gnr-block">
                <div class="gnr-block-h">运行日志 <span>tail -f</span></div>
                <pre class="gnr-log">14:02:11  index   octocat/Hello-World      ok     124 docs
14:05:48  index   vercel/next.js           ok    1208 docs
14:09:02  embed   batch-32                 ok      32 vecs
14:11:26  search  "token refresh"          12 hits  386 ms
14:14:03  index   rust-lang/rust          run    3402 docs
14:16:40  cache   invalidate /repo/98      ok      22 keys</pre>
              </section>
            </div>
          </div>
        </div>
        <section class="gnr-win" id="gnr-win" aria-label="阅读窗口">
          <div class="gnr-win-bar" id="gnr-win-bar">
            <span class="gnr-win-grip">⠿</span>
            <span class="gnr-win-title" id="gnr-win-title">阅读窗口</span>
            <nav class="gnr-tabs">
              <button type="button" class="gnr-tab on" data-view="shelf">推荐</button>
              <button type="button" class="gnr-tab" data-view="toc">目录</button>
            </nav>
            <span class="gnr-win-space">空格 隐藏</span>
            <button type="button" class="gnr-win-btn" data-act="panel-hide" title="隐藏阅读窗口（空格）">—</button>
          </div>
          <div class="gnr-body" id="gnr-body">
            <div class="gnr-col"><div class="gnr-empty"><div class="gnr-ep">载入中…</div></div></div>
          </div>
          <footer class="gnr-foot" id="gnr-foot" hidden>
            <span class="num" id="gnr-foot-pct">0.0%</span>
            <div class="gnr-prog"><i id="gnr-foot-bar" style="width:0%"></i></div>
            <span class="num" id="gnr-foot-ch"></span>
            <span class="hint">← → 翻章 · 空格 窗口 · Esc / R 返回</span>
          </footer>
          <div class="gnr-rz" data-dir="n"></div>
          <div class="gnr-rz" data-dir="s"></div>
          <div class="gnr-rz" data-dir="e"></div>
          <div class="gnr-rz" data-dir="w"></div>
          <div class="gnr-rz" data-dir="ne"></div>
          <div class="gnr-rz" data-dir="nw"></div>
          <div class="gnr-rz" data-dir="se"></div>
          <div class="gnr-rz" data-dir="sw"></div>
        </section>
      </div>
      <aside class="gnr-rail gnr-rail--r" id="gnr-rail-r"></aside>
      </div>
      <div class="gnr-toast" id="gnr-toast" hidden></div>`;
    document.documentElement.appendChild(rootEl);

    stageEl = rootEl.querySelector('#gnr-stage');
    winEl = rootEl.querySelector('#gnr-win');
    bodyEl = rootEl.querySelector('#gnr-body');
    footEl = rootEl.querySelector('#gnr-foot');
    footPctEl = rootEl.querySelector('#gnr-foot-pct');
    footBarEl = rootEl.querySelector('#gnr-foot-bar');
    footChEl = rootEl.querySelector('#gnr-foot-ch');
    toastEl = rootEl.querySelector('#gnr-toast');

    rootEl.querySelector('#gnr-rail-l').innerHTML = RAIL_LEFT;
    rootEl.querySelector('#gnr-rail-r').innerHTML = RAIL_RIGHT;

    bindEvents();
    startRails();
  }

  /* ============================================================
   *  阅读窗口的几何：拖动 / 八向缩放 / 记忆位置
   * ============================================================ */
  const MIN_WIN_W = 360;
  const MIN_WIN_H = 280;
  const WIN_GEOM_KEY = 'gnr.window.v1';

  function defaultGeom(sw, sh) {
    const width = Math.min(880, Math.max(MIN_WIN_W, sw - 120));
    const height = Math.min(720, Math.max(MIN_WIN_H, sh - 80));
    return {
      width,
      height,
      left: Math.round((sw - width) / 2),
      top: Math.round(Math.max(16, (sh - height) / 2)),
    };
  }

  function applyGeom(g) {
    if (!winEl || !stageEl) return null;
    const sw = stageEl.clientWidth;
    const sh = stageEl.clientHeight;
    if (!sw || !sh) return null;
    const width = clampNum(Number(g.width) || 0, MIN_WIN_W, Math.max(MIN_WIN_W, sw));
    const height = clampNum(Number(g.height) || 0, MIN_WIN_H, Math.max(MIN_WIN_H, sh));
    const left = clampNum(Number(g.left) || 0, 0, Math.max(0, sw - width));
    const top = clampNum(Number(g.top) || 0, 0, Math.max(0, sh - height));
    winEl.style.width = width + 'px';
    winEl.style.height = height + 'px';
    winEl.style.left = left + 'px';
    winEl.style.top = top + 'px';
    return { left, top, width, height };
  }

  function loadGeom() {
    try {
      const g = JSON.parse(localStorage.getItem(WIN_GEOM_KEY) || 'null');
      if (g && Number.isFinite(g.width) && Number.isFinite(g.height) &&
          Number.isFinite(g.left) && Number.isFinite(g.top)) return g;
    } catch (e) {}
    return null;
  }

  function readGeom() {
    return {
      left: parseFloat(winEl.style.left) || 0,
      top: parseFloat(winEl.style.top) || 0,
      width: parseFloat(winEl.style.width) || 0,
      height: parseFloat(winEl.style.height) || 0,
    };
  }

  function saveGeom() {
    try { localStorage.setItem(WIN_GEOM_KEY, JSON.stringify(readGeom())); } catch (e) {}
  }

  function layoutPanel(reset) {
    if (!winEl || !stageEl) return;
    const sw = stageEl.clientWidth;
    const sh = stageEl.clientHeight;
    if (!sw || !sh) return;
    applyGeom(reset ? defaultGeom(sw, sh) : (loadGeom() || defaultGeom(sw, sh)));
  }

  function beginGeomDrag(e, mode, el) {
    if (e.button !== 0) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    const sr = stageEl.getBoundingClientRect();
    const wr = winEl.getBoundingClientRect();
    const s = {
      x: e.clientX, y: e.clientY,
      left: wr.left - sr.left, top: wr.top - sr.top,
      width: wr.width, height: wr.height,
      sw: sr.width, sh: sr.height,
    };
    const onMove = (ev) => {
      const dx = ev.clientX - s.x;
      const dy = ev.clientY - s.y;
      let left = s.left, top = s.top, width = s.width, height = s.height;
      if (mode === 'move') {
        left = clampNum(left + dx, 0, Math.max(0, s.sw - width));
        top = clampNum(top + dy, 0, Math.max(0, s.sh - height));
      } else {
        if (mode.indexOf('e') >= 0) width = clampNum(width + dx, MIN_WIN_W, Math.max(MIN_WIN_W, s.sw - s.left));
        if (mode.indexOf('w') >= 0) {
          left = clampNum(s.left + dx, 0, Math.max(0, s.left + s.width - MIN_WIN_W));
          width = s.left + s.width - left;
        }
        if (mode.indexOf('s') >= 0) height = clampNum(height + dy, MIN_WIN_H, Math.max(MIN_WIN_H, s.sh - s.top));
        if (mode.indexOf('n') >= 0) {
          top = clampNum(s.top + dy, 0, Math.max(0, s.top + s.height - MIN_WIN_H));
          height = s.top + s.height - top;
        }
      }
      applyGeom({ left, top, width, height });
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      saveGeom();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  function setPanelVisible(visible) {
    S.panelVisible = !!visible;
    if (!winEl) return;
    winEl.hidden = !S.panelVisible;
    if (S.panelVisible) layoutPanel(false);
    const btn = rootEl.querySelector('[data-act="panel-toggle"]');
    if (btn) {
      btn.classList.toggle('on', S.panelVisible);
      btn.title = S.panelVisible ? '隐藏阅读窗口（空格）' : '显示阅读窗口（空格）';
    }
  }

  function updateWinTitle() {
    const el = document.getElementById('gnr-win-title');
    if (el) el.textContent = S.book ? S.book.title : '阅读窗口';
  }

  function startRails() {
    const tick = () => {
      const d = new Date();
      const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      rootEl.querySelectorAll('.gnr-clock').forEach((el) => { el.textContent = hm; });
    };
    tick();
    setInterval(tick, 30000);

    setInterval(() => {
      if (!S.open || !rootEl) return;
      const right = rootEl.querySelector('#gnr-rail-r');
      if (!right) return;
      const q = right.querySelector('[data-live="queue"]');
      if (q) q.textContent = String(1 + Math.floor(Math.random() * 4));
      const lat = right.querySelector('[data-live="latency"]');
      if (lat) lat.textContent = String(300 + Math.floor(Math.random() * 260)) + ' ms';
      ['in', 'out', 'cache'].forEach((k) => {
        const v = 45 + Math.floor(Math.random() * 40);
        const bar = right.querySelector('[data-live="bar-' + k + '"]');
        const pct = right.querySelector('[data-live="pct-' + k + '"]');
        if (bar) bar.style.width = v + '%';
        if (pct) pct.textContent = v + '%';
      });
    }, 6000);
  }

  function ensureBuilt() {
    if (S.built) return;
    injectStyle();
    loadSettings();
    buildShell();
    S.built = true;
  }

  /* ============================================================
   *  数据加载
   * ============================================================ */
  async function ensureData(force) {
    if (S.dataLoaded && !force) return;
    const [books, positions] = await Promise.all([idbAll('books'), idbAll('positions')]);
    S.books = books;
    S.positions = {};
    for (const p of positions) S.positions[p.bookId] = p;
    S.dataLoaded = true;
    if (S.book && !S.books.some((b) => b.id === S.book.id)) {
      S.book = null;
      S.text = null;
      S.view = 'shelf';
    }
  }

  async function reloadBooks() {
    try { S.books = await idbAll('books'); } catch (e) {}
  }

  /* ============================================================
   *  进度
   * ============================================================ */
  function currentPercent() {
    if (!S.book || !S.book.chapters.length) return 0;
    const chs = S.book.chapters;
    let before = 0;
    for (let i = 0; i < S.chapter && i < chs.length; i++) {
      before += Math.max(0, chs[i].end - chs[i].start);
    }
    const ch = chs[S.chapter];
    const len = ch ? Math.max(0, ch.end - ch.start) : 0;
    const total = S.book.chars || 1;
    const pct = ((before + S.ratio * len) / total) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  function updateFoot() {
    if (!S.book) return;
    const pct = currentPercent();
    if (footPctEl) footPctEl.textContent = pct.toFixed(1) + '%';
    if (footBarEl) footBarEl.style.width = pct.toFixed(1) + '%';
    if (footChEl) {
      footChEl.textContent = '第 ' + (S.chapter + 1) + ' / ' + S.book.chapters.length + ' 章';
    }
  }

  async function persistPosition() {
    if (!S.book) return;
    const pos = {
      bookId: S.book.id,
      chapter: S.chapter,
      ratio: S.ratio,
      percent: currentPercent(),
      updatedAt: Date.now(),
    };
    S.positions[S.book.id] = pos;
    try { await idbPut('positions', pos); } catch (e) {}
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistPosition, 900);
  }

  function restoreScrollRatio() {
    const seq = readerSeq;
    requestAnimationFrame(() => {
      if (seq !== readerSeq || S.view !== 'reader') return;
      const max = bodyEl.scrollHeight - bodyEl.clientHeight;
      if (max > 0) bodyEl.scrollTop = S.ratio * max;
    });
  }

  /* ============================================================
   *  渲染：书架 / 目录 / 阅读器
   * ============================================================ */
  function setActiveTab() {
    if (!rootEl) return;
    const v = S.view === 'reader' ? 'shelf' : S.view;
    rootEl.querySelectorAll('.gnr-tab').forEach((b) => {
      b.classList.toggle('on', b.dataset.view === v);
    });
  }

  function bookTime(b) {
    const p = S.positions[b.id];
    return (p && p.updatedAt) || b.createdAt || 0;
  }

  // 打开阅读窗口时优先回到「在读」的书：内存里的当前书 > lastBook > 最近一次阅读记录 > 最新导入
  function pickLastBookId() {
    if (S.book && S.books.some((b) => b.id === S.book.id)) return S.book.id;
    let lastId = '';
    try { lastId = localStorage.getItem(LS_KEY.lastBook) || ''; } catch (e) {}
    if (lastId && S.books.some((b) => b.id === lastId)) return lastId;
    let best = null;
    for (const b of S.books) {
      const p = S.positions[b.id];
      if (!p || !p.updatedAt) continue;
      if (!best || p.updatedAt > best.updatedAt) best = { id: b.id, updatedAt: p.updatedAt };
    }
    if (best) return best.id;
    const newest = S.books.slice().sort((a, b) => bookTime(b) - bookTime(a))[0];
    return newest ? newest.id : '';
  }

  function renderShelf() {
    if (!bodyEl) return;
    readerSeq++;
    S.restoring = false;
    S.view = 'shelf';
    setActiveTab();
    updateWinTitle();
    if (footEl) footEl.hidden = true;

    let lastId = '';
    try { lastId = localStorage.getItem(LS_KEY.lastBook) || ''; } catch (e) {}
    const books = S.books.slice().sort((a, b) => bookTime(b) - bookTime(a));
    const rows = books.map((b) => {
      const p = S.positions[b.id];
      const pct = p && Number.isFinite(p.percent) ? clampNum(p.percent, 0, 100) : 0;
      const cur = S.book && S.book.id === b.id;
      const badge = cur ? '<span class="gnr-badge">在读</span>'
        : (b.id === lastId ? '<span class="gnr-badge">上次</span>' : '');
      return `
        <li class="gnr-book" data-id="${b.id}">
          <div class="gnr-book-main">
            <span class="gnr-book-title" data-act="open">${esc(b.title)}</span>${badge}
            <div class="gnr-book-sub">${esc(b.filename)} · ${b.chapters.length} 章 · ${fmtChars(b.chars)}</div>
            <div class="gnr-book-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
          </div>
          <div class="gnr-book-side">
            <span class="gnr-pct">${pct.toFixed(1)}%</span>
            <span class="gnr-time">${p ? fmtAgo(p.updatedAt) : '未读'}</span>
            <div class="gnr-book-acts">
              <button type="button" class="gnr-btn" data-act="open">${p && p.chapter > 0 ? '继续' : '阅读'}</button>
              <button type="button" class="gnr-btn" data-act="rename">重命名</button>
              <button type="button" class="gnr-btn" data-act="del">删除</button>
            </div>
          </div>
        </li>`;
    }).join('');

    bodyEl.innerHTML = `
      <div class="gnr-col">
        <div class="gnr-view-head">
          <div>
            <h2 class="gnr-h2">推荐</h2>
            <div class="gnr-sub">书架 · ${S.books.length} 本 · 拖入 .txt 即可导入</div>
          </div>
          <div class="gnr-actions">
            <button type="button" class="gnr-btn gnr-btn--pri" data-act="import">导入 TXT</button>
            <input type="file" id="gnr-file" accept=".txt,.md,.markdown,.text,.log,text/plain,text/markdown" multiple hidden>
          </div>
        </div>
        ${books.length ? `<ul class="gnr-books">${rows}</ul>` : `
          <div class="gnr-empty">
            <div class="gnr-eh">书架是空的</div>
            <div class="gnr-ep">把 .txt 小说拖到这里，或点右上角「导入 TXT」。<br>导入后按书名排在书架上，阅读进度自动保存。</div>
            <button type="button" class="gnr-btn gnr-btn--pri" data-act="import">选择文件</button>
          </div>`}
      </div>`;
    bodyEl.scrollTop = 0;
  }

  function renderTocList() {
    const list = document.getElementById('gnr-toc-list');
    if (!list || !S.book) return;
    const q = S.tocFilter.trim().toLowerCase();
    const saved = S.positions[S.book.id];
    const items = [];
    S.book.chapters.forEach((ch, i) => {
      if (q && !String(ch.title).toLowerCase().includes(q)) return;
      const cls = 'gnr-row' +
        (i === S.chapter ? ' on' : '') +
        (ch.type === 'volume' ? ' vol' : '');
      items.push(`<li class="${cls}" data-act="chapter" data-i="${i}">
        <span class="i">${i + 1}</span>
        <span class="t">${esc(ch.title)}</span>
        ${saved && saved.chapter === i ? '<span class="p">读到</span>' : ''}
      </li>`);
    });
    list.innerHTML = items.length
      ? items.join('')
      : '<li class="gnr-row"><span class="t">没有匹配的章节</span></li>';
  }

  function renderToc() {
    if (!bodyEl) return;
    readerSeq++;
    S.restoring = false;
    S.view = 'toc';
    setActiveTab();
    updateWinTitle();
    if (footEl) footEl.hidden = true;

    if (!S.book) {
      bodyEl.innerHTML = `
        <div class="gnr-col">
          <div class="gnr-view-head">
            <div>
              <h2 class="gnr-h2">目录</h2>
              <div class="gnr-sub">还没有打开的书</div>
            </div>
          </div>
          <div class="gnr-empty">
            <div class="gnr-eh">没有可显示的目录</div>
            <div class="gnr-ep">先到「推荐」书架里选一本，目录会显示它的章节。</div>
            <button type="button" class="gnr-btn gnr-btn--pri" data-act="shelf">去书架</button>
          </div>
        </div>`;
      bodyEl.scrollTop = 0;
      return;
    }

    const savedPos = S.positions[S.book.id];
    const tocPct = savedPos && Number.isFinite(savedPos.percent)
      ? ' · 整体 ' + clampNum(savedPos.percent, 0, 100).toFixed(1) + '%'
      : '';
    bodyEl.innerHTML = `
      <div class="gnr-col">
        <div class="gnr-toc-head">
          <div>
            <h2 class="gnr-h2">目录</h2>
            <div class="gnr-sub">${esc(S.book.title)} · ${S.book.chapters.length} 章 · ${fmtChars(S.book.chars)}${tocPct}</div>
          </div>
          <input type="search" class="gnr-filter" id="gnr-filter" placeholder="筛选章节" value="${esc(S.tocFilter)}">
        </div>
        <ol class="gnr-toc-list" id="gnr-toc-list"></ol>
      </div>`;
    renderTocList();
    bodyEl.scrollTop = 0;
  }

  // 逐帧补段落：单章几十万字时一次性塞进去会卡一下
  function fillText(box, text, ch, onDone) {
    const raw = text.slice(ch.start, ch.end);
    const paras = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    // 章节正文的第一行就是章节标题本身，标题已经单独显示，跳过它免得重复
    if (paras.length && (paras[0] === ch.title || cleanTitle(paras[0]) === ch.title)) paras.shift();
    if (!paras.length) {
      const p = document.createElement('p');
      p.className = 'gnr-note';
      p.textContent = '（这一段没有正文）';
      box.appendChild(p);
      if (onDone) onDone();
      return;
    }
    let i = 0;
    const STEP = 300;
    const render = () => {
      if (!box.isConnected) return;   // 视图已被切走，别再往分离的节点里塞内容
      const frag = document.createDocumentFragment();
      const end = Math.min(paras.length, i + STEP);
      for (; i < end; i++) {
        const p = document.createElement('p');
        p.textContent = paras[i];
        frag.appendChild(p);
      }
      box.appendChild(frag);
      if (i < paras.length) requestAnimationFrame(render);
      else if (onDone) onDone();
    };
    render();
  }

  function renderReader(restore) {
    if (!bodyEl) return;
    const seq = ++readerSeq;
    S.view = 'reader';
    setActiveTab();
    updateWinTitle();
    if (footEl) footEl.hidden = false;

    if (!S.book || !S.text) {
      renderShelf();
      return;
    }

    const b = S.book;
    const ch = b.chapters[S.chapter];
    if (!ch) { renderShelf(); return; }

    S.restoring = !!restore;
    applyReadingStyle();

    bodyEl.innerHTML = `
      <div class="gnr-col">
        <div class="gnr-reader-bar">
          <button type="button" class="gnr-back" data-act="shelf">← 书架</button>
          <span class="gnr-reader-title">${esc(b.title)}</span>
          <div class="gnr-tools">
            <button type="button" class="gnr-btn" data-act="font-" title="减小字号">A−</button>
            <button type="button" class="gnr-btn" data-act="font+" title="增大字号">A+</button>
            <button type="button" class="gnr-btn" data-act="serif" title="切换正文字体">黑体</button>
            <button type="button" class="gnr-btn" data-act="lh" title="切换行距">行距 1.8</button>
          </div>
        </div>
        <article class="gnr-article">
          <h1 class="gnr-ch-title">${esc(ch.title)}</h1>
          <div class="gnr-ch-meta">第 ${S.chapter + 1} / ${b.chapters.length} 章 · ${fmtChars(ch.end - ch.start)}</div>
          <div class="gnr-text" id="gnr-text"></div>
        </article>
        <div class="gnr-ch-nav">
          <button type="button" class="gnr-btn" data-act="prev" ${S.chapter <= 0 ? 'disabled' : ''}>上一章</button>
          <span class="mid">${S.chapter + 1} / ${b.chapters.length}</span>
          <button type="button" class="gnr-btn" data-act="next" ${S.chapter >= b.chapters.length - 1 ? 'disabled' : ''}>下一章</button>
        </div>
      </div>`;

    applyReadingStyle();
    bodyEl.scrollTop = 0;
    updateFoot();

    const textEl = document.getElementById('gnr-text');
    fillText(textEl, S.text, ch, () => {
      if (seq !== readerSeq) return;   // 渲染期间已经切到别的视图了
      if (restore && S.ratio > 0) {
        requestAnimationFrame(() => {
          if (seq !== readerSeq) return;
          const max = bodyEl.scrollHeight - bodyEl.clientHeight;
          if (max > 0) bodyEl.scrollTop = S.ratio * max;
          requestAnimationFrame(() => { if (seq === readerSeq) S.restoring = false; });
        });
      } else {
        S.restoring = false;
      }
    });
  }

  /* ============================================================
   *  动作
   * ============================================================ */
  function switchView(v) {
    if (S.view === 'reader' && S.book) persistPosition();
    if (v === 'toc') renderToc();
    else renderShelf();
  }

  async function openBook(id) {
    if (S.openingBook) return false;
    S.openingBook = true;
    const seq = readerSeq;
    try {
      const meta = S.books.find((b) => b.id === id) || await idbGet('books', id);
      if (seq !== readerSeq) return false;
      if (!meta) { toast('这本书已经不存在了'); return false; }
      const tr = await idbGet('texts', id);
      if (seq !== readerSeq) return false;
      if (!tr || typeof tr.text !== 'string') { toast('正文数据缺失，请重新导入'); return false; }
      if (S.view === 'reader' && S.book) await persistPosition();
      if (seq !== readerSeq) return false;
      S.book = meta;
      S.text = tr.text;
      const pos = S.positions[id];
      S.chapter = pos ? clampNum(Number(pos.chapter) || 0, 0, meta.chapters.length - 1) : 0;
      S.ratio = pos ? clampNum(Number(pos.ratio) || 0, 0, 1) : 0;
      S.tocFilter = '';
      S.view = 'reader';
      try { localStorage.setItem(LS_KEY.lastBook, id); } catch (e) {}
      renderReader(true);
      persistPosition();
      return true;
    } catch (e) {
      toast('打开失败');
      return false;
    } finally {
      S.openingBook = false;
    }
  }

  function openChapter(i) {
    if (!S.book) return;
    if (S.view === 'reader') persistPosition();
    S.chapter = clampNum(Number(i) || 0, 0, S.book.chapters.length - 1);
    S.ratio = 0;
    S.view = 'reader';
    renderReader(false);
    persistPosition();
  }

  function gotoChapter(delta) {
    if (!S.book || S.view !== 'reader') return;
    const i = S.chapter + delta;
    if (i < 0 || i >= S.book.chapters.length) return;
    openChapter(i);
  }

  function changeFont(delta) {
    S.settings.fontSize = clampNum(S.settings.fontSize + delta, CFG.FONT_MIN, CFG.FONT_MAX);
    applyReadingStyle();
    saveSettings();
    restoreScrollRatio();
  }

  function cycleLineHeight() {
    const steps = CFG.LH_STEPS;
    let i = steps.indexOf(S.settings.lineHeight);
    i = (i + 1) % steps.length;
    S.settings.lineHeight = steps[i];
    applyReadingStyle();
    saveSettings();
    restoreScrollRatio();
  }

  function startRename(id, btnEl) {
    const li = btnEl.closest('.gnr-book');
    const book = S.books.find((b) => b.id === id);
    if (!li || !book) return;
    const titleEl = li.querySelector('.gnr-book-title');
    if (!titleEl || li.querySelector('.gnr-rename')) return;

    const input = document.createElement('input');
    input.className = 'gnr-rename';
    input.value = book.title;
    input.maxLength = 80;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== book.title) {
        book.title = v;
        idbPut('books', Object.assign({}, book, { title: v })).catch(() => {});
        if (S.book && S.book.id === id) S.book.title = v;
      }
      renderShelf();
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function handleDelete(id, btnEl) {
    if (btnEl.dataset.armed === '1') {
      btnEl.dataset.armed = '0';
      deleteBook(id);
      return;
    }
    btnEl.dataset.armed = '1';
    const old = btnEl.textContent;
    btnEl.textContent = '确认删除?';
    btnEl.classList.add('gnr-btn--danger');
    setTimeout(() => {
      if (btnEl.isConnected && btnEl.dataset.armed === '1') {
        btnEl.dataset.armed = '0';
        btnEl.textContent = old;
        btnEl.classList.remove('gnr-btn--danger');
      }
    }, 2600);
  }

  async function deleteBook(id) {
    try {
      await idbDel('books', id);
      await idbDel('texts', id);
      await idbDel('positions', id);
    } catch (e) {}
    delete S.positions[id];
    S.books = S.books.filter((b) => b.id !== id);
    if (S.book && S.book.id === id) {
      S.book = null;
      S.text = null;
      S.chapter = 0;
      S.ratio = 0;
    }
    try {
      if (localStorage.getItem(LS_KEY.lastBook) === id) localStorage.removeItem(LS_KEY.lastBook);
    } catch (e) {}
    if (S.view !== 'shelf') S.view = 'shelf';
    renderShelf();
    toast('已删除');
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const ok = files.filter((f) => /\.(txt|md|markdown|text|log)$/i.test(f.name) || /^text\//.test(f.type || ''));
    if (!ok.length) {
      toast('只支持 .txt / .md / .text / .log 文本文件');
      return;
    }
    let imported = 0;
    for (const f of ok) {
      if (f.size > CFG.MAX_MB * 1024 * 1024) {
        toast(`《${f.name}》超过 ${CFG.MAX_MB}MB，已跳过`);
        continue;
      }
      try {
        const buf = await f.arrayBuffer();
        const text = normalizeText(decodeBuffer(buf));
        if (!text.trim()) {
          toast(`《${f.name}》是空文件`);
          continue;
        }
        const book = parseBook(text, f.name);
        const id = genId();
        await idbPut('books', {
          id,
          title: book.title,
          filename: f.name,
          size: f.size,
          chars: book.chars,
          chapters: book.chapters,
          createdAt: Date.now(),
        });
        await idbPut('texts', { id, text });
        imported++;
        if (ok.length === 1) toast(`已导入《${book.title}》 · ${book.chapters.length} 章`);
      } catch (e) {
        toast(`导入失败：《${f.name}》`);
      }
    }
    if (ok.length > 1) toast(`已导入 ${imported} / ${ok.length} 个文件`);
    await reloadBooks();
    if (S.view === 'shelf') renderShelf();
  }

  /* ============================================================
   *  打开 / 关闭
   * ============================================================ */
  function lockPage(on) {
    if (on) {
      S.prevOverflow = document.documentElement.style.overflow;
      S.prevBodyOverflow = document.body ? document.body.style.overflow : '';
      document.documentElement.style.overflow = 'hidden';
      if (document.body) {
        document.body.style.overflow = 'hidden';
        try { document.body.inert = true; } catch (e) {}
      }
    } else {
      document.documentElement.style.overflow = S.prevOverflow || '';
      if (document.body) {
        document.body.style.overflow = S.prevBodyOverflow || '';
        try { document.body.inert = false; } catch (e) {}
      }
    }
  }

  async function openOverlay() {
    if (S.open) return;
    ensureBuilt();
    if (!rootEl) return;

    S.lastFocus = document.activeElement;
    S.open = true;
    const seq = readerSeq;
    rootEl.hidden = false;
    rootEl.setAttribute('aria-busy', 'true');
    lockPage(true);
    setPanelVisible(true);   // 每次进来都先显示阅读窗口，空格再临时藏
    try { rootEl.focus({ preventScroll: true }); } catch (e) {}

    try {
      await ensureData(true);
    } catch (e) {
      toast('本地存储不可用，导入的书可能无法保存');
    }
    if (!S.open) { rootEl.removeAttribute('aria-busy'); return; }
    // 等数据期间用户已经点了别的视图，就不要再覆盖
    if (seq !== readerSeq) { rootEl.removeAttribute('aria-busy'); return; }

    // 默认停在「推荐」下的在读 / 上次的书；没有书时退回书架
    const lastId = pickLastBookId();
    if (lastId) {
      if (S.book && S.book.id === lastId && S.text && S.view === 'reader') {
        renderReader(true);
      } else if (!(await openBook(lastId))) {
        renderShelf();
      }
    } else {
      renderShelf();
    }
    rootEl.removeAttribute('aria-busy');
  }

  function closeOverlay() {
    if (!S.open) return;
    if (S.book) persistPosition();
    S.open = false;
    if (rootEl) {
      rootEl.hidden = true;
      rootEl.removeAttribute('aria-busy');
    }
    lockPage(false);
    const f = S.lastFocus;
    S.lastFocus = null;
    if (f && f !== document.body && typeof f.focus === 'function' && f.isConnected) {
      try { f.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  /* ============================================================
   *  键盘
   * ============================================================ */
  function isEditable(el) {
    if (!el || el === document || el === window) return false;
    const t = el.nodeType === 3 ? el.parentElement : el;
    if (!(t instanceof Element)) return false;
    if (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return true;
    if (t.getAttribute && t.getAttribute('role') === 'textbox') return true;
    if (t.classList && (t.classList.contains('inputarea') || t.classList.contains('monaco-mouse-cursor-text'))) return true;
    return false;
  }

  function hasOpenDialog() {
    // 别把自己（role=dialog 的阅读层）算成 GitHub 的模态框
    const els = document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]');
    for (const el of els) {
      if (rootEl && (el === rootEl || rootEl.contains(el))) continue;
      return true;
    }
    return false;
  }

  function pageScroll(dir) {
    if (!bodyEl) return;
    const h = bodyEl.clientHeight;
    try { bodyEl.scrollBy({ top: dir * h * 0.85, behavior: 'smooth' }); }
    catch (e) { bodyEl.scrollTop += dir * h * 0.85; }
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return;

    const key = e.key;
    const k = typeof key === 'string' ? key.toLowerCase() : '';

    if (S.open) {
      if (isEditable(e.target)) return;

      // 空格：显示 / 隐藏可拖动的阅读窗口
      if (key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        setPanelVisible(!S.panelVisible);
        return;
      }
      if (key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeOverlay();
        return;
      }
      if (S.panelVisible && S.view === 'reader' && S.book) {
        if (key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); gotoChapter(-1); return; }
        if (key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); gotoChapter(1); return; }
        const onUi = e.target && e.target.closest && e.target.closest('button, a');
        if (!onUi) {
          if (key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); pageScroll(1); return; }
          if (key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); pageScroll(-1); return; }
          if (key === 'PageDown') { e.preventDefault(); e.stopPropagation(); pageScroll(1); return; }
          if (key === 'PageUp') { e.preventDefault(); e.stopPropagation(); pageScroll(-1); return; }
        }
      }
      if (k === 'r' && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        closeOverlay();
        return;
      }
      // 阅读层之上不再让 GitHub 的全局快捷键响应
      e.stopPropagation();
      return;
    }

    if (k === 'r' && !e.repeat && !isEditable(e.target) && !hasOpenDialog()) {
      e.preventDefault();
      e.stopPropagation();
      openOverlay();
    }
  }

  /* ============================================================
   *  事件
   * ============================================================ */
  let dragDepth = 0;

  function bindEvents() {
    document.addEventListener('keydown', onKeyDown, true);

    bodyEl.addEventListener('scroll', () => {
      if (!S.open || S.view !== 'reader' || !S.book) return;
      if (S.restoring) return;
      const max = bodyEl.scrollHeight - bodyEl.clientHeight;
      S.ratio = max > 0 ? clampNum(bodyEl.scrollTop / max, 0, 1) : 0;
      if (!scrollRaf) {
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          if (S.view === 'reader') updateFoot();
        });
      }
      scheduleSave();
    }, { passive: true });

    rootEl.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      const tab = t.closest('.gnr-tab');
      if (tab) {
        switchView(tab.dataset.view === 'toc' ? 'toc' : 'shelf');
        return;
      }

      const actEl = t.closest('[data-act]');
      if (!actEl) return;
      const act = actEl.dataset.act;
      const bookEl = actEl.closest('[data-id]');
      const id = bookEl ? bookEl.dataset.id : null;

      switch (act) {
        case 'import': {
          const f = document.getElementById('gnr-file');
          if (f) f.click();
          break;
        }
        case 'panel-toggle':
          setPanelVisible(!S.panelVisible);
          break;
        case 'panel-hide':
          setPanelVisible(false);
          break;
        case 'open':
          if (id) openBook(id);
          break;
        case 'rename':
          if (id) startRename(id, actEl);
          break;
        case 'del':
          if (id) handleDelete(id, actEl);
          break;
        case 'shelf':
          switchView('shelf');
          break;
        case 'chapter': {
          const i = Number(actEl.dataset.i);
          if (S.book && Number.isFinite(i)) openChapter(i);
          break;
        }
        case 'prev':
          gotoChapter(-1);
          break;
        case 'next':
          gotoChapter(1);
          break;
        case 'font-':
          changeFont(-1);
          break;
        case 'font+':
          changeFont(1);
          break;
        case 'serif':
          S.settings.serif = !S.settings.serif;
          applyReadingStyle();
          saveSettings();
          break;
        case 'lh':
          cycleLineHeight();
          break;
      }
    });

    // 窗口拖动 / 八向缩放（标题栏除外：标签和按钮照常点击）
    winEl.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const rz = t.closest('.gnr-rz');
      if (rz) {
        beginGeomDrag(e, rz.dataset.dir, rz);
        return;
      }
      const bar = t.closest('.gnr-win-bar');
      if (bar && !t.closest('.gnr-tab, button, input')) beginGeomDrag(e, 'move', bar);
    });

    window.addEventListener('resize', () => {
      if (S.open && S.panelVisible) applyGeom(readGeom());
    });

    rootEl.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'gnr-file') {
        importFiles(e.target.files);
        e.target.value = '';
      }
    });

    rootEl.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'gnr-filter') {
        S.tocFilter = e.target.value;
        renderTocList();
      }
    });

    rootEl.addEventListener('keydown', (e) => {
      if (e.target && e.target.id === 'gnr-filter' && e.key === 'Escape') {
        e.preventDefault();
        if (e.target.value) {
          e.target.value = '';
          S.tocFilter = '';
          renderTocList();
        } else {
          e.target.blur();
        }
      }
    });

    // 拖拽导入（整个阅读层都接受）
    rootEl.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') < 0) return;
      e.preventDefault();
      dragDepth++;
      rootEl.classList.add('gnr-drag');
    });
    rootEl.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') < 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    rootEl.addEventListener('dragleave', (e) => {
      if (!e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') < 0) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) rootEl.classList.remove('gnr-drag');
    });
    rootEl.addEventListener('drop', (e) => {
      if (!e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') < 0) return;
      e.preventDefault();
      dragDepth = 0;
      rootEl.classList.remove('gnr-drag');
      importFiles(e.dataTransfer.files);
    });

    window.addEventListener('pagehide', () => { if (S.book) persistPosition(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && S.book) persistPosition();
    });
  }

  /* ============================================================
   *  GitHub 的 Turbo 导航会换掉 <body>：
   *  阅读层挂在 <html> 下面，重建后补样式、补挂载、补滚动锁
   * ============================================================ */
  function ensureAttached() {
    if (!S.built) return;
    if (!document.getElementById('gnr-style')) injectStyle();
    if (rootEl && !rootEl.isConnected && document.documentElement) {
      document.documentElement.appendChild(rootEl);
    }
    if (S.open) {
      document.documentElement.style.overflow = 'hidden';
      if (document.body) {
        document.body.style.overflow = 'hidden';
        try { document.body.inert = true; } catch (e) {}
      }
    }
  }
  document.addEventListener('turbo:load', ensureAttached, true);
  document.addEventListener('turbo:render', ensureAttached, true);

  /* ============================================================
   *  启动
   * ============================================================ */
  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        ensureBuilt();
      }, { once: true });
    } else {
      ensureBuilt();
    }
  }

  boot();
})();
