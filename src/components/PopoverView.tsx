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
import {
  lookupLangCatDictionary,
  regenerateLangCatDictionary,
  type LangCatLookupReply,
  type LangCatLookupResult,
  type LangCatLookupFailure,
} from '@lib/langcat-api';
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

function splitMorphReply(reply: LangCatLookupReply | null): {
  result: LangCatLookupResult | null;
  failure: LangCatLookupFailure | null;
} {
  if (!reply) return { result: null, failure: null };
  if (reply.ok) return { result: reply.result, failure: null };
  return { result: null, failure: reply.failure };
}
