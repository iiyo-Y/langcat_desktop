/**
 * Electron 主进程
 *
 * 双窗口架构:
 *   - mainWindow:常驻主窗口,显示用法 + 最近查询。
 *   - popoverWindow:无边框 / 透明 / 置顶 / 不进任务栏的小卡片,
 *     由"剪贴板变化"或"全局快捷键"触发,出现在鼠标当前位置,
 *     失焦自动隐藏,反复重用同一个 BrowserWindow(预创建,首次响应即时)。
 *
 * 取词触发(MVP 第一阶段):
 *   1. 监听系统剪贴板:用户在任意应用里选中英文单词后 Ctrl+C → 剪贴板变化 →
 *      若内容是合法英文单词 → 弹 popover。
 *   2. 全局快捷键 Ctrl+Alt+W(macOS: ⌘+⌥+W):兜底,无视剪贴板变化也能再次唤起
 *      上一次的查询(用户场景:不小心点掉了想再看一次)。
 *
 * 不做(第二阶段再上):
 *   - 真 hover 鼠标停留取词(需原生 napi 模块,macOS 要 Accessibility 授权)
 *   - 自动模拟 Ctrl+C(robotjs / nut-js,引入原生编译依赖)
 */

import {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
  clipboard,
  shell,
  ipcMain,
  Menu,
} from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setupAutoUpdater } from './updater';
import * as vocabulary from './vocabulary';
import * as auth from './auth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WINDOW_DEFAULTS = {
  main: {
    width: 880,
    height: 620,
    minWidth: 640,
    minHeight: 420,
  },
  popover: {
    // 左右分栏布局:左边词语解析(主信息),右边 AI 问答(并列常驻面板)
    // 默认 920×600 给两栏各 ~440 的舒适宽度;用户拖窗角可改大小,会被记住下次复用
    width: 920,
    height: 600,
    minWidth: 720,
    minHeight: 360,
  },
} as const;

// 弹 popover 的全局快捷键 — Ctrl+Shift+/(Mac 用 Command+Shift+/)
// 触发时读当前剪贴板里的内容:用户选中词后按 Ctrl+C 复制,再按这个快捷键弹窗。
// 故意不再用 Ctrl+C 的剪贴板轮询触发 —— 复制 != 查词,曾经的"复制即弹"误触发太多。
const SHORTCUT_LOOKUP =
  process.platform === 'darwin' ? 'Command+Shift+/' : 'CommandOrControl+Shift+/';

/** popover 距离屏幕底部的留白(px);popover 顶部到底部 = bounds.height + 这个值 */
const POPOVER_BOTTOM_MARGIN = 96;

/** popover 显示后多久自动隐藏(ms);新查询会重置计时 */
const POPOVER_AUTO_HIDE_MS = 8000;

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '..', 'dist');
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');

/**
 * LangCat 后端 API 基址
 *
 * 由 vite-plugin-electron/main 配置在 build 时通过 `define: process.env.LANGCAT_API_BASE_URL`
 * inline。`.env.local` 提供 `VITE_LANGCAT_API_BASE_URL=http://localhost:8080`。
 * 缺失就 fail-loud(规则 4),不写默认兜底。
 */
const LANGCAT_API_BASE_URL = (process.env.LANGCAT_API_BASE_URL ?? '').replace(
  /\/+$/,
  '',
);
if (!LANGCAT_API_BASE_URL) {
  throw new Error(
    '[LangCat] 缺少 VITE_LANGCAT_API_BASE_URL\n' +
      '  在 langcat_desktop/.env.local 设置(可从 .env.local.example 复制):\n' +
      '    VITE_LANGCAT_API_BASE_URL=http://localhost:8080',
  );
}

console.info('[LangCat] preload 路径:', PRELOAD_PATH);
console.info('[LangCat] dev 模式:', VITE_DEV_SERVER_URL ? 'yes' : 'no');
console.info('[LangCat] 后端 API 基址:', LANGCAT_API_BASE_URL);
console.info(
  `[LangCat] 触发方式:全局快捷键 ${SHORTCUT_LOOKUP}(读当前剪贴板内容)`,
);

