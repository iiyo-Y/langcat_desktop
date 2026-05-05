# LangCat Desktop

跨平台桌面端(macOS / Windows / Linux),把 [`langcat_chome`](../langcat_chome/) 的核心查词体验搬到独立应用。

第一步 MVP:hover 任意英文单词,显示音标 + Free Dictionary 释义 + MyMemory 中文翻译。

---

## 1 · 本地测试(Linux / macOS / Windows 都一样)

```bash
cd langcat_desktop
pnpm install
pnpm dev          # 起 Vite + Electron 开发窗口,DevTools 自动开
```

### Linux 特别说明

Electron 在 Linux 上跑需要这些系统库,Ubuntu 22.04+ 桌面版自带,装精简 server 才需要补:

```bash
sudo apt install -y libgtk-3-0 libnss3 libxss1 libasound2t64 libsecret-1-0
```

跑 `pnpm dev` 后看到一个品牌蓝标题栏的窗口、左半文本框、右半 hover 区,鼠标停在英文单词上 250ms 出 popover,就是工作正常。

### 开发循环

```bash
pnpm typecheck    # 仅类型校验,不构建
pnpm build        # typecheck + 全栈编译(renderer + electron main + preload)
pnpm preview      # 预览生产构建产物(无 electron-builder 包装)
```

---

## 2 · 跨平台打包

### 2.1 现实约束(必须先看)

| 平台 | 在 Linux 本机能产出"用户可用"的包? |
|------|-------------------------------------|
| **Linux** AppImage | ✅ 完全可以,自用直接 `chmod +x && ./LangCat-x.y.z.AppImage` |
| **Windows** NSIS .exe | ⚠️ 能产出,但**未签名**,用户首次启动 SmartScreen 会警告 + 杀毒可能误报 |
| **macOS** .dmg | ❌ Linux 上跑出来的 .dmg **不能用** —— Apple Gatekeeper 会拒绝执行,只有 macOS 上签名后才合法 |

→ **正确做法**:本地只用来快速试 Linux 包,**真正的发布走 GitHub Actions 三平台 runner**(见 §3)。

### 2.2 本地命令(自用 / 测试)

```bash
pnpm package:linux    # → release/LangCat-0.1.0-linux-x64.AppImage
pnpm package:win      # → release/LangCat-0.1.0-win-x64.exe(electron-builder 自动下 wine)
pnpm package:mac      # → release/LangCat-0.1.0-mac-{arm64,x64}.dmg(Linux 上跑结果不可用)
pnpm package:all      # 三平台一次跑(Linux 上 mac 那份等于白干)
```

---

## 3 · 一键发版(自动更新核心流程)

整套设计:**改代码 → `pnpm release patch` → `git push --follow-tags` → CI 三平台并行打包 → 自动上传到 GitHub Releases → 已安装客户端下次启动时无感更新**。

### 3.1 先做一次性配置

```bash
# 1. 把 langcat_desktop 接成独立 GitHub repo
cd langcat_desktop
git init
git add .
git commit -m "feat: initial scaffolding"
git branch -M main
git remote add origin git@github.com:<你的用户名>/langcat-desktop.git
git push -u origin main

# 2. GitHub repo 设置 → Actions → General → Workflow permissions
#    勾选 "Read and write permissions"(让 GITHUB_TOKEN 能创建 release)
```

> 也可以把 langcat_desktop 放进现有 monorepo,把 `.github/workflows/release.yml` 里的 step 加上 `working-directory: langcat_desktop` 即可。

### 3.2 发版流程

```bash
# 工作区干净 + 在 main 上时:
pnpm release patch       # 0.1.0 → 0.1.1
# 或 minor / major
git push --follow-tags   # 触发 CI
```

CI 会跑 `.github/workflows/release.yml`:matrix 起三个 runner(macos-latest / windows-latest / ubuntu-latest)各自 `pnpm install` → `pnpm build` → `electron-builder --publish always`,产物自动上传到 `v0.1.1` tag 对应的 GitHub Release。

随附自动生成 `latest.yml`(Windows 用) / `latest-mac.yml` / `latest-linux.yml` —— 这是客户端 electron-updater 检测新版本的依据。

### 3.3 自动更新(用户侧)

代码在 [`electron/updater.ts`](electron/updater.ts)。流程:

