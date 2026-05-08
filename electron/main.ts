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

/**
 * macOS 专属:popover 失焦后多久自动隐藏(ms)。
 *
 * 这是 macOS spotlight / alfred / 通知中心等系统浮窗的标准行为 —— 用户点击别处即关闭。
 * 给 500ms 缓冲是因为:用户可能从 popover 切到别的窗口拷贝内容、再切回 popover,
 * 这种"短暂离开"不应该误隐;如果真的离开 0.5s 没回来,认定用户已经看完。
 *
 * 注意:仅 macOS 启用。Linux Wayland 下 blur 事件不可靠(有时窗口在前台也会 spurious blur),
 * 强行启用会误隐;Windows 也暂不启用,等真有用户反馈再说。
 */
const POPOVER_BLUR_HIDE_DELAY_MS = 500;

/**
 * 'moved' / 'resized' 事件的"系统触发"窗口期(ms)。
 *
 * setBounds() 在 macOS / Linux 下都会触发 'moved' 事件;我们用这个时间窗区分
 * "系统刚 setBounds 导致的 moved"vs"用户拖动导致的 moved"。
 * 200ms 是经验值:setBounds 异步派发 moved 通常 < 50ms,留 4 倍裕量。
 */
const POPOVER_SETBOUNDS_GRACE_MS = 200;