let mainWindow: BrowserWindow | null = null;
let popoverWindow: BrowserWindow | null = null;
/** popover 自动隐藏的 timer;每次新查询重置 */
let popoverAutoHideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 用户上次手动拖动到的 popover 位置(整个 app 生命周期内记住)。
 * null 表示用户没拖过,fallback 到 computePopoverBoundsBottomCenter()。
 * 进程重启会清空,下次默认中下方;以后想跨会话持久化加 electron-store 即可。
 */
/**
 * 用户既可拖位置又可拉大小;两者都记下来,下次按记住的位置 + 大小弹出。
 * null 表示用户没动过,fallback 到 computePopoverBoundsBottomCenter() + 默认尺寸。
 */
let userMovedBounds: { x: number; y: number; width: number; height: number } | null = null;
/** 上一次成功翻译过的词,用作快捷键的"再来一次" */
let lastQueriedWord: string | null = null;
/** 应用是否正在退出;popover 的 close 事件靠它区分"用户关 vs 应用退" */
let isQuitting = false;

/* ──────────────────────────────────────────────────────────── */
/*  窗口创建                                                     */
/* ──────────────────────────────────────────────────────────── */

function loadView(win: BrowserWindow, hash: string): void {
  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(`${VITE_DEV_SERVER_URL}#${hash}`);
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash });
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    ...WINDOW_DEFAULTS.main,
    title: 'LangCat',
    backgroundColor: '#4F65F5',
    // frame: false 去掉 OS 标题栏 + Linux 上默认的 File/Edit/View 菜单条;
    // 我们在渲染层用 React 画自定义 TitleBar(品牌蓝 + 拖动区 + 自定义窗口按钮),
    // 跟 VSCode / Discord / Spotify 风格一致,跨平台外观完全统一。
    frame: false,
    // macOS 上保留红绿灯按钮的语义(用户点关闭走 close 事件),但视觉隐藏;
    // 其他平台 frame: false 已经覆盖
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  loadView(mainWindow, '/main');

  if (VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createPopoverWindow(): void {
  popoverWindow = new BrowserWindow({
    ...WINDOW_DEFAULTS.popover,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    // resizable + movable 都打开,让用户拖窗角调整大小、拖标题栏移动位置
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 浮窗在所有 workspace 都显示,叠在全屏应用之上
  popoverWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  loadView(popoverWindow, '/popover');

  // DEBUG 阶段:popover 出来后**只能**靠用户主动 ✕ / ESC 关闭。
  // 之前 blur 自动 hide + 8 秒超时 hide 在 debug 词素拆解时太干扰(用户还没看完就消失)。
  // 等产品稳定后再加回"鼠标久离 popover 自动消失"等优雅行为。
  // popoverWindow.on('blur', () => popoverWindow?.hide());

  // 用户拖动 popover 到任意位置 → 记住坐标,下次弹出在那。
  // 'moved' 事件在 setBounds() 调用时也会触发,需区分"系统设位置"vs"用户拖":
  // 给 popoverWindow 临时打个 isUserMoving 标志(showPopoverFor 设 false,
  // 拖动 mousedown/mouseup 在 renderer 端设 true,但 frameless 上 mousedown 全局
  // 事件不易拿)。简单做法:show 后 100ms 内的 'moved' 当作"系统",其后是用户。
  let lastShowAt = 0;
  const recordUserBounds = (): void => {
    if (!popoverWindow) return;
    if (Date.now() - lastShowAt < 200) return; // 200ms 内是 setBounds 自己触发
    const b = popoverWindow.getBounds();
    userMovedBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  };
  popoverWindow.on('moved', recordUserBounds);
  popoverWindow.on('resized', recordUserBounds);
  // 暴露给 showPopoverFor 设置 lastShowAt
  (popoverWindow as unknown as { _setLastShow: (t: number) => void })._setLastShow = (t) => {
    lastShowAt = t;
  };

  popoverWindow.on('hide', () => {
    if (popoverAutoHideTimer !== null) {
      clearTimeout(popoverAutoHideTimer);
      popoverAutoHideTimer = null;
    }
  });

  // 拦截真正 close,改成 hide(整个 app 生命周期复用同一个窗口)
  popoverWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      popoverWindow?.hide();
    }
  });
}

