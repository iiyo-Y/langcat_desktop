/**
 * Popover 视图 —— frameless / transparent / 置顶窗口里的卡片
 *
 * 流程:
 *   1. 主进程通过 window.langcat.onShowWord 推一个英文单词过来
 *   2. 本组件并发查 dict + trans,显示 loading → success/not-found/error
 *   3. 用户按 ESC 调 window.langcat.closePopover()(主进程 hide 窗口)
 *   4. 同一个窗口反复复用,所以下一个 word 推过来时直接更新内部状态
 *
 * 缓存留在内存(单个 popover 窗口生命周期内复用),不重复打 API。
 */

import { useEffect, useRef, useState } from 'react';
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

interface ActiveWord {
  word: string;
  state: LookupState;
}

export function PopoverView(): JSX.Element {
  const [active, setActive] = useState<ActiveWord | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  /** word → state,session 内复用 */
  const cacheRef = useRef<Map<string, LookupState>>(new Map());

  useEffect(() => {
    // preload 没注入时静默返回,不要让 React 卸载整棵树
    if (typeof window.langcat?.onShowWord !== 'function') return;
    const off = window.langcat.onShowWord((word) => {
      const cached = cacheRef.current.get(word);
      if (cached) {
        setActive({ word, state: cached });
        return;
      }
      setActive({ word, state: { kind: 'loading' } });
      void runLookup(word).then((state) => {
        cacheRef.current.set(word, state);
        // 期间用户可能已经查了别的词,只在仍是当前词时再更新
        setActive((curr) => (curr?.word === word ? { word, state } : curr));
      });
    });
    return off;
  }, []);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        window.langcat?.closePopover?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (active === null) {
    // 窗口尚未收到第一个词时不渲染任何东西(transparent: true 让背景透出去 = 视觉上不存在)
    return <div className="h-full w-full" />;
  }

  return (
    <div
      className="h-screen w-screen p-2 animate-langcat-pop"
      data-langcat-selectable="true"
    >
      <WordPopover
        word={active.word}
        state={active.state}
        onClose={() => window.langcat?.closePopover?.()}
        isRegenerating={isRegenerating}
        onRegenerate={() => {
          if (isRegenerating) return;
          const word = active.word;
          setIsRegenerating(true);
          void regenerateLangCatDictionary(word)
            .then((reply) => {
              // 把 reply 拆成 result / failure 写回 state.morphology / morphologyFailure
              const split = splitMorphReply(reply);
              setActive((curr) => {
                if (!curr || curr.word !== word) return curr;
                if (curr.state.kind !== 'success') return curr;
                const updated: LookupState = {
                  ...curr.state,
                  morphology: split.result,
                  morphologyFailure: split.failure,
                };
                cacheRef.current.set(word, updated);
                return { word, state: updated };
              });
            })
            .catch((err: unknown) => {
              console.warn('[LangCat] regenerate failed', err);
            })
            .finally(() => setIsRegenerating(false));
        }}
      />
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
  // LangCat 自家词素查询 —— 正常返回 LangCatLookupReply,IPC 异常时返回 null
  // 用 then(fulfilled, rejected) 的两参数形式 + 显式标注两路返回类型,
  // 让 TS 推导 Promise 总类型为 LangCatLookupReply | null
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
