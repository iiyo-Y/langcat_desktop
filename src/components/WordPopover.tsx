/**
 * WordPopover —— 释义卡片(无定位,撑满父容器)
 *
 * 视觉原则:
 * - 主体白底 + 3px 深蓝黑描边 + 手绘投影(品牌签名)
 * - 关闭按钮"克制" —— 默认半透明,hover 整张卡片时才完全显现
 * - 中文翻译用王冠黄色块强调("用户最在乎的信息")
 * - 释义按词性分块,每条卡片左侧有细品牌粉竖条作"引用感"
 * - 例句斜体 + 引号包裹 + 左侧再缩进,与释义视觉分级清楚
 */

import { useEffect, useState } from 'react';
import type { Definition } from '@/types/word';
import type {
  LangCatAIStatus,
  LangCatLookupFailure,
  LangCatLookupResult,
} from '@lib/langcat-api';
import type { SavedWord } from '@/types/vocabulary';
import { AskAI } from './AskAI';

/**
 * 付费层产品决策:popover 不显示 Free Dictionary 英文释义区块,
 * 让信息聚焦在 LangCat 自家词素拆解 + 多义项 + 记忆口诀 + 词源等高价值内容。
 * 免费层方案:把这个常量改成 false 即可,代码逻辑不变。
 */
const HIDE_FREE_DICTIONARY = true;

/**
 * 把 LLM 给的多义项字符串解析成结构化字段。约定格式:
 *   "<pos>. <中文释义>。<English example> — <中文翻译>。"
 *
 * 容错:格式偏离时退回 pos 拆解 + 整段当中文释义,不抛错(规则 4 边界:
 * 解析失败用退化展示,不掩盖原始字符串)。
 */
function parseMeaningLine(line: string): {
  pos: string;
  cn: string;
  en: string;
  enCn: string;
} {
  let rest = line.trim();
  let pos = '';
  // 取开头的"n.""v.""adj."这种词性
  const posMatch = /^([a-zA-Z]+)\.\s*/.exec(rest);
  if (posMatch) {
    pos = posMatch[1] ?? '';
    rest = rest.slice(posMatch[0].length);
  }
  // 找 " — " / " -- " / "——" 切英文例句和中文翻译
  let dashIdx = -1;
  for (const sep of [' — ', ' -- ', '——']) {
    const i = rest.indexOf(sep);
    if (i !== -1 && (dashIdx === -1 || i < dashIdx)) {
      dashIdx = i;
    }
  }
  let beforeDash = rest;
  let enCn = '';
  if (dashIdx !== -1) {
    beforeDash = rest.slice(0, dashIdx);
    enCn = rest
      .slice(dashIdx)
      .replace(/^[\s\-—]+/, '')
      .replace(/[。.]\s*$/, '')
      .trim();
  }
  // 中文释义 + 英文例句:在 beforeDash 里找最后一个中文句号
  let cn = beforeDash.trim();
  let en = '';
  const cnEnd = beforeDash.lastIndexOf('。');
  if (cnEnd !== -1) {
    cn = beforeDash.slice(0, cnEnd).trim();
    en = beforeDash
      .slice(cnEnd + 1)
      .trim()
      .replace(/[。.]\s*$/, '');
  }
  return { pos, cn, en, enCn };
}

export type LookupState =
  | { kind: 'loading' }
  | {
      kind: 'success';
      phonetic: string;
      definitions: Definition[];
      /** LangCat 命中:有完整词素拆解 */
      morphology: LangCatLookupResult | null;
      /** LangCat 没命中且后端给了失败原因,popover 据此显示重试提示 */
      morphologyFailure: LangCatLookupFailure | null;
    }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

interface Props {
  word: string;
  state: LookupState;
  /** 用户点 ✕ 时调用;不传则不渲染关闭按钮(主窗口里复用此卡片时不需要) */
  onClose?: () => void;
  /** 用户点 🔄 时调用(让 AI 重新拆解当前词);不传则不渲染按钮 */
  onRegenerate?: () => void;
  /** 是否正在 regenerate 中(转圈动画) */
  isRegenerating?: boolean;
}