/* ──────────────────────────────────────────────────────────── */
/*  弹 popover 的核心流程                                        */
/* ──────────────────────────────────────────────────────────── */

/**
 * popover 固定位置:鼠标当前所在显示器的水平中央 + 距底部 POPOVER_BOTTOM_MARGIN
 *
 * 多显示器:用鼠标位置定位"哪一块屏幕",popover 出现在那块屏幕上;
 * 这样多显示器用户在哪个屏幕选词,popover 就出现在哪个屏幕,不会跨屏。
 */
function computePopoverBoundsBottomCenter(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { width, height } = WINDOW_DEFAULTS.popover;

  const x = display.bounds.x + Math.floor((display.bounds.width - width) / 2);
  const y =
    display.bounds.y +
    display.bounds.height -
    height -
    POPOVER_BOTTOM_MARGIN;

  return { x, y, width, height };
}

function showPopoverFor(word: string): void {
  if (!popoverWindow) return;

  // 优先用用户上次拖动到的位置 + 拉伸到的大小(记忆体验);没有就默认屏幕中下方 + 默认尺寸
  const place =
    userMovedBounds !== null
      ? { ...userMovedBounds }
      : computePopoverBoundsBottomCenter();
  // 标记本次 setBounds 的时间,'moved' 事件 200ms 内的回调当作系统触发
  (popoverWindow as unknown as { _setLastShow?: (t: number) => void })._setLastShow?.(Date.now());
  popoverWindow.setBounds(place);
  popoverWindow.webContents.send('langcat:show-word', word);
  // showInactive:popover 出现不偷焦点,用户原应用工作不被打断
  popoverWindow.showInactive();

  // DEBUG 阶段:不启动自动 hide timer。靠 ✕ / ESC 主动关闭。
  // 保留 popoverAutoHideTimer 与 POPOVER_AUTO_HIDE_MS 两个声明,后续打开就两行解注释。
  void POPOVER_AUTO_HIDE_MS;

  lastQueriedWord = word;
  mainWindow?.webContents.send('langcat:lookup-recorded', word);
}

/**
 * 验证剪贴板内容是不是单个合法英文单词。
 *
 * 直接复用渲染层 word-validator 不可行(electron 主进程是 node 环境,有 alias 但 vite-plugin
 * 可能未必处理我们的 @ alias)→ 在主进程里用最小同款逻辑,与 src/lib/word-validator.ts 保持一致
 */
function isValidEnglishWord(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 50) return null;
  if (/\s/.test(trimmed)) return null;
  if (!/^[a-zA-Z]+(-[a-zA-Z]+)*$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * 全局快捷键 Ctrl+Shift+/ 的处理:
 *
 *   1. macOS / Linux:先模拟 Cmd+C / Ctrl+C,把用户当前选中的内容写进剪贴板;
 *      然后读剪贴板拿到刚选的词,弹 popover。
 *      → 用户体验:选中词 → 按快捷键 = 立刻弹新词(不需要先 Cmd+C)。
 *   2. Windows:暂用纯剪贴板模式(用户先 Ctrl+C 再 Ctrl+Shift+/),后续可加
 *      PowerShell SendKeys 模拟。
 *   3. 模拟失败 / Windows / 没合法词 → fallback 读现有剪贴板。
 *
 * 模拟 Cmd+C 用 osascript(macOS 内置)/ xdotool(Linux X11),不引入原生模块。
 * macOS 首次会弹 Accessibility 权限请求,这是合理的(任何"读取选中"的工具都要)。
 *
 * 同一词多次按快捷键不再误判:上一个词跟新剪贴板内容相同时正常重弹(用户可能
 * 想看看 popover 又关掉了想再看一眼),不再依赖 lastQueriedWord 比对。
 */
function simulateCopy(): Promise<void> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];
    if (process.platform === 'darwin') {
      cmd = 'osascript';
      args = ['-e', 'tell application "System Events" to keystroke "c" using command down'];
    } else if (process.platform === 'linux') {
      cmd = 'xdotool';
      args = ['key', '--clearmodifiers', 'ctrl+c'];
    } else {
      // Windows 暂不模拟,直接 resolve
      resolve();
      return;
    }
    try {
      const proc = spawn(cmd, args, { stdio: 'ignore' });
      // 模拟失败(命令不存在 / 权限不够)不阻塞,fallback 到现有剪贴板
      proc.on('error', () => resolve());
      proc.on('exit', () => resolve());
      // 兜底超时 200ms — Accessibility 没授权时 osascript 卡住
      setTimeout(() => {
        try { proc.kill(); } catch {}
        resolve();
      }, 200);
    } catch {
      resolve();
    }
  });
}

