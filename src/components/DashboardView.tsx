/**
 * Dashboard 视图
 *
 * 当前显示:
 *   - 4 张统计卡片(总词数 / 今日待复习 / 已学完 / 本周新加)
 *   - 今日待复习列表(按 stage 分组,可点"标记完成"推进 SRS)
 *   - 用法说明(快捷键 + 流程)
 *
 * 后续阶段(占位):
 *   - 由这些待复习词生成阅读文章
 *   - 每日 task / 学习连续天数 / 月度统计图
 */

import { useEffect, useMemo, useState } from 'react';
import {
  isDue,
  isMastered,
  SRS_INTERVALS_DAYS,
  SRS_TOTAL_STAGES,
  type SavedWord,
} from '@/types/vocabulary';

const SHORTCUT_DISPLAY = navigator.userAgent.includes('Mac')
  ? '⌘ + ⌥ + W'
  : 'Ctrl + Alt + W';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  /** 点击 dashboard 上某个词跳转到详情(主窗口路由切换) */
  onOpenWord: (word: string) => void;
}

export function DashboardView({ onOpenWord }: Props): JSX.Element {
  const [items, setItems] = useState<SavedWord[]>([]);

  useEffect(() => {
    let cancelled = false;
    const lc = window.langcat;
    if (!lc?.vocabularyList) return;
    void lc.vocabularyList().then((d) => {
      if (cancelled) return;
      if (Array.isArray(d)) setItems(d as SavedWord[]);
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

  const stats = useMemo(() => {
    const now = Date.now();
    const due = items.filter((x) => isDue(x, now));
    const mastered = items.filter(isMastered);
    const newThisWeek = items.filter((x) => now - x.added_at < 7 * DAY_MS);
    return {
      total: items.length,
      due: due.length,
      mastered: mastered.length,
      newThisWeek: newThisWeek.length,
      dueWords: due.sort((a, b) => a.next_due_at - b.next_due_at),
    };
  }, [items]);

  return (
    <div className="space-y-5">
      {/* 顶部标题 */}
      <header>
        <h1 className="text-langcat-white text-3xl font-extrabold tracking-tight">
          仪表盘
        </h1>
        <p className="text-langcat-white/70 text-[13px] mt-1">
          按遗忘曲线安排复习:每天打开看一眼,完成今日待复习,记忆就长存。
        </p>
      </header>

      {/* 4 张统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="总词数" value={stats.total} accent="white" />
        <StatCard label="今日待复习" value={stats.due} accent="mouth" highlight={stats.due > 0} />
        <StatCard label="本周新加" value={stats.newThisWeek} accent="crown" />
        <StatCard label="已学完" value={stats.mastered} accent="scarf" />
      </div>

      {/* 今日待复习列表 */}
      <section className="bg-langcat-white border-langcat border-langcat-outline rounded-langcat-card shadow-langcat-lg p-5">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-langcat-outline text-[18px] font-extrabold">
            今日待复习
          </h2>
          {stats.due > 0 && (
            <span className="text-langcat-outline/60 text-[13px]">
              {stats.due} 个 · 按到期时间排序
            </span>
          )}
        </div>
        {stats.due === 0 ? (
          <EmptyDue total={stats.total} />
        ) : (
          <ul className="space-y-1.5">
            {stats.dueWords.map((w) => (
              <DueRow key={w.word} item={w} onOpen={() => onOpenWord(w.word)} />
            ))}
          </ul>
        )}
      </section>

      {/* 用法 */}
      <section className="bg-langcat-white/95 border-langcat border-langcat-outline rounded-langcat-card shadow-langcat-lg p-5">
        <h2 className="text-langcat-outline text-[16px] font-extrabold mb-3">
          快速用法
        </h2>
        <ol className="space-y-2.5 text-[14px] text-langcat-outline/80 leading-relaxed">
          <li>
            <span className="font-bold text-langcat-outline">1.</span>{' '}
            任意应用选中英文单词,按{' '}
            <kbd className="px-1.5 py-0.5 border border-langcat-outline/40 bg-langcat-pale-blue/30 rounded text-[12px] font-mono">
              Ctrl + C
            </kbd>{' '}
            popover 自动弹出。
          </li>
          <li>
            <span className="font-bold text-langcat-outline">2.</span>{' '}
            popover 底部点「加入单词本」 → 这里仪表盘按 1/3/7/15/30 天提醒复习。
          </li>
          <li>
            <span className="font-bold text-langcat-outline">3.</span>{' '}
            全局快捷键{' '}
            <kbd className="px-1.5 py-0.5 border border-langcat-outline/40 bg-langcat-pale-blue/30 rounded text-[12px] font-mono">
              {SHORTCUT_DISPLAY}
            </kbd>{' '}
            随时唤醒 popover(剪贴板里若已是英文单词)。
          </li>
        </ol>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  highlight = false,
}: {
  label: string;
  value: number;
  accent: 'white' | 'mouth' | 'crown' | 'scarf';
  highlight?: boolean;
}): JSX.Element {
  const palette = {
    white: 'bg-langcat-white',
    mouth: 'bg-langcat-mouth/15',
    crown: 'bg-langcat-crown/40',
    scarf: 'bg-langcat-scarf/30',
  }[accent];
  return (
    <div
      className={`border-langcat border-langcat-outline rounded-langcat-card shadow-langcat-lg px-4 py-3 ${palette} ${
        highlight ? 'ring-2 ring-langcat-mouth/50' : ''
      }`}
    >
      <div className="text-langcat-outline/60 text-[11px] font-bold uppercase tracking-[0.16em]">
        {label}
      </div>
      <div className="text-langcat-outline text-[28px] font-extrabold leading-tight mt-0.5">
        {value}
      </div>
    </div>
  );
}

function DueRow({
  item,
  onOpen,
}: {
  item: SavedWord;
  onOpen: () => void;
}): JSX.Element {
  const stageLabel =
    item.stage === 0
      ? `第 1 次(刚加入)`
      : item.stage < SRS_TOTAL_STAGES
        ? `第 ${item.stage + 1} 次复习 · 上次 ${SRS_INTERVALS_DAYS[item.stage - 1] ?? '?'} 天前`
        : '已学完';

  const overdue = item.next_due_at <= Date.now() - DAY_MS;

  const onMarkReviewed = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    try {
      await window.langcat.vocabularyMarkReviewed(item.word);
    } catch (err) {
      console.warn('[LangCat] markReviewed failed', err);
    }
  };

  return (
    <li>
      <div
        className="group flex items-center gap-3 px-3 py-2.5 rounded-langcat-small border-2 border-transparent hover:border-langcat-outline/30 hover:bg-langcat-pale-blue/15 cursor-pointer transition-colors"
        onClick={onOpen}
      >
        <div className="flex-1 min-w-0">
          <div className="text-langcat-outline text-[15px] font-bold font-mono truncate">
            {item.word}
          </div>
          <div className="text-langcat-outline/55 text-[11px] mt-0.5">
            {stageLabel}
            {overdue && (
              <span className="ml-2 text-langcat-mouth font-bold">已过期</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => void onMarkReviewed(e)}
          className="
            shrink-0 px-3 py-1.5 rounded-langcat-button
            border-2 border-langcat-outline/40
            text-langcat-outline/70 text-[12px] font-bold
            hover:!border-langcat-mouth hover:!bg-langcat-mouth hover:!text-langcat-white
            transition-colors
          "
          title="标记复习完成,推进到下一阶段"
        >
          完成
        </button>
      </div>
    </li>
  );
}

function EmptyDue({ total }: { total: number }): JSX.Element {
  return (
    <div className="px-3 py-8 text-center space-y-1">
      <div className="text-langcat-outline text-[15px] font-bold">
        {total === 0 ? '还没有任何单词' : '今天没有待复习的词'}
      </div>
      <div className="text-langcat-outline/60 text-[13px]">
        {total === 0
          ? '去任意应用选中英文单词、按 Ctrl+C,popover 上点「加入单词本」即可。'
          : '休息一下吧,明天再来 🐱'}
      </div>
    </div>
  );
}