export function WordPopover({
  word,
  state,
  onClose,
  onRegenerate,
  isRegenerating = false,
}: Props): JSX.Element {
  // 🔄 显示规则:
  //   - 命中且 source 是 LLM 生成 → 显示(让用户能改进 LLM 输出)
  //   - 没命中且后端报 LLM 失败 → 显示(让用户能重试)
  //   - 命中且 source 是种子数据 (etymonline) → 不显示(保护人工数据)
  const showRegen =
    onRegenerate !== undefined &&
    state.kind === 'success' &&
    ((typeof state.morphology?.analysis.source_url === 'string' &&
      state.morphology.analysis.source_url.startsWith('llm:')) ||
      state.morphologyFailure !== null);
  return (
    <div className="group border-langcat border-langcat-outline bg-langcat-white shadow-langcat-lg rounded-langcat-card h-full overflow-hidden flex flex-col">
      {/* 头部:固定不滚,可拖(drag region) */}
      <header
        className="px-5 pt-4 pb-3 flex items-start gap-3 shrink-0 cursor-grab active:cursor-grabbing"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        title="拖动可移动 popover 到任意位置;下次弹出会记住"
      >
        <div className="flex-1 min-w-0">
          <div className="text-langcat-outline text-2xl font-extrabold leading-tight tracking-tight">
            {word}
          </div>
          {state.kind === 'success' && state.phonetic && (
            <div className="text-langcat-outline/55 text-xs mt-1 font-mono">
              {state.phonetic}
            </div>
          )}
        </div>
        {showRegen && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isRegenerating}
            aria-label="让 AI 重新拆解"
            title="觉得不对?让 AI 重新拆一次"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="
              shrink-0 h-7 w-7 rounded-full
              border-2 border-langcat-outline/40 bg-transparent
              text-langcat-outline/70 text-sm
              flex items-center justify-center
              opacity-50 group-hover:opacity-100
              hover:!border-langcat-mouth hover:!text-langcat-mouth
              disabled:opacity-100 disabled:cursor-wait
              transition-all
            "
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              className={isRegenerating ? 'animate-spin' : ''}
            >
              <path
                d="M3 8a5 5 0 0 1 8.5-3.5L13 3v4h-4l1.4-1.4A3.5 3.5 0 1 0 11.5 8"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="
              shrink-0 h-7 w-7 rounded-full
              border-2 border-langcat-outline/40 bg-transparent
              text-langcat-outline/50 text-xs
              flex items-center justify-center
              opacity-40 group-hover:opacity-100
              hover:!border-langcat-mouth hover:!bg-langcat-mouth hover:!text-langcat-white
              transition-all
            "
          >
            ✕
          </button>
        )}
      </header>

      {/* 内容:左右两栏布局
          - 左栏:词语解析(loading/not-found/error/success 都在这里)
          - 右栏:AI 助手(只在 success 时显示;否则展示占位)
          - 两栏各自独立滚动,中间一道分隔线
       */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-auto px-5 pb-4 space-y-3 border-r-2 border-langcat-outline/15 min-w-0">
          {state.kind === 'loading' && <LoadingBody />}
          {state.kind === 'not-found' && <NotFoundBody />}
          {state.kind === 'error' && <ErrorBody message={state.message} />}
          {state.kind === 'success' && (
            <SuccessBody
              definitions={state.definitions}
              morphology={state.morphology}
              morphologyFailure={state.morphologyFailure}
            />
          )}
        </div>
        <aside className="basis-[42%] min-w-[320px] max-w-[480px] shrink-0 p-3 flex flex-col min-h-0">
          {state.kind === 'success' ? (
            <AskAI word={word} />
          ) : (
            <div className="h-full flex items-center justify-center text-center px-4 border-2 border-dashed border-langcat-outline/20 rounded-langcat-small">
              <div className="text-langcat-outline/40 text-[12px] leading-relaxed">
                AI 助手将在词条加载后可用
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* footer:加入单词本 */}
      <VocabularyFooter word={word} />
    </div>
  );
}

/**
 * 加入单词本按钮 — 自管 saved 状态。
 * - mount/word 变更时调 vocabularyList 看当前 word 是否已收录
 * - 订阅 onVocabularyChanged 跨窗口实时同步(主窗口删词,popover 状态自动跟上)
 * - 点击 toggle:saved → remove,unsaved → add;用 IPC,失败回退
 */
