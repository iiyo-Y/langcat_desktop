/**
 * Vocabulary 单词本视图
 *
 * 列表模式:
 *   - 顶部:搜索框 + 总数
 *   - 列表:word + SRS 进度(stage / total)+ 加入时间 + 移除按钮
 *   - 点击行 → 切换到详情模式
 *
 * 详情模式:
 *   - 复用 WordDetail 组件显示完整词条
 *   - 顶部"返回"回到列表
 *
 * SRS 状态可视化:
 *   - 已学完:静态徽章
 *   - 到期:嘴粉色高亮
 *   - 未到期:灰色进度
 */

import { useEffect, useMemo, useState } from 'react';
import {
  isDue,
  isMastered,
  SRS_TOTAL_STAGES,
  type SavedWord,
} from '@/types/vocabulary';
import { WordDetail } from './WordDetail';

export function VocabularyView(): JSX.Element {
  const [items, setItems] = useState<SavedWord[]>([]);
  const [query, setQuery] = useState('');
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 初次加载 + 订阅变更
  useEffect(() => {
    let cancelled = false;
    const lc = window.langcat;
    if (!lc?.vocabularyList) {
      setLoading(false);
      return;
    }
    void lc
      .vocabularyList()
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) setItems(data as SavedWord[]);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    const off = lc.onVocabularyChanged?.((next) => {
      if (cancelled) return;
      if (Array.isArray(next)) setItems(next as SavedWord[]);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) => x.word.includes(q));
  }, [items, query]);

  // 详情模式
  if (activeWord !== null) {
    return (
      <div className="h-full flex flex-col">
        <WordDetail
          key={activeWord}
          word={activeWord}
          onBack={() => setActiveWord(null)}
        />
      </div>
    );
  }

  // 列表模式
  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-langcat-white text-3xl font-extrabold tracking-tight">
            单词本
          </h1>
          <div className="text-langcat-white/70 text-[13px]">
            共{' '}
            <span className="text-langcat-white font-bold">{items.length}</span>{' '}
            个词
          </div>
        </div>
        <p className="text-langcat-white/70 text-[13px] mt-1">
          按 1 / 3 / 7 / 15 / 30 天遗忘曲线复习。点击词条查看完整解析。
        </p>
      </header>

      <section className="bg-langcat-white border-langcat border-langcat-outline rounded-langcat-card shadow-langcat-lg overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b-2 border-langcat-outline/10">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索单词…"
            className="w-full h-10 px-4 rounded-langcat-button border-2 border-langcat-outline/30 bg-langcat-white text-langcat-outline text-[14px] placeholder:text-langcat-outline/40 focus:border-langcat-outline focus:outline-none transition-colors"
          />
        </div>

        <div className="px-3 py-3 max-h-[60vh] overflow-auto">
          {loading ? (
            <div className="text-langcat-outline/50 text-[13px] px-3 py-6 text-center">
              加载中…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasQuery={query.trim() !== ''} />
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((it) => (
                <VocabularyRow
                  key={it.word}
                  item={it}
                  onOpen={() => setActiveWord(it.word)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function VocabularyRow({
  item,
  onOpen,
}: {
  item: SavedWord;
  onOpen: () => void;
}): JSX.Element {
  const due = isDue(item);
  const mastered = isMastered(item);

  const onRemove = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    try {
      await window.langcat.vocabularyRemove(item.word);
    } catch (err) {
      console.warn('[LangCat] vocabulary remove failed', err);
    }
  };

  return (
    <li>
      <div
        className={`
          group flex items-center gap-3 px-3 py-2.5 rounded-langcat-small
          border-2 cursor-pointer transition-colors
          ${
            due
              ? 'border-langcat-mouth/60 bg-langcat-mouth/8 hover:bg-langcat-mouth/15'
              : 'border-transparent hover:border-langcat-outline/30 hover:bg-langcat-pale-blue/15'
          }
        `}
        onClick={onOpen}
      >
        <div className="flex-1 min-w-0">
          <div className="text-langcat-outline text-[16px] font-bold font-mono truncate">
            {item.word}
          </div>
          <div className="text-langcat-outline/50 text-[11px] mt-0.5">
            {formatRelative(item.added_at)}加入
          </div>
        </div>

        <SrsBadge stage={item.stage} due={due} mastered={mastered} />

        <button
          type="button"
          onClick={(e) => void onRemove(e)}
          aria-label="移除"
          title="移除"
          className="
            shrink-0 h-8 w-8 rounded-full
            border-2 border-langcat-outline/0 text-langcat-outline/0
            flex items-center justify-center
            group-hover:border-langcat-outline/40 group-hover:text-langcat-outline/55
            hover:!border-langcat-mouth hover:!bg-langcat-mouth hover:!text-langcat-white
            transition-all
          "
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line
              x1="3"
              y1="3"
              x2="9"
              y2="9"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line
              x1="3"
              y1="9"
              x2="9"
              y2="3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </li>
  );
}

function SrsBadge({
  stage,
  due,
  mastered,
}: {
  stage: number;
  due: boolean;
  mastered: boolean;
}): JSX.Element {
  if (mastered) {
    return (
      <span className="shrink-0 text-[11px] font-bold px-2 py-[2px] rounded-full bg-langcat-scarf/40 border-2 border-langcat-outline/30 text-langcat-outline">
        已学完
      </span>
    );
  }
  if (due) {
    return (
      <span className="shrink-0 text-[11px] font-bold px-2 py-[2px] rounded-full bg-langcat-mouth text-langcat-white">
        待复习
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[11px] font-bold px-2 py-[2px] rounded-full bg-langcat-pale-blue/30 border border-langcat-outline/30 text-langcat-outline/70">
      {stage}/{SRS_TOTAL_STAGES}
    </span>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }): JSX.Element {
  if (hasQuery) {
    return (
      <div className="text-langcat-outline/50 text-[13px] px-3 py-10 text-center">
        没有匹配的词
      </div>
    );
  }
  return (
    <div className="px-3 py-10 text-center space-y-2">
      <div className="text-langcat-outline text-[15px] font-bold">
        还没收藏任何词
      </div>
      <div className="text-langcat-outline/60 text-[13px] leading-relaxed">
        在任意应用选中英文单词、按 Ctrl+C,popover 弹出后点底部「加入单词本」即可。
      </div>
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