async function tryHandleHotkey(): Promise<void> {
  // 模拟系统 copy,等剪贴板传播 ~50ms 再读
  await simulateCopy();
  await new Promise((r) => setTimeout(r, 50));

  const clip = clipboard.readText();
  const word = isValidEnglishWord(clip);
  if (word !== null) {
    showPopoverFor(word);
    return;
  }
  // 剪贴板里不是英文词(可能用户没选中文字 / 选了中文 / 选了一句话):
  // 重弹上次查询,让用户"再看一眼"
  if (lastQueriedWord !== null) {
    showPopoverFor(lastQueriedWord);
  }
}

/* ──────────────────────────────────────────────────────────── */
/*  调 api-go 的统一 fetch 入口                                  */
/* ──────────────────────────────────────────────────────────── */

/**
 * 计配额的端点名 — 渲染层 Sidebar 展示用同一组 key,集中在这里防散落硬编码(规则 5)
 *
 * 跟后端约定:
 *   /api/v1/dictionary/lookup       → 'lookup'
 *   /api/v1/dictionary/regenerate   → 'regenerate'
 *   /api/v1/dictionary/ask          → 'ask'
 *   /api/v1/dictionary/morphemes    → 公开端点,不计配额(返 null)
 */
type QuotaEndpoint = 'lookup' | 'regenerate' | 'ask';

/** URL pathSeg → endpoint name 的映射;命中才广播配额 */
function pathSegToQuotaEndpoint(pathSeg: string): QuotaEndpoint | null {
  if (pathSeg.startsWith('/api/v1/dictionary/lookup')) return 'lookup';
  if (pathSeg.startsWith('/api/v1/dictionary/regenerate')) return 'regenerate';
  if (pathSeg.startsWith('/api/v1/dictionary/ask')) return 'ask';
  return null;
}

/**
 * 错误前缀:跨 IPC 边界传"结构化错误"的简单约定。
 * Electron ipcMain.handle 抛 Error 后,renderer 拿到的 Error 自定义字段会被丢掉,
 * 所以把字段序列化进 message,渲染层统一在 lib/langcat-api.ts 用 parseLangCatError 拆。
 *
 * 选这个方案理由(替代:单独 IPC channel 推 typed error):
 *   - 不引入新 IPC 形态,跟现有 throw new Error 风格一致
 *   - 渲染层 catch 一处即可还原 typed error
 *   - 主进程错误日志依然可读(message 里有完整 JSON)
 */
const LANGCAT_ERR_PREFIX = '__LANGCAT_ERR__:';

/** 429 配额超限的结构化字段,供渲染层显示倒计时 */
interface QuotaExceededPayload {
  kind: 'quota_exceeded';
  endpoint: QuotaEndpoint;
  limit: number;
  remaining: number;
  reset_at: number; // unix seconds
  message: string;
}

interface UnauthorizedPayload {
  kind: 'unauthorized';
  message: string;
}

type LangCatErrPayload = QuotaExceededPayload | UnauthorizedPayload;

function makeLangCatError(payload: LangCatErrPayload): Error {
  return new Error(`${LANGCAT_ERR_PREFIX}${JSON.stringify(payload)}`);
}

/**
 * 后端 429 body 的形状(参见任务说明):
 *   { code: 'quota_exceeded', message, limit, remaining, reset_at }
 */
interface BackendQuotaErrorBody {
  code?: string;
  message?: string;
  limit?: number;
  remaining?: number;
  reset_at?: number;
}

/**
 * 解析 X-RateLimit-* 三联,缺一不广播。
 * 严格 Number 解析,NaN 视作"后端没给"(规则 4:不写隐式默认值)。
 */