function VocabularyFooter({ word }: { word: string }): JSX.Element | null {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const lc = window.langcat;
    if (!lc?.vocabularyList) return;
    let cancelled = false;
    const lower = word.toLowerCase();

    const refresh = (items: unknown): void => {
      if (cancelled) return;
      if (!Array.isArray(items)) return;
      const found = (items as SavedWord[]).some((x) => x.word === lower);
      setSaved(found);
    };

    void lc.vocabularyList().then(refresh).catch(() => setSaved(false));
    const off = lc.onVocabularyChanged?.(refresh);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [word]);

  if (saved === null) return null;

  const onToggle = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const lower = word.toLowerCase();
      if (saved) {
        await window.langcat.vocabularyRemove(lower);
      } else {
        await window.langcat.vocabularyAdd(lower);
      }
      // onVocabularyChanged 会广播刷新 saved state
    } catch (err) {
      console.warn('[LangCat] vocabulary toggle failed', err);
    } finally {
      setPending(false);
    }
  };

  return (
    <footer
      className="px-5 py-2.5 border-t-2 border-langcat-outline/15 shrink-0"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className={`
          w-full h-9 rounded-langcat-button
          border-2 border-langcat-outline
          text-[13px] font-bold
          transition-colors
          disabled:cursor-wait disabled:opacity-70
          ${
            saved
              ? 'bg-langcat-scarf/30 text-langcat-outline hover:bg-langcat-mouth/15 hover:border-langcat-mouth'
              : 'bg-langcat-mouth text-langcat-white hover:bg-langcat-outline'
          }
        `}
      >
        {saved ? '已加入单词本 · 点击移除' : '加入单词本'}
      </button>
    </footer>
  );
}

/* ──────────────────────────────────────────────────────────── */

function LoadingBody(): JSX.Element {
  return (
    <div className="space-y-2 pt-1">
      <div className="h-9 rounded-langcat-small bg-langcat-pale-blue/30 animate-pulse" />
      <div className="h-16 rounded-langcat-small bg-langcat-pale-blue/30 animate-pulse" />
      <div className="h-16 rounded-langcat-small bg-langcat-pale-blue/30 animate-pulse" />
    </div>
  );
}

function NotFoundBody(): JSX.Element {
  return (
    <div className="bg-langcat-pale-blue/25 border-2 border-langcat-outline/30 rounded-langcat-small px-3 py-3 text-langcat-outline/80 text-sm">
      该词不在 Free Dictionary 词典里。换个常见词试试 🐱
    </div>
  );
}

function ErrorBody({ message }: { message: string }): JSX.Element {
  return (
    <div className="border-2 border-langcat-mouth bg-langcat-mouth/10 rounded-langcat-small px-3 py-3 text-langcat-mouth text-xs leading-relaxed break-words">
      <div className="font-bold mb-1">查询失败</div>
      {message}
    </div>
  );
}

