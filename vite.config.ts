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
