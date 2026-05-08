/**
 * 单词详情视图(主窗口里复用 WordPopover 的渲染)
 *
 * 跟 popover 浮窗的区别:
 * - 主窗口里铺满:不像 popover 那样小卡,直接撑开主内容区
 * - 不带 ✕(关闭由父级"返回"按钮控制)
 * - 仍带 🔄 重新生成,逻辑跟 PopoverView 一致
 *
 * 数据流:
 *   props.word 变更 → 并发查 dict/trans/morphology → 跟 PopoverView 一样的 LookupState
 *   缓存逻辑外置(父级管理),这里只负责"给 word 渲染详情卡"
 */

import { useEffect, useState } from 'react';
import {
  lookupLangCatDictionary,
  regenerateLangCatDictionary,
} from '@lib/langcat-api';
import { WordPopover, type LookupState } from './WordPopover';

export function WordDetail({
  word,
  onBack,
}: {
  word: string;
  /** 顶部"返回"按钮的回调;不传则不显示返回按钮 */
  onBack?: () => void;
}): JSX.Element {
  const [state, setState] = useState<LookupState>({ kind: 'loading' });
  const [isRegenerating, setIsRegenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void runLookup(word).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [word]);

  const handleRegenerate = (): void => {
    if (isRegenerating) return;
    const w = word;
    setIsRegenerating(true);
    void regenerateLangCatDictionary(w)
      .then((reply) => {
        setState((curr) => {
          if (curr.kind !== 'success') return curr;
          if (reply.ok) {
            return { ...curr, morphology: reply.result, morphologyFailure: null };
          }
          return { ...curr, morphology: null, morphologyFailure: reply.failure };
        });
      })
      .catch((err: unknown) => {
        console.warn('[LangCat] regenerate failed', err);
      })
      .finally(() => setIsRegenerating(false));
  };

  return (
    <div className="h-full flex flex-col">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="self-start mb-3 inline-flex items-center gap-2 text-langcat-outline/70 hover:text-langcat-outline text-[13px] font-bold transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M7.5 2.5 L4 6 L7.5 9.5"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>返回</span>
        </button>
      )}

      <div className="flex-1 min-h-0">
        <WordPopover
          word={word}
          state={state}
          onRegenerate={handleRegenerate}
          isRegenerating={isRegenerating}
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */

async function runLookup(word: string): Promise<LookupState> {
  // 撤回 Free Dictionary,只走 LangCat 自家词典(LLM 自动生成 + 自我增长)。
  // IPC 通信级异常 → error;LangCat 后端给出失败 ai_status → success +
  // morphologyFailure(让 popover 显示对应提示 + 🔄 重试)。
  try {
    const reply = await lookupLangCatDictionary(word);
    if (reply.ok) {
      return { kind: 'success', morphology: reply.result, morphologyFailure: null };
    }
    return { kind: 'success', morphology: null, morphologyFailure: reply.failure };
  } catch (err: unknown) {
    console.warn('[LangCat] morphology lookup IPC failed', err);
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