1. 用户启动应用,5 秒后主进程静默 check 远端 `latest*.yml`
2. 每 4 小时再 check 一次(只要应用还开着)
3. 发现新版本 → 后台静默下载(不打扰用户工作)
4. 下载完成 → 弹原生对话框「立即重启更新 / 稍后」
5. 选"稍后"时不强制,下次启动会自动装上

**关键决定**:
- 不主动重启用户的应用(规避正在 hover 查词时被强制中断)
- dev 模式跳过 updater(避免本地开发反复打公网,且 dev 没有签名 electron-updater 会抛错)

### 3.4 签名(从 dev 阶段过渡到正式发布时再做)

| 平台 | 必要性 | 做什么 |
|------|--------|--------|
| **macOS** | 🔴 必须 | 申请 Apple Developer ID($99/年),拿到 Developer ID Application 证书,在 GitHub repo Settings → Secrets 配 `MAC_CSC_LINK`(.p12 base64)+ `MAC_CSC_KEY_PASSWORD` + `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`,然后取消 [.github/workflows/release.yml](.github/workflows/release.yml) 里这几行的注释。否则 macOS 用户首次打开会被 Gatekeeper 拒。 |
| **Windows** | 🟡 建议 | EV 代码签名证书一年大概 $200~400,配 `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`。不签名也能跑,但 SmartScreen 红色警告体验差。 |
| **Linux** | 🟢 不需要 | AppImage 不强制签名。 |

签名生效前的过渡期:macOS 用户用 `xattr -cr /Applications/LangCat.app` 绕过,Windows 用户点"仍要运行"。

---

## 4 · 切换更新源(从 GitHub 换到自建 / 国内 CDN)

[`electron-builder.yml`](electron-builder.yml) 的 `publish` 改成:

```yml
publish:
  - provider: generic
    url: https://download.langcat.example/desktop/
```

把 GitHub Release 产出的 `latest*.yml` + 安装包同步到这个 URL(可以做成 CI 的额外 step:`aws s3 sync release/ s3://...`)。客户端代码不用改,electron-updater 自动从新地址取。

如果你想下载入口走 [`langcat_web`](../langcat_web/) 站点 + 安装包仍托在 GitHub Release —— 这是最省事的过渡:`langcat_web` 的下载按钮直接链到 GitHub Release 的 `*.dmg / *.exe / *.AppImage`,客户端 electron-updater 也走 GitHub。

---

## 5 · 目录结构

```
langcat_desktop/
├── electron/                    # 主进程 + preload(Node 环境)
│   ├── main.ts                  # 创建 BrowserWindow,加载 dev URL 或 dist
│   ├── preload.ts               # IPC 桥接占位
│   └── updater.ts               # electron-updater 接入
├── src/                         # 渲染层(浏览器环境)
│   ├── components/{Header,HoverableText,WordPopover}.tsx
│   ├── config/                  # 设计 token / API 端点 / 常量
│   ├── lib/                     # 字典 / 翻译 / HTTP / 分词
│   ├── types/word.ts
│   ├── styles/global.css
│   ├── App.tsx
│   └── main.tsx
├── public/brand/                # logo + 角色图
├── build/icon.png               # electron-builder 应用图标
├── scripts/release.mjs          # 一键 bump + commit + tag
├── .github/workflows/release.yml # 三平台并行打包 + 上传 Release
├── electron-builder.yml         # 打包 + 自动更新发布配置
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json + tsconfig.node.json
└── package.json
```

---

## 6 · 与 `langcat_chome` 的关系

设计 token、字典/翻译 API 客户端、错误类型、单词类型 —— 逐字镜像自 `langcat_chome/src/{config,lib,types}/`,这样:

- 视觉/行为一致(用户在网页扩展和桌面应用之间切换零落差)
- 后续抽出 `langcat_core` 共享包时迁移成本极低

## 7 · 路线图(MVP 之后)

1. 一键收藏到本地单词本(SQLite via better-sqlite3,持久化在 `app.getPath('userData')`)
2. SidePanel 风格的完整单词本(搜索 / 排序 / 朗读 / JSON-CSV 导出)
3. 玩乐模式(把单词藏在文本里点击揭秘)
4. 与 `langcat_web` 后端打通,登录后云同步词库 + 多设备一致
