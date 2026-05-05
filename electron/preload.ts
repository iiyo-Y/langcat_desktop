/**
 * Preload 脚本
 *
 * 通过 contextBridge 把"严格白名单"的主进程能力暴露给渲染层 —— 不开 nodeIntegration
 * 也不让渲染层直接访问 ipcRenderer,只导出我们设计好的小 API。
 *
 * 暴露的 API:
 *   window.langcat.onShowWord(cb)           popover 接收主进程推送的"要显示哪个词"
 *   window.langcat.onLookupRecorded(cb)     主窗口接收"用户刚查了什么词"
 *   window.langcat.closePopover()           popover 主动请求隐藏(ESC)
 *   window.langcat.onQuotaChanged(cb)       订阅 X-RateLimit-* 配额广播
 */

import { contextBridge, ipcRenderer } from 'electron';

type WordHandler = (word: string) => void;

/**
 * 配额信息 — endpoint key 与 main 进程 pathSegToQuotaEndpoint 一致(集中配置,规则 5)
 *
 * 渲染层(types/bridge.ts)有同名的 QuotaInfo 接口,改一处必须同步两处。
 */
interface QuotaInfoLite {
  endpoint: 'lookup' | 'regenerate' | 'ask';
  limit: number;
  remaining: number;
  reset_at: number;
}

contextBridge.exposeInMainWorld('langcat', {
  onShowWord(cb: WordHandler): () => void {
    const listener = (_e: unknown, word: string): void => cb(word);
    ipcRenderer.on('langcat:show-word', listener);
    return () => ipcRenderer.removeListener('langcat:show-word', listener);
  },
  onLookupRecorded(cb: WordHandler): () => void {
    const listener = (_e: unknown, word: string): void => cb(word);
    ipcRenderer.on('langcat:lookup-recorded', listener);
    return () =>
      ipcRenderer.removeListener('langcat:lookup-recorded', listener);
  },
  closePopover(): void {
    ipcRenderer.send('langcat:close-popover');
  },
  /**
   * 走 main 中转 fetch LangCat 词素查询,返回后端原始 JSON({data:{...}})。
   * 失败时 Promise reject(被 lib/langcat-api 转成 LookupResult | null)。
   */
  lookupLangCat(word: string): Promise<unknown> {
    return ipcRenderer.invoke('langcat:lookup-langcat', word);
  },
  regenerateLangCat(word: string): Promise<unknown> {
    return ipcRenderer.invoke('langcat:regenerate-langcat', word);
  },
  askAI(payload: {
    word: string;
    question: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<unknown> {
    return ipcRenderer.invoke('langcat:ask-ai', payload);
  },
  listMorphemes(): Promise<unknown> {
    return ipcRenderer.invoke('langcat:list-morphemes');
  },

  // —— 认证 ——
  authCurrent(): Promise<unknown> {
    return ipcRenderer.invoke('langcat:auth-current');
  },
  authSignIn(payload: { email: string; password: string }): Promise<unknown> {
    return ipcRenderer.invoke('langcat:auth-sign-in', payload);
  },
  authSignUp(payload: { email: string; password: string }): Promise<unknown> {
    return ipcRenderer.invoke('langcat:auth-sign-up', payload);
  },
  authSignOut(): Promise<unknown> {
    return ipcRenderer.invoke('langcat:auth-sign-out');
  },
  onAuthChanged(cb: (session: unknown) => void): () => void {
    const listener = (_e: unknown, session: unknown): void => cb(session);
    ipcRenderer.on('langcat:auth-changed', listener);
    return () => ipcRenderer.removeListener('langcat:auth-changed', listener);
  },

  // —— 单词本 ——
  vocabularyList(): Promise<unknown> {
    return ipcRenderer.invoke('langcat:vocabulary-list');
  },
  vocabularyAdd(word: string): Promise<unknown> {
    return ipcRenderer.invoke('langcat:vocabulary-add', word);
  },
  vocabularyRemove(word: string): Promise<unknown> {
    return ipcRenderer.invoke('langcat:vocabulary-remove', word);
  },
  vocabularyMarkReviewed(word: string): Promise<unknown> {
    return ipcRenderer.invoke('langcat:vocabulary-mark-reviewed', word);
  },
  onVocabularyChanged(cb: (items: unknown) => void): () => void {
    const listener = (_e: unknown, items: unknown): void => cb(items);
    ipcRenderer.on('langcat:vocabulary-changed', listener);
    return () =>
      ipcRenderer.removeListener('langcat:vocabulary-changed', listener);
  },
  windowMinimize(): void {
    ipcRenderer.send('langcat:window-minimize');
  },
  windowToggleMaximize(): void {
    ipcRenderer.send('langcat:window-toggle-maximize');
  },
  windowClose(): void {
    ipcRenderer.send('langcat:window-close');
  },
  onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized);
    ipcRenderer.on('langcat:window-maximized-changed', listener);
    return () =>
      ipcRenderer.removeListener('langcat:window-maximized-changed', listener);
  },

  // —— 配额广播 ——
  // 主进程在每次 langcatFetch 拿到 X-RateLimit-* 头时推一次;UI 据此显示进度条
  onQuotaChanged(cb: (info: QuotaInfoLite) => void): () => void {
    const listener = (_e: unknown, info: QuotaInfoLite): void => cb(info);
    ipcRenderer.on('langcat:quota-changed', listener);
    return () => ipcRenderer.removeListener('langcat:quota-changed', listener);
  },
});