function parseRateLimitHeaders(headers: Headers): {
  limit: number;
  remaining: number;
  reset_at: number;
} | null {
  const limitStr = headers.get('X-RateLimit-Limit');
  const remainingStr = headers.get('X-RateLimit-Remaining');
  const resetStr = headers.get('X-RateLimit-Reset');
  if (limitStr === null || remainingStr === null || resetStr === null) {
    return null;
  }
  const limit = Number(limitStr);
  const remaining = Number(remainingStr);
  const reset_at = Number(resetStr);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset_at)) {
    return null;
  }
  // 边界守卫:后端 bug / 时钟漂移 / 恶意 header 注入时,reset_at 可能是过去
  // 时间或离谱的未来。给一个 [now, now+7day] 的合理区间,超出就当 header 异常,
  // 不广播(返 null),让 UI 不显示倒计时,而不是显示一个让人困惑的负数 / 几年。
  // 7 天上限是经验值:任何 LangCat 配额窗口都 ≤ 24h,留一点缓冲。
  const nowSec = Math.floor(Date.now() / 1000);
  const maxFutureSec = 7 * 24 * 3600;
  if (reset_at < nowSec || reset_at > nowSec + maxFutureSec) {
    return null;
  }
  return { limit, remaining, reset_at };
}

/** 配额变更广播 channel(preload 端订阅) */
const IPC_QUOTA_CHANGED = 'langcat:quota-changed';

function broadcastQuota(endpoint: QuotaEndpoint, headers: Headers): void {
  const parsed = parseRateLimitHeaders(headers);
  if (parsed === null) return;
  const payload = { endpoint, ...parsed };
  BrowserWindow.getAllWindows().forEach((win) =>
    win.webContents.send(IPC_QUOTA_CHANGED, payload),
  );
}

/**
 * 所有 main 进程对 api-go 的请求统一走这里,登录态下自动带 Bearer token。
 *
 * 三层职责:
 *   1) 取并刷新 access_token,注入 Authorization 头
 *   2) 解析 X-RateLimit-* 头并广播 quota-changed(成功/失败都广播,只要头存在)
 *   3) 把 401 / 429 转成"结构化错误"throw 出去,其他失败保持普通 Error
 *
 * 调用方拿到的是 fetch 成功的 Response(2xx) —— 401/429 已经被转成 throw,
 * 上层不需要再判这两个状态码。其他非 2xx 仍然返回 Response,调用方自己 if (!resp.ok) 处理。
 */