function SuccessBody({
  definitions,
  morphology,
  morphologyFailure,
}: {
  definitions: Definition[];
  morphology: LangCatLookupResult | null;
  morphologyFailure: LangCatLookupFailure | null;
}): JSX.Element {
  return (
    <>
      {/* LangCat 自家词素拆解 —— 差异化能力放最顶部;命中时才显示 */}
      {morphology && <MorphologySection result={morphology} />}
      {!morphology && morphologyFailure && (
        <MorphologyFailureCard failure={morphologyFailure} />
      )}

      {/* Free Dictionary 英文释义 —— 付费层默认隐藏(信息聚焦在 LangCat 自家高价值字段) */}
      {!HIDE_FREE_DICTIONARY && definitions.length > 0 && (
        <ul className="space-y-2">
          {definitions.map((d, idx) => (
            <li
              key={idx}
              className="relative border-2 border-langcat-outline/30 bg-langcat-white rounded-langcat-small pl-4 pr-3 py-2.5"
            >
              <span
                aria-hidden
                className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-langcat-mouth"
              />
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 inline-block bg-langcat-pale-blue/40 border border-langcat-outline/40 rounded-langcat-button px-2 py-[1px] text-[10px] font-bold text-langcat-outline">
                  {d.partOfSpeech}
                </span>
                <span className="text-langcat-outline text-sm leading-relaxed flex-1">
                  {d.meaning}
                </span>
              </div>
              {d.example && (
                <div className="mt-1.5 ml-1 pl-2 border-l-2 border-langcat-outline/20 text-langcat-outline/65 text-xs italic leading-relaxed">
                  “{d.example}”
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  词素拆解(LangCat 自家词素学习库的差异化能力)                */
/* ──────────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-langcat-outline/55 mb-1.5">
      {children}
    </div>
  );
}

function MorphologySection({ result }: { result: LangCatLookupResult }): JSX.Element {
  const { analysis, morphemes } = result;
  return (
    <section className="space-y-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-langcat-mouth">
        词素拆解 · LangCat
      </div>

      {/* 总公式:用 surface_analysis 字面 */}
      <div className="bg-langcat-crown border-2 border-langcat-outline rounded-langcat-small px-3 py-2.5 text-center text-langcat-outline text-[17px] font-extrabold tracking-wide break-words">
        {analysis.surface_analysis}
      </div>

      {/* 每个 token 一张卡 */}
      <div className="space-y-2">
        {morphemes.map((tok, idx) => (
          <MorphemeTokenCard key={idx} tok={tok} />
        ))}
      </div>

      {analysis.warning_or_note && (
        <div className="border-l-2 border-langcat-mouth bg-langcat-mouth/10 rounded-r px-3 py-2 text-[13px] text-langcat-outline/80 leading-relaxed">
          {analysis.warning_or_note}
        </div>
      )}

      {analysis.mnemonic_humor && (
        <div className="border-2 border-langcat-outline/30 bg-langcat-crown/30 rounded-langcat-small px-3 py-2.5">
          <SectionLabel>记忆口诀</SectionLabel>
          <div className="text-langcat-outline text-[15px] leading-relaxed">
            {analysis.mnemonic_humor}
          </div>
        </div>
      )}

      {analysis.etymology_origin && (
        <div className="border-2 border-langcat-outline/30 bg-langcat-pale-blue/25 rounded-langcat-small px-3 py-2.5">
          <SectionLabel>词源</SectionLabel>
          <div className="text-langcat-outline text-[15px] leading-relaxed">
            {analysis.etymology_origin}
          </div>
        </div>
      )}

      {analysis.usage_scenarios && analysis.usage_scenarios.length > 0 && (
        <div className="border-2 border-langcat-outline/30 bg-langcat-scarf/20 rounded-langcat-small px-3 py-2.5">
          <SectionLabel>应用场景</SectionLabel>
          <ul className="space-y-1.5">
            {analysis.usage_scenarios.map((s, idx) => (
              <li
                key={idx}
                className="text-langcat-outline text-[13px] leading-relaxed pl-3 relative"
              >
                <span
                  aria-hidden
                  className="absolute left-0 top-[8px] h-1.5 w-1.5 rounded-full bg-langcat-mouth"
                />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.extended_meanings && analysis.extended_meanings.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>多义项 · 例句</SectionLabel>
          <ul className="space-y-2">
            {analysis.extended_meanings.map((line, idx) => {
              const p = parseMeaningLine(line);
              return (
                <li
                  key={idx}
                  className="relative border-2 border-langcat-outline/30 bg-langcat-white rounded-langcat-small pl-4 pr-3 py-2.5"
                >
                  {/* 左侧细粉色竖条,跟其他卡片视觉一致 */}
                  <span
                    aria-hidden
                    className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-langcat-mouth"
                  />
                  {/* 第 1 行:词性 chip + 中文释义(主信息) */}
                  <div className="flex items-start gap-2">
                    {p.pos && (
                      <span className="shrink-0 mt-0.5 inline-block bg-langcat-pale-blue/40 border border-langcat-outline/40 rounded-langcat-button px-2 py-[1px] text-[11px] font-bold text-langcat-outline">
                        {p.pos}
                      </span>
                    )}
                    <span className="text-langcat-outline text-[15px] font-bold leading-relaxed flex-1">
                      {p.cn || line /* 解析失败时退回原行 */}
                    </span>
                  </div>
                  {/* 第 2 行:英文例句(浅斜体)+ 中文翻译(更浅) */}
                  {(p.en || p.enCn) && (
                    <div className="mt-2 ml-1 pl-2 border-l-2 border-langcat-outline/20 space-y-0.5">
                      {p.en && (
                        <div className="text-langcat-outline/85 text-[13px] italic leading-relaxed">
                          {p.en}
                        </div>
                      )}
                      {p.enCn && (
                        <div className="text-langcat-outline/55 text-[13px] leading-relaxed">
                          {p.enCn}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function MorphemeTokenCard({
  tok,
}: {
  tok: LangCatLookupResult['morphemes'][number];
}): JSX.Element {
  const { canonical_token, surface_token, morpheme, applied_rule } = tok;
  const [familyOpen, setFamilyOpen] = useState(false);

  // 词素未在字典里收录 —— 显示淡化卡片让用户知道这部分存在但没解释
  if (!morpheme) {
    return (
      <div className="border-2 border-dashed border-langcat-outline/40 rounded-langcat-small px-3 py-2 opacity-65">
        <span className="font-mono text-[15px] font-bold text-langcat-outline">
          {surface_token}
        </span>
        <span className="ml-2 text-[12px] text-langcat-outline/60">
          暂未收录
        </span>
      </div>
    );
  }

  const family = morpheme.family_words ?? [];

  return (
    <div className="relative border-2 border-langcat-outline/30 rounded-langcat-small bg-langcat-white pl-4 pr-3 py-2.5">
      {/* 左边粉色细竖条 */}
      <span
        aria-hidden
        className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-langcat-mouth"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[15px] font-bold text-langcat-outline">
          {surface_token}
        </span>
        {surface_token !== canonical_token && (
          <span className="text-[12px] text-langcat-outline/55">
            ← {canonical_token}
          </span>
        )}
        <span className="bg-langcat-pale-blue/40 border border-langcat-outline/40 rounded-langcat-button px-2 py-[1px] text-[11px] font-bold text-langcat-outline">
          {morpheme.primary_type}
          {morpheme.origin_language ? ` · ${morpheme.origin_language}` : ''}
        </span>
      </div>
      <div className="text-langcat-outline text-[15px] leading-relaxed mt-1">
        {morpheme.core_meaning_cn}
      </div>
      {applied_rule && applied_rule.condition_cn && (
        <div className="mt-2 border-l-2 border-langcat-mouth bg-langcat-mouth/10 rounded-r px-3 py-1.5 text-[13px] text-langcat-outline/80 leading-relaxed">
          {applied_rule.condition_cn}
        </div>
      )}

      {/* 同根词族:默认折叠,标题显示数量,点击展开看完整 */}
      {family.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-langcat-outline/15">
          <button
            type="button"
            onClick={() => setFamilyOpen((v) => !v)}
            className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-langcat-outline/55 hover:text-langcat-outline transition-colors"
          >
            <span>同根词 · {family.length}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className={`transition-transform ${familyOpen ? 'rotate-180' : ''}`}
            >
              <path
                d="M2 4 L5 7 L8 4"
                stroke="currentColor"
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {familyOpen && (
            <ul className="mt-2 space-y-1.5">
              {family.map((entry, idx) => {
                const colonIdx = entry.indexOf(':');
                const word =
                  colonIdx > 0 ? entry.slice(0, colonIdx).trim() : entry.trim();
                const meaning =
                  colonIdx > 0 ? entry.slice(colonIdx + 1).trim() : '';
                return (
                  <li
                    key={idx}
                    className="flex items-baseline gap-2 text-[13px]"
                  >
                    <span className="font-mono font-bold text-langcat-outline shrink-0">
                      {word}
                    </span>
                    {meaning && (
                      <span className="text-langcat-outline/70 leading-snug">
                        {meaning}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  词素拆解失败提示卡(让用户知道发生什么 + 引导点 🔄 重试)    */
/* ──────────────────────────────────────────────────────────── */

const FAILURE_MESSAGES: Record<LangCatAIStatus, { title: string; hint: string } | null> = {
  ok: null,
  disabled: null, // AI 关闭 = 不显示这块,跟原行为一致
  rate_limited: {
    title: '该词刚刚生成失败,正在冷却',
    hint: '后台 5 分钟内不会重复调用 AI。点右上重新生成按钮主动重试,或稍后再来。',
  },
  failed_quality: {
    title: 'AI 内容未通过质量检查',
    hint: 'LLM 输出含占位符或字段缺失,被拒绝入库以保持数据库干净。点右上重新生成。',
  },
  failed_timeout: {
    title: 'AI 服务响应超时',
    hint: '上游模型这次没在时限内回来。点右上重新生成,或换一个 AI 模型。',
  },
  failed_other: {
    title: 'AI 生成失败',
    hint: '后端日志里有具体原因。点右上重新生成。',
  },
};

function MorphologyFailureCard({
  failure,
}: {
  failure: LangCatLookupFailure;
}): JSX.Element | null {
  const msg = FAILURE_MESSAGES[failure.ai_status];
  if (!msg) return null;
  return (
    <section className="border-2 border-langcat-mouth bg-langcat-mouth/10 rounded-langcat-small px-3 py-2.5">
      <div className="text-langcat-mouth text-xs font-bold mb-1">{msg.title}</div>
      <div className="text-langcat-outline/80 text-xs leading-relaxed">{msg.hint}</div>
    </section>
  );
}
