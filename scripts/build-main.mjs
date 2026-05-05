/**
 * 用 esbuild 单独 bundle electron 主进程 → dist-electron/main.cjs
 *
 * 为什么不让 vite-plugin-electron 处理:
 *   插件的 main 块用 `entry` 字段走自己的 esbuild 路径,默认输出 ESM,
 *   且 build.rollupOptions 不被它消费(只有 preload 的 input 字段走 vite lib
 *   mode 才生效)。配 package.json type:module + electron 内嵌 Node 20.18,
 *   加载时崩在 cjsPreparseModuleExports。直接调 esbuild 显式 format:cjs,
 *   跟 preload.cjs 同方案,Node 当纯 CJS 加载,electron import 走 CJS 互操作。
 *
 * 执行时机:`pnpm build` 在 vite build 之后再跑这个,出 main.cjs 覆盖任何残留。
 *
 * env inline:
 *   读 .env.local / .env 里 VITE_LANGCAT_API_BASE_URL / VITE_LANGCAT_SUPABASE_*,
 *   通过 esbuild 的 define 把字面量替换 process.env.* 引用。
 *   缺失就编译为空字符串,运行时 main.ts 自己 fail-loud(规则 4)。
 */

import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** 极简 .env 解析 — 只取 KEY=value,不展开变量、不处理引号嵌套 */
function loadEnvFile(p) {
  if (!existsSync(p)) return {};
  const out = {};
  const text = readFileSync(p, 'utf-8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 去成对引号
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// .env.local 优先于 .env(跟 vite 行为一致)
const envFile = {
  ...loadEnvFile(path.join(projectRoot, '.env')),
  ...loadEnvFile(path.join(projectRoot, '.env.local')),
};

const langcatBase =
  envFile.VITE_LANGCAT_API_BASE_URL ?? envFile.LANGCAT_API_BASE_URL ?? '';
const supabaseURL = envFile.VITE_LANGCAT_SUPABASE_URL ?? '';
const supabaseAnon = envFile.VITE_LANGCAT_SUPABASE_ANON_KEY ?? '';

await build({
  entryPoints: [path.join(projectRoot, 'electron/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(projectRoot, 'dist-electron/main.cjs'),
  // electron / electron-updater 都 external,不要 bundle:
  // - electron 是运行时由宿主 process 注入,bundle 进去会撞 Node 模块解析
  // - electron-updater 在模块顶层构造 AppImageUpdater 并立即调 app.getVersion(),
  //   bundle 进 main.cjs 后,加载阶段 electron.app 还没 ready,炸 'undefined.getVersion'
  // - node:* 内置 esbuild 会自动识别,无需显式列举(除非要支持旧版 node)
  external: ['electron', 'electron-updater'],
  define: {
    'process.env.LANGCAT_API_BASE_URL': JSON.stringify(langcatBase),
    'process.env.LANGCAT_SUPABASE_URL': JSON.stringify(supabaseURL),
    'process.env.LANGCAT_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnon),
    // main.ts 写 ESM 风格 fileURLToPath(import.meta.url) 拿 __dirname。
    // CJS 输出下 esbuild 把 import.meta.url 替换为空字符串(默认行为),路径会错。
    // 在 banner 注入一个 CJS 等价表达,然后 define 把 import.meta.url 替换为该表达式。
    'import.meta.url': '__esbuild_import_meta_url__',
  },
  banner: {
    js: `const { pathToFileURL: __esbuild_pathToFileURL__ } = require('node:url');
const __esbuild_import_meta_url__ = __esbuild_pathToFileURL__(__filename).href;`,
  },
  // sourcemap 让运行时 stack trace 对得上 .ts 行号,debug 友好
  sourcemap: true,
  // 保留可读性,production size 不是关键(几百 KB)
  minify: false,
  logLevel: 'info',
});

console.info('[build-main] dist-electron/main.cjs 出炉(esbuild CJS)');
