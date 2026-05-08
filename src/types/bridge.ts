/**
 * Preload 暴露给渲染层的全局 API 类型声明
 *
 * 与 electron/preload.ts 的 contextBridge.exposeInMainWorld 保持一致。
 * 改一处必须同步改两处(规则 5 的精神:类型即文档)。
 */

/** 桌面登录态(仅暴露 user 公共字段;access_token 留在主进程,渲染层永远拿不到) */
export interface AuthSessionPublic {
  user: { id: string; email: string };
  /** access_token 过期 unix 秒(UTC) */
  expires_at: number;
}

/**
 * 配额端点 key —— 与 electron/main.ts 的 QuotaEndpoint 一致(规则 5:集中常量)
 *
 * 改这里必须同步:
 *   - electron/main.ts pathSegToQuotaEndpoint
 *   - electron/preload.ts QuotaInfoLite
 */
export type QuotaEndpoint = 'lookup' | 'regenerate' | 'ask';

/** 主进程从 X-RateLimit-* 头里解析出来的实时配额 */
export interface QuotaInfo {
  endpoint: QuotaEndpoint;
  limit: number;
  remaining: number;
  /** unix seconds(UTC) — 配额下次重置的绝对时间 */
  reset_at: number;
}

export interface LangCatBridge {
  /** popover 接收主进程推送的"要显示哪个词";返回取消订阅函数 */
  onShowWord(cb: (word: string) => void): () => void;
  /** 主窗口接收"用户刚查了什么词";返回取消订阅函数 */
  onLookupRecorded(cb: (word: string) => void): () => void;
  /** popover 主动请求隐藏 */
  closePopover(): void;
  /** 让 main 进程 fetch LangCat 词素查询,返回后端原始 JSON */
  lookupLangCat(word: string): Promise<unknown>;
  /** 强制后端 LLM 重新生成某词条(POST /api/v1/dictionary/regenerate) */
  regenerateLangCat(word: string): Promise<unknown>;
  /** 词条追问 AI:返回 { data: { answer: string } } 或 reject */
  askAI(payload: {
    word: string;
    question: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<unknown>;
  /** 词素全量列表(词根表视图用):返回 { data: { morphemes: [...], count: N } } */
  listMorphemes(): Promise<unknown>;

  /** 当前装的应用版本号(对应 release tag,自动更新后会跟着变) */
  appVersion(): Promise<string>;

  /** 当前登录态:登录返回 { user, expires_at },未登录返回 null */
  authCurrent(): Promise<AuthSessionPublic | null>;
  /** Supabase 邮箱密码登录;成功返回新 session,失败 reject 带错误消息 */
  authSignIn(payload: { email: string; password: string }): Promise<AuthSessionPublic | null>;
  /** 邮箱密码注册;返回 { session, needs_email_verification }(项目开了邮箱验证时 session 为 null) */
  authSignUp(payload: {
    email: string;
    password: string;
  }): Promise<{
    session: AuthSessionPublic | null;
    needs_email_verification: boolean;
  }>;
  /** 退出登录:本地清空 + 调 supabase logout(失败忽略) */
  authSignOut(): Promise<null>;
  /** 登录态变更广播(login / logout / refresh 后);返回取消订阅函数 */
  onAuthChanged(cb: (session: AuthSessionPublic | null) => void): () => void;

  /** 单词本(本地 JSON 文件;阶段 4 接 Supabase 时改成"本地 + 云同步") */
  vocabularyList(): Promise<unknown>;
  vocabularyAdd(word: string): Promise<unknown>;
  vocabularyRemove(word: string): Promise<unknown>;
  /** 标记词刚刚完成一次复习,SRS stage++,重算下次到期 */
  vocabularyMarkReviewed(word: string): Promise<unknown>;
  /** 单词本变更广播 — 任意窗口加/删词都会推这个事件,主窗口的列表据此刷新 */
  onVocabularyChanged(cb: (items: unknown) => void): () => void;

  /** 自定义 TitleBar 的窗口控制 */
  windowMinimize(): void;
  windowToggleMaximize(): void;
  windowClose(): void;
  /** 监听最大化/还原状态变化(供 TitleBar 切换图标);返回取消订阅函数 */
  onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void;

  /**
   * 配额变更广播 — 每次 langcatFetch 拿到 X-RateLimit-* 头时触发一次;
   * 返回取消订阅函数。Sidebar 据此实时更新"今日额度"进度条
   */
  onQuotaChanged(cb: (info: QuotaInfo) => void): () => void;
}

declare global {
  interface Window {
    langcat: LangCatBridge;
  }
}
