/**
 * 自动更新模块
 *
 * 职责:启动后静默 check 远端 release(由 electron-builder 的 publish 配置决定具体地址,
 * 默认 GitHub Releases)→ 后台下载 → 下载完温柔询问用户是否立即重启更新。
 *
 * 设计取舍:
 * - **不**静默自动重启:用户正在 hover 查词时如果应用突然重启,体验是灾难。
 *   只在用户主动点击对话框 "立即更新" 时才 quitAndInstall(),否则等用户下次启动才装。
 * - **不**在 dev 模式启动:vite-plugin-electron 给 main 进程注入 VITE_DEV_SERVER_URL,
 *   存在则跳过,避免 dev 时频繁去打公网。
 * - 错误**不**弹窗扰民:仅 console.error,不打扰用户(规则 4 的边界:UI 上"无打扰"
 *   不算掩盖错误,主进程日志仍然 fail loud)。
 */

import { app, dialog, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

// autoUpdater 是 electron-updater 的 lazy getter:首次访问时才会实例化
// AppImageUpdater(Linux) / MacUpdater(mac) / NsisUpdater(win),实例化里调
// app.getVersion(),依赖 electron.app 已 ready。CJS 模块加载是同步 eager,
// 顶层 destructure 会在 app ready 之前触发,直接崩。改成 module-level 占位 +
// setup 内首次赋值,保证只在 app.whenReady 之后访问。
type AutoUpdater = typeof electronUpdater.autoUpdater;
let autoUpdater: AutoUpdater | null = null;
function getAutoUpdater(): AutoUpdater {
  if (autoUpdater === null) {
    autoUpdater = electronUpdater.autoUpdater;
  }
  return autoUpdater;
}

const UPDATER_CONFIG = {
  /**
   * 启动后多久首次检查(ms)。
   *
   * 之前 5s,但国内网络环境下 GitHub Releases API 经常慢(被墙 / CDN 抖动),
   * 5s check 后 fetch 偶尔卡 30-60s timeout,虽然不阻塞 UI 但 main 进程 event
   * loop 占着拖慢整体响应。改 30s 给主窗 + popover 充分时间渲染稳定后再走网。
   */
  initialCheckDelayMs: 30 * 1000,
  /** 应用运行期间多久轮询一次(ms),默认 4 小时 */
  recurringCheckIntervalMs: 4 * 60 * 60 * 1000,
} as const;

let setupCompleted = false;

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (setupCompleted) {
    throw new Error('[LangCat] setupAutoUpdater 被重复调用');
  }
  setupCompleted = true;

  // 不自动下载是给我们机会做"先弹窗确认再下载"流程;但本 MVP 选静默下载,
  // 等下载完再询问,所以保持默认 true。代码里显式注明,便于以后改策略。
  getAutoUpdater().autoDownload = true;
  getAutoUpdater().autoInstallOnAppQuit = true;

  getAutoUpdater().on('checking-for-update', () => {
    console.info('[updater] 正在检查更新…');
  });

  getAutoUpdater().on('update-available', (info) => {
    console.info('[updater] 发现新版本', info.version);
  });

  getAutoUpdater().on('update-not-available', () => {
    console.info('[updater] 已是最新版本');
  });

  getAutoUpdater().on('download-progress', (progress) => {
    // 整数百分比够用了,多打小数点没意义
    console.info(`[updater] 下载中 ${Math.floor(progress.percent)}%`);
  });

  getAutoUpdater().on('update-downloaded', (info) => {
    console.info('[updater] 新版本已下载', info.version);
    void promptInstall(getMainWindow(), info.version);
  });

  getAutoUpdater().on('error', (err) => {
    console.error('[updater] 自动更新出错:', err);
  });

  // 启动延迟 + 周期性检查
  setTimeout(() => {
    void getAutoUpdater().checkForUpdates();
    setInterval(() => {
      void getAutoUpdater().checkForUpdates();
    }, UPDATER_CONFIG.recurringCheckIntervalMs);
  }, UPDATER_CONFIG.initialCheckDelayMs);
}

/**
 * 向用户询问是否立即重启更新
 *
 * 用 Electron 原生 dialog,跨平台一致,不依赖渲染层是否已经 ready。
 */
async function promptInstall(
  parent: BrowserWindow | null,
  version: string,
): Promise<void> {
  const { response } = await dialog.showMessageBox(parent ?? undefined!, {
    type: 'info',
    buttons: ['立即重启更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    title: 'LangCat 有新版本可用',
    message: `LangCat ${version} 已经下载好啦 🐱`,
    detail: '重启应用即可启用新版本;选「稍后」也可以,下次启动时会自动装上。',
  });

  if (response === 0) {
    // quitAndInstall 必须在 app 完全准备好之后才能调用
    if (app.isReady()) {
      getAutoUpdater().quitAndInstall();
    } else {
      app.once('ready', () => getAutoUpdater().quitAndInstall());
    }
  }
}
