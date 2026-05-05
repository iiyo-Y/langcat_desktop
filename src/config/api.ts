/**
 * 第三方 API 端点集中配置
 *
 * 跟 langcat_chome/src/config/api.ts 一致(规则 5:不写死 URL)。
 * Electron 渲染层可直接 fetch,没有 chrome extension 的 host_permissions 限制,
 * 但仍需在 index.html 的 CSP `connect-src` 里声明这些域。
 */

export const API_ENDPOINTS = {
  freeDictionary: {
    base: 'https://api.dictionaryapi.dev/api/v2',
    word: (word: string): string =>
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
  },
  myMemory: {
    base: 'https://api.mymemory.translated.net',
    translate: (text: string, fromLang: string, toLang: string): string =>
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`,
  },
} as const;

export const API_CONFIG = {
  timeoutMs: 8000,
  retries: 0,
} as const;