/** 剪贴板 polling 间隔(ms)— Electron 没原生 clipboard event,polling 是唯一手段 */
const CLIPBOARD_POLL_MS = 400;

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
/** popover 失焦自动隐藏的 timer(仅 macOS);focus 时清掉 */
let popoverBlurHideTimer: ReturnType<typeof setTimeout> | null = null;
/** 上次 setBounds 的时间戳,用于区分 'moved' 事件来源(系统 vs 用户拖) */
let popoverLastShowAt = 0;

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

  // macOS 标准行为:红色按钮 / Cmd+W 关 mainWindow 是 hide,不是真销毁。
  // 不这么做的后果:popoverWindow 是 skipTaskbar=true,主窗一关 macOS 把整个
  // app 从 Dock 撤掉,看起来 LangCat 退出了 —— 但实际上 popoverWindow 还活着,
  // 用户再按快捷键也呼不出 Dock icon,体验上等同 app 死了。
  // 拦截 close 改 hide 后:Dock 图标保留,用户 click Dock 走 'activate' 事件
  // 重新 show 主窗。只在 Cmd+Q (before-quit 触发 isQuitting=true) 才真退。
  // Linux / Windows 不需要这个行为(关主窗 = 退出 app 是用户预期),
  // 所以只拦 darwin。
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      // app.dock 在 hide mainWindow 后仍保留 LangCat 图标(因为 popoverWindow
      // 还在,且 setActivationPolicy('regular') 已显式声明 LangCat 是 Dock app)
    }
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

  // 浮窗在所有 workspace 都显示,叠在全屏应用之上。
  // 注意:macOS 上 hide() 后这个状态会被系统重置 —— 每次 show 前必须重新 setVisibleOnAllWorkspaces,
  // 否则二次 show 时窗口虽然 visible,但只在当前 workspace 显示、且不再叠在全屏应用之上。
  popoverWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  loadView(popoverWindow, '/popover');

  // popover 给一个独立的空菜单 —— 这是 macOS 上 Cmd+W bug 的关键修复:
  // macOS 全局菜单的"File → Close Window"默认 accelerator = Cmd+W,被路由到当前 focus 的窗口。
  // 之前 setApplicationMenu(null) 后 macOS 仍保留系统最小菜单,Cmd+W 触发的 close 路径在
  // frameless transparent 窗口上有时绕过 'close' 事件的 preventDefault,导致 webContents
  // 被销毁/标记 destroyed,后续 setBounds / showInactive 静默失败 → 用户报告"hotkey 不再弹"。
  // 给 popover 单独 setMenu(null) + 在 webContents 拦截 Cmd+W,统一走 hide。
  popoverWindow.setMenu(null);

  // 在 popover focus 时拦截 Cmd+W / Ctrl+W:走 hide,而不是触发系统 close
  popoverWindow.webContents.on('before-input-event', (event, input) => {
    // before-input-event 是 keydown/keyup;只看 keydown 防重复
    if (input.type !== 'keyDown') return;
    const isCmdOrCtrl = process.platform === 'darwin' ? input.meta : input.control;
    if (isCmdOrCtrl && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      popoverWindow?.hide();
    }
    // ESC 也在这里兜底拦截 —— 渲染层应该已经处理,这里是双保险
    if (input.key === 'Escape') {
      event.preventDefault();
      popoverWindow?.hide();
    }
  });

  // 用户拖动 popover 到任意位置 → 记住坐标,下次弹出在那。
  // 'moved' 事件在 setBounds() 调用时也会触发,需区分"系统设位置"vs"用户拖":
  // 简单做法 —— show 后 POPOVER_SETBOUNDS_GRACE_MS 内的 'moved' 当作"系统触发",其后才算用户拖。
  const recordUserBounds = (): void => {
    if (!popoverWindow || popoverWindow.isDestroyed()) return;
    if (Date.now() - popoverLastShowAt < POPOVER_SETBOUNDS_GRACE_MS) return;
    const b = popoverWindow.getBounds();
    userMovedBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  };
  popoverWindow.on('moved', recordUserBounds);
  popoverWindow.on('resized', recordUserBounds);

  popoverWindow.on('hide', () => {
    if (popoverAutoHideTimer !== null) {
      clearTimeout(popoverAutoHideTimer);
      popoverAutoHideTimer = null;
    }
    if (popoverBlurHideTimer !== null) {
      clearTimeout(popoverBlurHideTimer);
      popoverBlurHideTimer = null;
    }
  });

  // 仅 macOS:popover blur 后延迟自动隐藏 —— spotlight 风格的失焦消失。
  // Linux Wayland 下 blur 事件不可靠(有时窗口在前台也会 spurious blur),不启用以免误隐;
  // Windows 暂时不启用,等真有用户反馈再考虑。规则 4(严禁 fallback):用 platform 显式分支,
  // 不写"反正其他平台试试也行"。
  if (process.platform === 'darwin') {
    popoverWindow.on('blur', () => {
      if (popoverBlurHideTimer !== null) clearTimeout(popoverBlurHideTimer);
      popoverBlurHideTimer = setTimeout(() => {
        // 触发时再校验一次窗口状态,防止 timer fire 时窗口已经被销毁
        if (popoverWindow && !popoverWindow.isDestroyed() && popoverWindow.isVisible()) {
          popoverWindow.hide();
        }
        popoverBlurHideTimer = null;
      }, POPOVER_BLUR_HIDE_DELAY_MS);
    });
    popoverWindow.on('focus', () => {
      // 用户切回 popover 取消延迟隐藏
      if (popoverBlurHideTimer !== null) {
        clearTimeout(popoverBlurHideTimer);
        popoverBlurHideTimer = null;
      }
    });
  }

  // 拦截真正 close,改成 hide(整个 app 生命周期复用同一个窗口)。
  // macOS 上 Cmd+W 的 close 路径已经被 before-input-event 拦截;这里兜底处理:
  //   - 主进程发起的 close(window-all-closed 等)
  //   - 渲染层 window.close() 调用
  // isQuitting === true 时(app 即将退出)不拦截,让窗口正常销毁。
  popoverWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      popoverWindow?.hide();
    }
  });

  // 渲染层崩溃恢复:JS 异常 / OOM / GPU 进程崩溃都会触发 'render-process-gone'。
  // 重新 load 同一个 hash,popover 状态(位置 / 大小)仍然由主进程的 userMovedBounds 保留。
  // 触发时机:用户在 popover 里点了某个按钮 → 渲染层 throw → 整个 popover 白屏 / 黑屏。
  popoverWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[LangCat] popover 渲染进程崩溃,自动重载:', details.reason);
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      // hide 一下,reload 期间窗口会闪一下,先隐藏更优雅;下次快捷键再 show
      popoverWindow.hide();
      loadView(popoverWindow, '/popover');
    }
  });

  // 'closed' 事件:窗口真的被销毁(只有 isQuitting === true 时才会到这一步)。
  // 把引用清掉,ensurePopoverAlive 下次会发现并重建(虽然 quit 时不会再 ensurePopoverAlive,
  // 但保留这个 handler 是好习惯,防止野指针)。
  popoverWindow.on('closed', () => {
    popoverWindow = null;
  });
}

