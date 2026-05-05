/**
 * Vite 配置
 *
 * 用 vite-plugin-electron/simple 同时管理:
 * - main 进程(electron/main.ts → dist-electron/main.js)
 * - preload 脚本(electron/preload.ts → dist-electron/preload.mjs)
 * - renderer(React 应用)
 *
 * 路径别名跟 tsconfig.json 的 paths 保持一致 —— 一处真相,Vite 和 TS 共用。
 */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  // 优先级:process.env(CI 注入) > .env.local / .env(本地开发)
  // CI 不写 .env 文件,直接通过 GitHub Actions secrets export env vars,
  // vite 的 loadEnv 默认不读 process.env,所以这里手动拼一层。
  const env = loadEnv(mode, process.cwd(), '');
  const langcatBase =
    process.env.VITE_LANGCAT_API_BASE_URL ??
    env.VITE_LANGCAT_API_BASE_URL ??
    env.LANGCAT_API_BASE_URL ??
    '';
  const supabaseURL =
    process.env.VITE_LANGCAT_SUPABASE_URL ?? env.VITE_LANGCAT_SUPABASE_URL ?? '';
  const supabaseAnon =
    process.env.VITE_LANGCAT_SUPABASE_ANON_KEY ??
    env.VITE_LANGCAT_SUPABASE_ANON_KEY ??
    '';

  return {
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@config': fileURLToPath(new URL('./src/config', import.meta.url)),
      '@lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          define: {
            'process.env.LANGCAT_API_BASE_URL': JSON.stringify(langcatBase),
            'process.env.LANGCAT_SUPABASE_URL': JSON.stringify(supabaseURL),
            'process.env.LANGCAT_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnon),
          },
          build: {
            rollupOptions: {
              // 把 native module + electron-updater 标 external,不让 vite bundle 它们。
              // 原因:nut-js 内部 native loader 用 __dirname 寻 *.node 文件,被
              // bundle 进 main.js (ESM) 后 __dirname 不在 ESM scope,运行时 throw
              // ReferenceError 把整个 app 启动崩。external 后运行时 Node 用 CJS
              // require 加载这些包,__dirname 走标准 CJS 模块路径,正常。
              // asar 模式下 electron-builder.yml 的 asarUnpack 已经把这些包解到
              // resources/app.asar.unpacked/node_modules/,运行时 require 解析得到。
              external: [
                '@nut-tree-fork/nut-js',
                '@nut-tree-fork/libnut',
                '@nut-tree-fork/libnut-darwin',
                '@nut-tree-fork/libnut-win32',
                '@nut-tree-fork/libnut-linux',
                'electron-updater',
              ],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
      renderer: undefined,
    }),
  ],
  };
});
