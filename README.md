# GitHub · 知识库阅读

> 摸鱼必备，隐蔽性强。

一个只在 `https://github.com/*` 生效的篡改猴脚本：按 `R` 把当前 GitHub 页面盖成一个中性文档风的「知识库」。左右是原有的 AI 工作台 / 运行状态伪装栏，中间是一整块 AI 工作区 / 索引 / 运行日志的假数据看板，看板上浮着一个可拖动、可八向缩放的阅读窗口；按空格显示或隐藏这个窗口，再按 `R` 回到原来的网页。GitHub 页面本身不做任何修改。

## 安装

已装 Tampermonkey 时，任选一种：

**A. 本地安装页（推荐）**

```powershell
cd github-novel-reader
python -m http.server 8137
```

浏览器打开 `http://localhost:8137/github-novel-reader.user.js`，Tampermonkey 会拦截并弹出安装页。

**B. 直接粘贴**

Tampermonkey 面板 → 添加新脚本 → 清空 → 粘贴 `github-novel-reader.user.js` 全部内容 → 保存。

安装后打开任意 GitHub 页面，按 `R`。

## 用法

- `R`：打开阅读层；再按 `R` 返回 GitHub。`Esc` 也可以返回。
- 打开时默认选中「推荐」栏，并自动打开在读 / 上次阅读的那本书（直接回到上次的章节和滚动位置）；书架空了才显示空状态。想挑别的书时，点窗口顶部的「推荐」回到书架。
- `空格`：显示 / 隐藏浮动的阅读窗口，露出底下的工作台看板；再按一次恢复。光标在输入框里时空格正常输入，不会切换。
- 浮动窗口：拖标题栏移动，拖四边或四角缩放（左上、上、右上、右、右下、下、左下、左共 8 个把手）；最小 360×280，位置和大小会记住（`localStorage` 的 `gnr.window.v1`）。窗口没有外边框，靠投影和背景分层；竖向滚动条已隐藏，滚轮 / 方向键 / PageUp / PageDown 照常滚动。顶栏的「窗口」按钮与标题栏右侧的 `—` 同样可以隐藏窗口。
- 在 GitHub 的输入框、搜索框、代码编辑器里按 `R` 不会触发；在阅读层自己的输入框里按 `R` 也不会关闭。
- **推荐**：书架。右上「导入 TXT」或把 `.txt` / `.md` 拖进窗口。每本书显示书名、文件名、章节数、字数、进度条、百分比、上次阅读时间；支持重命名、删除（点两次确认）、继续阅读。
- **目录**：当前这本书的章节列表，可筛选；当前章高亮，上次读到的那章标「读到」。点任意一章直接跳转。
- 阅读页：`A−` / `A+` 调字号，`黑体/宋体` 切字体，`行距` 循环 1.6 / 1.8 / 2.0 / 2.2；`←` `→` 翻章，`↑` `↓` / `PageUp` / `PageDown` 滚动，底部显示整体进度。窗口隐藏时这些阅读快捷键暂停，先按空格把窗口叫回来。
- 阅读位置（章 + 章内滚动比例 + 百分比）自动保存，关掉浏览器再打开也还在。

## 支持的文件

- 扩展名：`.txt` `.md` `.markdown` `.text` `.log`，单文件上限 40MB。
- 编码：UTF-8（含 BOM）、UTF-16 LE/BE（含无 BOM 的常见形态）、GBK/GB18030 自动识别。
- 章节识别：`第N章/回/节/卷/部/篇/集/话/幕`、`序章` `楔子` `引子` `前言` `后记` `尾声` `终章` `番外` 等，Markdown 的 `#` 标题，英文 `Chapter N`。
- 没有章节标记时按约 6000 字一节自动切分；第一个章节标记之前超过 100 字的正文会做成「前言」。

## 数据存放

- 书籍正文与元数据：当前 GitHub 源站的 IndexedDB（库名 `gnr-db`）。
- 阅读位置：同一 IndexedDB 的 `positions`。
- 字号 / 字体 / 行距：`localStorage` 的 `gnr.settings.v1`。
- 阅读窗口的位置与大小：`localStorage` 的 `gnr.window.v1`。
- 清除站点数据会连同书籍一起清掉，原始文件请自行保留。
- 脚本不发起任何网络请求；两侧的 AI 数据是写死的假数据。

## 开发与测试

```powershell
cd github-novel-reader
node --check github-novel-reader.user.js
python -m http.server 8137            # 另开一个窗口
node run-cdp.mjs                       # test.html：37 项端到端（含拖动/缩放/空格/自动续读/无边框/滚动条）
$env:GNR_TEST_URL="http://127.0.0.1:8137/stress.html"; node run-cdp.mjs   # 规模/交互
node shot.mjs                          # 截图到 shots\
node real.mjs                          # 在真实 github.com 上注入验证
```

`run-cdp.mjs` 用 CDP 驱动无头 Chrome。不能用 `--virtual-time-budget` + `--dump-dom`：虚拟时间下 IndexedDB 不推进，页面会一直停在「载入中」。

三个 CDP 脚本默认使用 `C:\Program Files\Google\Chrome\Application\chrome.exe`；Chrome 装在其他位置时，用环境变量 `CHROME_PATH` 指定。测试用的临时浏览器 profile 放在系统临时目录，不会写进项目。

## 已知限制

- 只识别纯文本；EPUB / MOBI / PDF 不支持。
- 章节识别是启发式规则，排版特殊的小说可能需要手动调 `RE_HEAD`。
- 阅读层挂在 `<html>` 下以躲过 GitHub Turbo 换 `<body>`；如果 GitHub 以后整页重绘 `documentElement`，需要重新注入。
- 阅读窗口的坐标是中间舞台内的绝对像素，只能在左右伪装栏之间移动和缩放，不会盖住两侧；1360px 以下两侧栏隐藏，窗口占据整个宽度。窄屏（约 400px）下最小窗口 360px 宽，基本占满屏幕，按空格隐藏窗口才能完整看板。
- 书很多、章节上万时目录会一次性渲染，首次打开可能略慢。