/**
 * 修 bug 的关键防御:每次要操作 popover 前,先确保它"活着"。
 *
 * 三种异常状态我们都要兜:
 *   1) popoverWindow === null —— 进程刚启动还没 createPopoverWindow,或被 'closed' 清空
 *   2) popoverWindow.isDestroyed() === true —— webContents 已销毁,后续任何 API 都会 throw
 *   3) popoverWindow.webContents.isDestroyed() —— 罕见,但 macOS 上 Cmd+W 历史 bug 出现过
 *
 * 任何一种 → 重新 createPopoverWindow,引用替换。这是修 macOS"hotkey 关闭后不再弹"
 * 这个 bug 的核心:之前的代码只检查 `if (!popoverWindow) return`,destroyed 状态下
 * 引用还在,setBounds 会 throw 然后被外层吞掉(因为是事件回调里直接 await 的),
 * 用户看到的就是"按快捷键没反应"。
 */
function ensurePopoverAlive(): void {
  const dead =
    popoverWindow === null ||
    popoverWindow.isDestroyed() ||
    popoverWindow.webContents.isDestroyed();
  if (dead) {
    console.warn('[LangCat] popover 不可用,重建中…');
    createPopoverWindow();
  }
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
  // 防御:hotkey 触发时窗口可能已被销毁(macOS 上 Cmd+W / 渲染崩溃 / 系统回收)
  // 必须在用 popoverWindow 之前重建,这是修"关闭后 hotkey 不再弹"bug 的核心
  ensurePopoverAlive();
  if (!popoverWindow || popoverWindow.isDestroyed()) {
    // 经过 ensurePopoverAlive 还是 null —— createPopoverWindow 失败了,fail-loud
    console.error('[LangCat] showPopoverFor: popover 重建失败');
    return;
  }

  // 优先用用户上次拖动到的位置 + 拉伸到的大小(记忆体验);没有就默认屏幕中下方 + 默认尺寸
  const place =
    userMovedBounds !== null
      ? { ...userMovedBounds }
      : computePopoverBoundsBottomCenter();

  // 标记本次 setBounds 的时间,'moved' 事件 grace 期内的回调当作系统触发
  popoverLastShowAt = Date.now();
  popoverWindow.setBounds(place);

  // macOS 边界:hide 后 setVisibleOnAllWorkspaces / alwaysOnTop 状态会被系统重置。
  // 二次 show 前必须显式重设,否则 popover 不会浮在全屏应用之上、可能被 dock 应用遮挡。
  // Linux / Windows 上无此问题,但重设无副作用,统一执行简化代码。
  popoverWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  popoverWindow.setAlwaysOnTop(true, 'floating');

  popoverWindow.webContents.send('langcat:show-word', word);

  // showInactive:popover 出现不偷焦点,用户原应用工作不被打断。
  // macOS 上 showInactive 在 hide → show 循环里偶有失效报告(electron #11782 系列),
  // 但目前实测 33.x 上修好了;若用户再报"窗口在但在底层",改成 show() + 立即 blur 模拟。
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
/**
 * 智能剪贴板模式 —— LangCat 的核心触发流(MVP 阶段)
 *
 * 历史选型回顾:
 *   - 第一版:剪贴板变化即弹 → 误触发太多(复制中文也弹)
 *   - 第二版:Cmd+Shift+/ 触发 osascript 模拟 Cmd+C → macOS TCC 子进程不继承父权限,silent fail
 *   - 第三版:nut-js native module 模拟 Cmd+C → 权限挂 LangCat 但 macOS TCC 缓存按二进制 hash,
 *            每次新版升级权限失效,且 native module 让 build 复杂
 *   - **当前(第四版):智能剪贴板 watcher + 严格白名单过滤**
 *
 * 工作流:
 *   1. 用户选中英文词 → ⌘C(系统标准复制,LangCat 不拦截不模拟)
 *   2. LangCat 后台 polling(CLIPBOARD_POLL_MS=400ms)看 clipboard.readText()
 *   3. 内容变化时,过 isValidEnglishWord 严格白名单:
 *      - 长度 2-50 字母,无空格,可有连字符 → 弹 popover
 *      - 中文 / 句子 / URL / 数字 / 长串 → 不弹(不打扰)
 *   4. 同一词反复复制不重弹(lastQueriedWord 比对)
 *
 * 优势:
 *   - 0 macOS 权限要求(剪贴板 read 是公共能力)
 *   - 不依赖 native module,build 简单
 *   - 单步操作:⌘C 即弹
 *   - 严格过滤把误触发降到极低(99% 复制都不是英文单词)
 *
 * Cmd+Shift+/ 仍保留作为"召回快捷键":
 *   - 用户关闭 popover 后想再看一眼 → 按快捷键重弹 lastQueriedWord
 *   - 直接读 clipboard,不模拟任何键盘事件,不依赖 TCC
 */

/** 上次见到的剪贴板文本,polling 时跟当前比对判断"变化" */
let lastClipboardSeen = '';

function tickClipboardWatch(): void {
  const clip = clipboard.readText();
  if (clip === lastClipboardSeen) return;
  lastClipboardSeen = clip;

  const word = isValidEnglishWord(clip);
  if (word === null) return; // 严格过滤:不是单个英文词就不弹
  if (word === lastQueriedWord) return; // 同一词反复复制不打扰

  showPopoverFor(word);
}

/**
 * 全局快捷键 ⌘+Shift+/ —— "召回 / 备份触发"。
 *
 * 不再尝试模拟 Cmd+C(nut-js / osascript 路线已撤);单纯读当前剪贴板:
 *   - 剪贴板里是合法英文词 + 不是上次的 → 弹这个词(等价手动触发剪贴板 watcher)
 *   - 不是合法词 / 跟上次相同 → 重弹 lastQueriedWord(用户关掉了想再看一眼)
 *   - 没 lastQueriedWord 也没合法剪贴板 → 静默(不弹空 popover)
 */
function tryHandleHotkey(): void {
  const clip = clipboard.readText();
  const word = isValidEnglishWord(clip);
  if (word !== null && word !== lastQueriedWord) {
    showPopoverFor(word);
    return;
  }
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

// 早版本 macOS 辅助功能权限引导已移除 —— v0.5.0 起改纯剪贴板智能 watcher 模式,
// 不再模拟键盘,不需要 Accessibility 权限。

/* ──────────────────────────────────────────────────────────── */
/*  生命周期                                                     */
/* ──────────────────────────────────────────────────────────── */

app.whenReady().then(() => {
  // 干掉 Linux/Windows 上 Electron 默认的 File/Edit/View/Window/Help 菜单条。
  // macOS 系统强制保留全局菜单,setApplicationMenu(null) 在 mac 上仍会保留一个
  // 仅含 "LangCat / Quit" 的最小菜单 —— 符合 mac 用户预期。
  Menu.setApplicationMenu(null);

  // macOS Dock 行为:
  //   - 默认 'regular' 策略 = LangCat 在 Dock 显示图标、可被 ⌘+Tab 切换 —— 这正是我们要的。
  //   - 不调 app.dock.hide() —— hide 会让 LangCat 变成"无图标后台进程",
  //     用户主窗口最小化 / 关闭后无法通过 Dock click 重新激活,体验差。
  //   - popover 用 showInactive() 不偷焦点,popover 显示时 LangCat 不会在 Dock 跳跃。
  //   - 显式 setActivationPolicy('regular') 强保险,防止 electron-builder 配置漂移。
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
  }

  createMainWindow();
  createPopoverWindow();

  // 启动时把当前剪贴板内容当 baseline,避免 LangCat 一启动就误弹(用户启动前复制的旧内容不该弹)
  lastClipboardSeen = clipboard.readText();

  // 智能剪贴板 watcher:每 CLIPBOARD_POLL_MS 看一眼,内容变 + 是合法英文词 → 弹 popover
  const clipboardTimer = setInterval(tickClipboardWatch, CLIPBOARD_POLL_MS);

  // 全局快捷键 — 召回 popover(⌘+Shift+/),不再模拟 Cmd+C
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
    clearInterval(clipboardTimer);
    globalShortcut.unregisterAll();
  });

  // popover 主动关闭(ESC 键 / ✕ 按钮 / Cmd+W 由 before-input-event 拦截)
  // 统一走 hide,绝不 destroy;destroyed 状态由 ensurePopoverAlive 在下次 show 时兜
  ipcMain.on('langcat:close-popover', () => {
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.hide();
    }
  });

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

  // 应用版本(从 package.json 读,electron 内置 API)。release.yml 在 build 前
  // 把 git tag 写进 package.json version,所以这里返的就是当前装的真实版本号,
  // 自动更新到新版后值会跟着变(无需改代码)。
  ipcMain.handle('langcat:app-version', () => app.getVersion());

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
  // macOS:用户点 Dock 图标 / 用 ⌘+Tab 切回 LangCat 时触发。
  // 用户预期是看到主窗口;如果主窗口被关掉了就重建,popover 也保险重建一次。
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    createPopoverWindow();
    return;
  }
  // 主窗口还在但被最小化 / 红点 hide → 还原并 focus
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});
