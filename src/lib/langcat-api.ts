/**
 * LangCat 后端 API 客户端(渲染层)
 *
 * 走 main 进程 IPC 中转 fetch(渲染层直接 fetch 撞 CORS,跟 chrome 扩展同思路)。
 * 失败抛错;HTTP 200 + found:false 视为"未收录"返回 null,让调用方决定 fallback 策略。
 *
 * 错误处理:
 *   - 主进程把 401 / 429 序列化进 message 前缀 `__LANGCAT_ERR__:<json>`(见 electron/main.ts)
 *   - 这层用 parseLangCatError 拆前缀,按 kind 抛 typed error:
 *       UnauthorizedError / QuotaExceededError
 *   - typed error 抛出来后,还会往 errorBus 推一份(MainView 订阅来弹登录框 / Toast)
 *   - 普通 Error 原样抛,UI 用现有错误展示样式
 */

import type { QuotaEndpoint } from '@/types/bridge';

/* ──────────────────────────────────────────────────────────── */
/*  Typed error + 全局事件总线                                    */
/* ──────────────────────────────────────────────────────────── */

/** 401 — 未登录或 access_token 失效 */
export class UnauthorizedError extends Error {
  readonly kind = 'unauthorized' as const;
  constructor(message: string = 'unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** 429 — 当日配额用完;reset_at 是 unix seconds */
export class QuotaExceededError extends Error {
  readonly kind = 'quota_exceeded' as const;
  readonly endpoint: QuotaEndpoint;
  readonly limit: number;
  readonly remaining: number;
  readonly reset_at: number;
  constructor(opts: {
    endpoint: QuotaEndpoint;
    limit: number;
    remaining: number;
    reset_at: number;
    message?: string;
  }) {
    super(opts.message ?? 'quota exceeded');
    this.name = 'QuotaExceededError';
    this.endpoint = opts.endpoint;
    this.limit = opts.limit;
    this.remaining = opts.remaining;
    this.reset_at = opts.reset_at;
  }
}

/**
 * 极简事件总线 — UI 层(MainView)订阅 typed error 后做反应:
 *   401 → 弹 LoginView
 *   429 → 弹 Toast
 *
 * 用 EventTarget 而不是引入新依赖(规则:不加新依赖)。
 *
 * 设计决策:每个 wrapper(lookupLangCatDictionary 等)的 catch 路径都过
 * parseLangCatError;parseLangCatError 在抛 typed error 之前先 dispatch 到 bus,
 * 这样调用方不需要每个 try/catch 里都重复"401 弹登录"。
 */
type LangCatErrorEvent =
  | { kind: 'unauthorized'; error: UnauthorizedError }
  | { kind: 'quota_exceeded'; error: QuotaExceededError };

type ErrorListener = (e: LangCatErrorEvent) => void;

const errorListeners = new Set<ErrorListener>();

export function subscribeLangCatErrors(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

function emitLangCatError(e: LangCatErrorEvent): void {
  // 拷贝快照避免回调里 unsubscribe 时影响迭代
  for (const fn of Array.from(errorListeners)) {
    try {
      fn(e);
    } catch (cbErr) {
      // listener 自己抛错不能影响别的 listener,也不能掩盖原始业务错误
      // 这里只 log,然后继续(规则 4:不写 catch+pass,有日志算"记录并中止当前回调")
      console.error('[LangCat] error listener 抛异常:', cbErr);
    }
  }
}

/** 主进程错误前缀(必须跟 electron/main.ts LANGCAT_ERR_PREFIX 一致) */
const LANGCAT_ERR_PREFIX = '__LANGCAT_ERR__:';

interface RawErrPayload {
  kind?: string;
  endpoint?: string;
  limit?: number;
  remaining?: number;
  reset_at?: number;
  message?: string;
}

/**
 * 把任意从 IPC reject 出来的 err 解析成 typed error 抛出。
 * 不匹配前缀的原样抛(rethrow)。
 *
 * 用法:
 *   try { ... } catch (err) { parseLangCatError(err); }
 *
 * 注意 parseLangCatError 一定会抛出来 — 永远不返回正常值。
 */
export function parseLangCatError(err: unknown): never {
  if (!(err instanceof Error)) {
    throw err;
  }
  const msg = err.message;
  if (!msg.startsWith(LANGCAT_ERR_PREFIX)) {
    throw err;
  }
  const json = msg.slice(LANGCAT_ERR_PREFIX.length);
  let payload: RawErrPayload;
  try {
    payload = JSON.parse(json) as RawErrPayload;
  } catch {
    // JSON 损坏 — 后端 / 主进程协议没遵守,fail-loud(规则 4)
    throw new Error(
      `[LangCat] LANGCAT_ERR payload 不是合法 JSON: ${json.slice(0, 200)}`,
    );
  }
  if (payload.kind === 'unauthorized') {
    const e = new UnauthorizedError(payload.message ?? 'unauthorized');
    emitLangCatError({ kind: 'unauthorized', error: e });
    throw e;
  }
  if (payload.kind === 'quota_exceeded') {
    const { endpoint, limit, remaining, reset_at } = payload;
    if (
      (endpoint !== 'lookup' && endpoint !== 'regenerate' && endpoint !== 'ask') ||
      typeof limit !== 'number' ||
      typeof remaining !== 'number' ||
      typeof reset_at !== 'number'
    ) {
      throw new Error(
        `[LangCat] quota_exceeded payload 字段缺失: ${JSON.stringify(payload)}`,
      );
    }
    const e = new QuotaExceededError({
      endpoint,
      limit,
      remaining,
      reset_at,
      message: payload.message,
    });
    emitLangCatError({ kind: 'quota_exceeded', error: e });
    throw e;
  }
  // 未知 kind — 不知道怎么处理就 fail-loud
  throw new Error(`[LangCat] 未知 LANGCAT_ERR kind: ${payload.kind ?? '<missing>'}`);
}

export interface LangCatWordAnalysis {
  pos: string;
  surface_analysis: string;
  canonical_analysis: string;
  word_formation: string;
  core_meaning_cn: string;
  strictness: string;
  confidence: string;
  warning_or_note?: string;
  related_family: string[];
  source_url?: string;
  /** LLM 生成时填,种子数据可能为 undefined */
  mnemonic_humor?: string;
  usage_scenarios?: string[];
  etymology_origin?: string;
  /** 多义项 + 双语例句(每条字符串如 "n. 化合物。Water is a compound — 水是化合物。") */
  extended_meanings?: string[];
}

export interface LangCatMorpheme {
  id: string;
  canonical_form: string;
  surface_forms: string[];
  primary_type: string;
  functional_type: string;
  core_meaning_cn: string;
  core_meaning_en: string;
  origin_language?: string;
  allomorph_group?: string;
  examples: string[];
  confidence: string;
  /** 同根词族,每条 "word: 中文意思" */
  family_words?: string[];
}

export interface LangCatAllomorphRule {
  rule_id: string;
  canonical_form: string;
  variant_form: string;
  rule_type: string;
  condition_cn?: string;
  condition_en?: string;
}

export interface LangCatParsedMorpheme {
  canonical_token: string;
  surface_token: string;
  morpheme?: LangCatMorpheme;
  applied_rule?: LangCatAllomorphRule;
}

export interface LangCatLookupResult {
  word: string;
  analysis: LangCatWordAnalysis;
  morphemes: LangCatParsedMorpheme[];
  ai_status?: LangCatAIStatus;
}

/** found:false 时也带状态,popover 据此显示提示 */
export interface LangCatLookupFailure {
  word: string;
  ai_status: LangCatAIStatus;
}

/**
 * AI 生成状态。客户端按此决定 popover 是否显示"AI 失败 + 🔄 重试"提示。
 *   ok               命中 db 或 LLM 成功生成
 *   disabled         AI_ENABLED=false,不走 LLM
 *   rate_limited     最近失败过,5 分钟内拒绝重试(用户主动 🔄 可绕过)
 *   failed_quality   LLM 输出质量门卫拒绝(占位符 / 字段缺失)
 *   failed_timeout   LLM 上游响应超时
 *   failed_other     其他失败
 */
export type LangCatAIStatus =
  | 'ok'
  | 'disabled'
  | 'rate_limited'
  | 'failed_quality'
  | 'failed_timeout'
  | 'failed_other';

interface RawResponse {
  data: {
    word: string;
    found: boolean;
    analysis?: LangCatWordAnalysis;
    morphemes?: LangCatParsedMorpheme[];
    ai_status?: LangCatAIStatus;
  };
}

/** 强制让后端重新调 LLM 生成 word 的拆解,覆盖 db 旧行 */
export async function regenerateLangCatDictionary(
  word: string,
): Promise<LangCatLookupReply> {
  if (typeof window.langcat?.regenerateLangCat !== 'function') {
    throw new Error('[LangCat] preload 未注入 regenerateLangCat');
  }
  let raw: RawResponse | null;
  try {
    raw = (await window.langcat.regenerateLangCat(word)) as RawResponse | null;
  } catch (err) {
    parseLangCatError(err);
  }
  if (!raw || !raw.data) {
    return { ok: false, failure: { word, ai_status: 'failed_other' } };
  }
  if (!raw.data.found) {
    return {
      ok: false,
      failure: {
        word: raw.data.word,
        ai_status: raw.data.ai_status ?? 'failed_other',
      },
    };
  }
  if (!raw.data.analysis || !Array.isArray(raw.data.morphemes)) {
    throw new Error(`[LangCat] regenerate 后端返回结构异常`);
  }
  return {
    ok: true,
    result: {
      word: raw.data.word,
      analysis: raw.data.analysis,
      morphemes: raw.data.morphemes,
      ai_status: raw.data.ai_status,
    },
  };
}

/**
 * 返回:
 *   命中  -> { ok: true,  result }
 *   未命中 -> { ok: false, failure: { word, ai_status } } (供 popover 显示重试提示)
 */
export type LangCatLookupReply =
  | { ok: true; result: LangCatLookupResult }
  | { ok: false; failure: LangCatLookupFailure };

interface RawMorphemesResponse {
  data?: {
    morphemes?: LangCatMorpheme[];
    count?: number;
  };
}

/**
 * 拉词典里所有词素(~120 行)给桌面"词根表"视图。
 * 失败抛错;调用方负责 try/catch 显示错误状态。
 *
 * 公开端点不会返 401/429,但仍走 parseLangCatError 兜一道:
 * 万一未来加配额了不会因为忘改一处出 bug(防御性 — 但**不是兜底**,
 * 因为 parseLangCatError 不匹配前缀就 rethrow,不掩盖真实错误)
 */
export async function listLangCatMorphemes(): Promise<LangCatMorpheme[]> {
  if (typeof window.langcat?.listMorphemes !== 'function') {
    throw new Error('[LangCat] preload 未注入 listMorphemes');
  }
  let raw: RawMorphemesResponse;
  try {
    raw = (await window.langcat.listMorphemes()) as RawMorphemesResponse;
  } catch (err) {
    parseLangCatError(err);
  }
  if (!raw?.data || !Array.isArray(raw.data.morphemes)) {
    throw new Error('[LangCat] /dictionary/morphemes 返回结构异常');
  }
  return raw.data.morphemes;
}

export async function lookupLangCatDictionary(
  word: string,
): Promise<LangCatLookupReply> {
  if (typeof window.langcat?.lookupLangCat !== 'function') {
    throw new Error('[LangCat] preload 未注入 lookupLangCat');
  }
  let raw: RawResponse | null;
  try {
    raw = (await window.langcat.lookupLangCat(word)) as RawResponse | null;
  } catch (err) {
    parseLangCatError(err);
  }

  if (!raw || !raw.data) {
    return { ok: false, failure: { word, ai_status: 'failed_other' } };
  }

  if (!raw.data.found) {
    return {
      ok: false,
      failure: {
        word: raw.data.word,
        ai_status: raw.data.ai_status ?? 'failed_other',
      },
    };
  }
  if (!raw.data.analysis || !Array.isArray(raw.data.morphemes)) {
    throw new Error(
      `[LangCat] 后端返回 found=true 但缺 analysis/morphemes: ${JSON.stringify(raw.data)}`,
    );
  }
  return {
    ok: true,
    result: {
      word: raw.data.word,
      analysis: raw.data.analysis,
      morphemes: raw.data.morphemes,
      ai_status: raw.data.ai_status,
    },
  };
}

/**
 * AskAI 调用的 typed wrapper —— 之前 AskAI.tsx 直接 await window.langcat.askAI,
 * 这里包一层让 401/429 也能被 parseLangCatError 接住并触发 UI 反应。
 *
 * 返回原始 JSON(保持调用方期望的 RawAskResponse 形态)。
 */
export async function askLangCatAI(payload: {
  word: string;
  question: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<unknown> {
  if (typeof window.langcat?.askAI !== 'function') {
    throw new Error('[LangCat] preload 未注入 askAI');
  }
  try {
    return await window.langcat.askAI(payload);
  } catch (err) {
    parseLangCatError(err);
  }
}
