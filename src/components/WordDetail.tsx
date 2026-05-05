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
import { lookupDictionary } from '@lib/dictionary';
import {
  lookupLangCatDictionary,
  regenerateLangCatDictionary,
  type LangCatLookupReply,
  type LangCatLookupResult,
  type LangCatLookupFailure,
} from '@lib/langcat-api';
import { HttpError } from '@lib/http';
import { DICTIONARY_LIMITS } from '@config/constants';
import type { Definition } from '@/types/word';
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
  const dictPromise = lookupDictionary(
    word,
    DICTIONARY_LIMITS.maxDefinitionsPerPos,
  ).then(
    (r) => ({ ok: true as const, ...r }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  const morphPromise = lookupLangCatDictionary(word).then(
    (r): LangCatLookupReply | null => r,
    (err: unknown): LangCatLookupReply | null => {
      console.warn('[LangCat] morphology lookup IPC failed', err);
      return null;
    },
  );

  const [dict, morphReply] = await Promise.all([dictPromise, morphPromise]);
  return mergeResults(dict, morphReply);
}

function splitMorphReply(reply: LangCatLookupReply | null): {
  result: LangCatLookupResult | null;
  failure: LangCatLookupFailure | null;
} {
  if (!reply) return { result: null, failure: null };
  if (reply.ok) return { result: reply.result, failure: null };
  return { result: null, failure: reply.failure };
}

function mergeResults(
  dict:
    | { ok: true; phonetic: string; definitions: Definition[] }
    | { ok: false; err: unknown },
  morphReply: LangCatLookupReply | null,
): LookupState {
  if (!dict.ok) {
    if (dict.err instanceof HttpError && dict.err.status === 404) {
      return { kind: 'not-found' };
    }
    return { kind: 'error', message: errMsg(dict.err) };
  }
  const split = splitMorphReply(morphReply);
  return {
    kind: 'success',
    phonetic: dict.phonetic,
    definitions: dict.definitions,
    morphology: split.result,
    morphologyFailure: split.failure,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