async function langcatFetch(
  pathSeg: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${LANGCAT_API_BASE_URL}${pathSeg}`;
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const token = await auth.getValidAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const resp = await fetch(url, { ...init, headers });

  // 配额头可能在任何状态码下出现 — 只要带了就广播
  const quotaEndpoint = pathSegToQuotaEndpoint(pathSeg);
  if (quotaEndpoint !== null) {
    broadcastQuota(quotaEndpoint, resp.headers);
  }

  if (resp.status === 401) {
    throw makeLangCatError({ kind: 'unauthorized', message: 'unauthorized' });
  }
  if (resp.status === 429) {
    // 429 必须能拿到 endpoint;公开端点(morphemes)不该返 429,真返了就是后端 bug,
    // 直接 fail-loud(规则 4:不兜底)
    if (quotaEndpoint === null) {
      throw new Error(
        `[LangCat] 公开端点意外 429:${pathSeg} —— 后端配置错误`,
      );
    }
    let body: BackendQuotaErrorBody = {};
    try {
      body = (await resp.json()) as BackendQuotaErrorBody;
    } catch {
      // body 解析失败也要抛 quota_exceeded —— 后端没按约定给 JSON 不影响 UI 反应
      body = {};
    }
    // limit/remaining/reset_at 优先走 body,fallback 到响应头(头是按约定一定有的)
    const headerVals = parseRateLimitHeaders(resp.headers);
    const limit = body.limit ?? headerVals?.limit;
    const remaining = body.remaining ?? headerVals?.remaining;
    const reset_at = body.reset_at ?? headerVals?.reset_at;
    if (
      typeof limit !== 'number' ||
      typeof remaining !== 'number' ||
      typeof reset_at !== 'number'
    ) {
      throw new Error(
        `[LangCat] 429 响应缺少 limit/remaining/reset_at(后端协议未遵守)`,
      );
    }
    throw makeLangCatError({
      kind: 'quota_exceeded',
      endpoint: quotaEndpoint,
      limit,
      remaining,
      reset_at,
      message: body.message ?? 'quota exceeded',
    });
  }

  return resp;
}

/* ──────────────────────────────────────────────────────────── */
/*  生命周期                                                     */
/* ──────────────────────────────────────────────────────────── */

app.whenReady().then(() => {
  // 干掉 Linux/Windows 上 Electron 默认的 File/Edit/View/Window/Help 菜单条。
  // macOS 系统强制保留全局菜单,setApplicationMenu(null) 在 mac 上仍会保留一个
  // 仅含 "LangCat / Quit" 的最小菜单 —— 符合 mac 用户预期。
  Menu.setApplicationMenu(null);

  createMainWindow();
  createPopoverWindow();

  // 全局快捷键 — 触发查词 popover
  const ok = globalShortcut.register(SHORTCUT_LOOKUP, tryHandleHotkey);
  if (!ok) {
    console.error(
      `[LangCat] 全局快捷键注册失败:${SHORTCUT_LOOKUP}。Wayland 下 Electron globalShortcut 受限,` +
        `可以在登录界面切换到 Xorg 会话再试。`,
    );
  } else {
    console.info(`[LangCat] 全局快捷键已注册:${SHORTCUT_LOOKUP}`);
  }

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  // popover 主动关闭(ESC 键 / ✕ 按钮)
  ipcMain.on('langcat:close-popover', () => popoverWindow?.hide());

  // LangCat 词素学习库查询 —— main 进程 fetch 中转,绕开 renderer 的 CORS
  // 协议:renderer 通过 ipcRenderer.invoke('langcat:lookup-langcat', word)
  //       main 返回原始 { data } 或抛 Error;renderer 在 lib/langcat-api 里解析
  ipcMain.handle(
    'langcat:lookup-langcat',
    async (_event, rawWord: unknown): Promise<unknown> => {
      if (typeof rawWord !== 'string' || rawWord.trim() === '') {
        throw new Error('[LangCat] lookup-langcat 必须传非空 word 字符串');
      }
      const word = rawWord.trim();
      const resp = await langcatFetch(
        `/api/v1/dictionary/lookup?word=${encodeURIComponent(word)}`,
        { method: 'GET' },
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }
      return await resp.json();
    },
  );

  // 单词本本地存储:list / add / remove
  ipcMain.handle('langcat:vocabulary-list', () => vocabulary.listVocabulary());
  ipcMain.handle('langcat:vocabulary-add', async (_e, w: unknown) => {
    if (typeof w !== 'string') throw new Error('vocabulary-add: word must be string');
    const next = await vocabulary.addToVocabulary(w);
    // 广播给所有窗口(主窗口需要刷新单词本列表)
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send('langcat:vocabulary-changed', next),
    );
    return next;
  });
  ipcMain.handle('langcat:vocabulary-remove', async (_e, w: unknown) => {
    if (typeof w !== 'string') throw new Error('vocabulary-remove: word must be string');
    const next = await vocabulary.removeFromVocabulary(w);
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send('langcat:vocabulary-changed', next),
    );
    return next;
  });
  ipcMain.handle('langcat:vocabulary-mark-reviewed', async (_e, w: unknown) => {
    if (typeof w !== 'string') throw new Error('vocabulary-mark-reviewed: word must be string');
    const next = await vocabulary.markReviewed(w);
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send('langcat:vocabulary-changed', next),
    );
    return next;
  });

  // 强制重生成:用户对当前词条不满意点 popover 🔄 时触发
  // POST /api/v1/dictionary/regenerate?word=xxx,后端走最新 prompt 重写整行
  ipcMain.handle(
    'langcat:regenerate-langcat',
    async (_event, rawWord: unknown): Promise<unknown> => {
      if (typeof rawWord !== 'string' || rawWord.trim() === '') {
        throw new Error('[LangCat] regenerate-langcat 必须传非空 word 字符串');
      }
      const word = rawWord.trim();
      const resp = await langcatFetch(
        `/api/v1/dictionary/regenerate?word=${encodeURIComponent(word)}`,
        { method: 'POST' },
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }
      return await resp.json();
    },
  );

  // 词素全量列表 —— 桌面"词根表"视图用,一次返回 ~120 行,客户端做筛选/搜索
  ipcMain.handle('langcat:list-morphemes', async (): Promise<unknown> => {
    const resp = await langcatFetch('/api/v1/dictionary/morphemes', { method: 'GET' });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
  });

  // 词条追问 AI —— popover 底部"问 AI"输入框触发
  // body: { word, question, history?: [{role, content}] }
  ipcMain.handle(
    'langcat:ask-ai',
    async (_event, payload: unknown): Promise<unknown> => {
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('[LangCat] ask-ai payload 必须是对象');
      }
      const resp = await langcatFetch('/api/v1/dictionary/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        // 把后端返回的错误正文带上来(让 client 显示给用户)
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
      return await resp.json();
    },
  );

  /* ──────────── 认证(Supabase Auth REST 中转) ──────────── */

  // 单词本是按"用户桶"存的 — 登录态变化时同时把当前用户的列表推一次,
  // UI 端的 onVocabularyChanged 自动接住,免得用户看到上个账号的词。
  async function broadcastVocab(): Promise<void> {
    const items = await vocabulary.listVocabulary();
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send('langcat:vocabulary-changed', items),
    );
  }

  function broadcastAuth(): void {
    const sess = auth.currentSession();
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send('langcat:auth-changed', sess),
    );
    // 切桶 → 切单词本视图
    void broadcastVocab().catch((err) =>
      console.warn('[LangCat] broadcast vocab on auth-change failed', err),
    );
  }

  // 启动时:迁移旧单词本文件 + 加载已保存的 session
  void vocabulary
    .migrateLegacyFile()
    .catch((err) => console.warn('[LangCat] 单词本迁移失败:', err));

  void auth.loadSession().then((sess) => {
    if (sess) {
      console.info('[LangCat] 启动时载入登录态:', sess.user.email);
      broadcastAuth();
    }
  });

  ipcMain.handle('langcat:auth-current', () => auth.currentSession());

  ipcMain.handle('langcat:auth-sign-in', async (_e, payload: unknown) => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { email?: unknown }).email !== 'string' ||
      typeof (payload as { password?: unknown }).password !== 'string'
    ) {
      throw new Error('auth-sign-in: 需要 { email, password }');
    }
    const { email, password } = payload as { email: string; password: string };
    await auth.signIn(email, password);
    broadcastAuth();
    return auth.currentSession();
  });

  ipcMain.handle('langcat:auth-sign-up', async (_e, payload: unknown) => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { email?: unknown }).email !== 'string' ||
      typeof (payload as { password?: unknown }).password !== 'string'
    ) {
      throw new Error('auth-sign-up: 需要 { email, password }');
    }
    const { email, password } = payload as { email: string; password: string };
    const sess = await auth.signUp(email, password);
    broadcastAuth();
    // sess 为 null 表示需要邮件验证 —— 客户端据此提示用户去查邮件
    return {
      session: auth.currentSession(),
      needs_email_verification: sess === null,
    };
  });

  ipcMain.handle('langcat:auth-sign-out', async () => {
    await auth.signOut();
    broadcastAuth();
    return null;
  });

  // 自定义 TitleBar 的窗口操作 IPC
  ipcMain.on('langcat:window-minimize', () => mainWindow?.minimize());
  ipcMain.on('langcat:window-toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('langcat:window-close', () => mainWindow?.close());

  // 把"是否最大化"状态推给渲染层,TitleBar 据此切换 □ / ⧉ 图标
  if (mainWindow) {
    const broadcastMaximized = (): void => {
      mainWindow?.webContents.send(
        'langcat:window-maximized-changed',
        mainWindow.isMaximized(),
      );
    };
    mainWindow.on('maximize', broadcastMaximized);
    mainWindow.on('unmaximize', broadcastMaximized);
  }

  if (!VITE_DEV_SERVER_URL) {
    setupAutoUpdater(() => mainWindow);
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    createPopoverWindow();
  }
});
