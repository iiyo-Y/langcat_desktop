/**
 * 词根表(Morphemes Browser)
 *
 * 主窗口左侧导航第 4 项 ——「词根表」对应的视图。
 * 把后端 dict_morphemes 全表(~120 行)一次拉过来,客户端做筛选/搜索。
 *
 * 创意点:
 *   - 顶部 brief:总数 + 当前筛选下的数量
 *   - 类型 chip 行(prefix / suffix / root / ...) 单选式分类,All 显示全部
 *   - 来源语言 chip 行(Latin / Greek / Old English / ...) 单选式
 *   - 文本搜索:同时匹配 canonical / 中文 / 英文 / 例词
 *   - 卡片网格(1/2/3 列响应式),每张卡:大字 canonical + 类型/语言 chip + 中文 +
 *     英文 + 例词链接(点击切到查词视图查这个词)+ 同根词族折叠
 *   - 「翻牌学习」按钮:把当前筛选后的列表打乱,进入翻面学习模式(canonical →
 *     翻面看意义),← / → 切换上一/下一,Esc / 点叉退出
 *
 * 数据流:
 *   useEffect mount 拉一次 listLangCatMorphemes,失败显示错误 + 重试按钮。
 *   筛选/搜索全在内存做(120 行小数据,不必去后端再查)。
 */

import { useEffect, useMemo, useState } from 'react';
import { listLangCatMorphemes, type LangCatMorpheme } from '@lib/langcat-api';

interface Props {
  /** 用户点卡片里的例词时切到查词视图 */
  onOpenWord: (word: string) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: LangCatMorpheme[] }
  | { kind: 'error'; message: string };

/** 类型 chip 文案(中文展示 + 英文 key,英文 key 与 db primary_type 一致) */
const TYPE_LABELS: Record<string, string> = {
  prefix: '前缀',
  suffix: '后缀',
  root: '词根',
  base: '词基',
  stem: '词干',
  combining_form: '连接形',
  linking_vowel: '连接元音',
  allomorph: '同位变体',
  'prefix/combining_form': '前缀/连接形',
  'suffix/combining_form': '后缀/连接形',
};

const TYPE_COLOR: Record<string, string> = {
  prefix: 'bg-langcat-mouth/15 text-langcat-mouth border-langcat-mouth/40',
  suffix: 'bg-langcat-pale-blue/40 text-langcat-outline border-langcat-outline/30',
  root: 'bg-langcat-crown/40 text-langcat-outline border-langcat-outline/40',
  base: 'bg-langcat-scarf/30 text-langcat-outline border-langcat-outline/30',
  stem: 'bg-langcat-pale-blue/30 text-langcat-outline border-langcat-outline/30',
  combining_form:
    'bg-langcat-crown/30 text-langcat-outline border-langcat-outline/30',
  linking_vowel:
    'bg-langcat-pale-blue/25 text-langcat-outline border-langcat-outline/25',
  allomorph: 'bg-langcat-mouth/10 text-langcat-mouth border-langcat-mouth/30',
};

function typeColor(t: string): string {
  return (
    TYPE_COLOR[t] ??
    'bg-langcat-pale-blue/30 text-langcat-outline border-langcat-outline/30'
  );
}

function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

export function MorphemesView({ onOpenWord }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState<string>('all');
  const [activeLang, setActiveLang] = useState<string>('all');
  const [flashcardOpen, setFlashcardOpen] = useState(false);

  const reload = (): void => {
    setState({ kind: 'loading' });
    listLangCatMorphemes()
      .then((items) => setState({ kind: 'ready', items }))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message: msg });
      });
  };

  useEffect(() => {
    reload();
  }, []);

  // 用所有数据算 chip 选项(不依赖当前 filter,这样切换 chip 时不会"消失")
  const allItems = state.kind === 'ready' ? state.items : [];

  // 类型 chip 候选 + 每种数量
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of allItems) m.set(it.primary_type, (m.get(it.primary_type) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [allItems]);

  // 来源语言 chip
  const langCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of allItems) {
      const k = it.origin_language ?? '未标注';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [allItems]);

  // 应用筛选
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((it) => {
      if (activeType !== 'all' && it.primary_type !== activeType) return false;
      if (activeLang !== 'all') {
        const lang = it.origin_language ?? '未标注';
        if (lang !== activeLang) return false;
      }
      if (q !== '') {
        const hay =
          it.canonical_form.toLowerCase() +
          ' ' +
          it.surface_forms.join(' ').toLowerCase() +
          ' ' +
          it.core_meaning_cn.toLowerCase() +
          ' ' +
          it.core_meaning_en.toLowerCase() +
          ' ' +
          it.examples.join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, activeType, activeLang, search]);

  return (
    <div className="bg-langcat-white border-langcat border-langcat-outline shadow-langcat-lg rounded-langcat-card p-5 space-y-4">
      {/* 标题 + 工具条 */}
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-langcat-outline text-xl font-extrabold tracking-tight">
          词根表
        </h1>
        <div className="text-langcat-outline/55 text-[12px] font-bold uppercase tracking-[0.16em]">
          LangCat · 词素学习库
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-langcat-outline/65 text-[12px] font-bold">
            {filtered.length}
            <span className="text-langcat-outline/40"> / {allItems.length}</span>
          </span>
          {state.kind === 'ready' && allItems.length > 0 && (
            <button
              type="button"
              onClick={() => setFlashcardOpen(true)}
              disabled={filtered.length === 0}
              className="
                px-3 py-1.5 rounded-langcat-button
                border-2 border-langcat-outline bg-langcat-mouth text-langcat-white
                text-[12px] font-bold
                hover:bg-langcat-outline transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
              "
              title="把当前筛选后的列表打乱,逐个翻牌背"
            >
              翻牌学习
            </button>
          )}
        </div>
      </header>

      {/* 搜索 */}
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索词根 / 中文 / 英文 / 例词…"
          className="
            w-full px-3 py-2 rounded-langcat-small
            border-2 border-langcat-outline/30 bg-langcat-white
            text-langcat-outline text-[13px]
            placeholder:text-langcat-outline/35
            focus:outline-none focus:border-langcat-outline
            transition-colors
          "
        />
      </div>

      {/* 类型筛选 chip 行 */}
      {typeCounts.length > 0 && (
        <FilterChipRow
          label="类型"
          options={typeCounts}
          active={activeType}
          onSelect={setActiveType}
          formatter={typeLabel}
        />
      )}

      {/* 来源语言 chip 行 */}
      {langCounts.length > 0 && (
        <FilterChipRow
          label="来源"
          options={langCounts}
          active={activeLang}
          onSelect={setActiveLang}
        />
      )}

      {/* 状态:loading / error / 主体 */}
      {state.kind === 'loading' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pt-1">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-32 rounded-langcat-small bg-langcat-pale-blue/20 animate-pulse border-2 border-langcat-outline/15"
            />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div className="border-2 border-langcat-mouth bg-langcat-mouth/10 rounded-langcat-small px-4 py-3">
          <div className="text-langcat-mouth text-[13px] font-bold">加载失败</div>
          <div className="text-langcat-outline/75 text-[12px] mt-1 break-words">
            {state.message}
          </div>
          <button
            type="button"
            onClick={reload}
            className="mt-2 px-3 py-1 rounded-langcat-button border-2 border-langcat-outline text-[12px] font-bold hover:bg-langcat-pale-blue/30"
          >
            重试
          </button>
        </div>
      )}

      {state.kind === 'ready' && filtered.length === 0 && (
        <div className="bg-langcat-pale-blue/15 border-2 border-dashed border-langcat-outline/25 rounded-langcat-small px-4 py-6 text-center text-langcat-outline/60 text-[13px]">
          没有匹配的词素 —— 调整筛选或清空搜索试试
        </div>
      )}

      {state.kind === 'ready' && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((m) => (
            <MorphemeCard key={m.id} morpheme={m} onOpenWord={onOpenWord} />
          ))}
        </div>
      )}

      {/* 翻牌学习模式 */}
      {flashcardOpen && state.kind === 'ready' && filtered.length > 0 && (
        <FlashcardOverlay
          items={filtered}
          onClose={() => setFlashcardOpen(false)}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */

function FilterChipRow({
  label,
  options,
  active,
  onSelect,
  formatter,
}: {
  label: string;
  options: [string, number][];
  active: string;
  onSelect: (v: string) => void;
  formatter?: (s: string) => string;
}): JSX.Element {
  const total = options.reduce((sum, [, n]) => sum + n, 0);
  const fmt = formatter ?? ((s: string) => s);
  return (
    <div className="flex items-start gap-2 flex-wrap">
      <span className="shrink-0 text-langcat-outline/55 text-[11px] font-bold uppercase tracking-[0.16em] mt-1.5">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <Chip
          label={`全部 · ${total}`}
          active={active === 'all'}
          onClick={() => onSelect('all')}
        />
        {options.map(([key, count]) => (
          <Chip
            key={key}
            label={`${fmt(key)} · ${count}`}
            active={active === key}
            onClick={() => onSelect(key)}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-2.5 py-[3px] rounded-langcat-button border-2
        text-[12px] font-bold transition-colors
        ${
          active
            ? 'bg-langcat-outline text-langcat-white border-langcat-outline'
            : 'bg-langcat-white text-langcat-outline/75 border-langcat-outline/25 hover:border-langcat-outline/55 hover:text-langcat-outline'
        }
      `}
    >
      {label}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────── */

function MorphemeCard({
  morpheme,
  onOpenWord,
}: {
  morpheme: LangCatMorpheme;
  onOpenWord: (word: string) => void;
}): JSX.Element {
  const [familyOpen, setFamilyOpen] = useState(false);
  const family = morpheme.family_words ?? [];

  return (
    <article className="border-2 border-langcat-outline/25 hover:border-langcat-outline/60 rounded-langcat-small bg-langcat-white px-3.5 py-3 flex flex-col gap-2 transition-colors">
      {/* 顶部:canonical + 类型/语言 chip */}
      <div className="flex items-start gap-2 flex-wrap">
        <div className="font-mono text-[18px] font-extrabold text-langcat-outline tracking-tight">
          {morpheme.canonical_form}
        </div>
        <span
          className={`shrink-0 inline-block rounded-langcat-button border px-2 py-[1px] text-[10px] font-bold uppercase tracking-wide ${typeColor(morpheme.primary_type)}`}
        >
          {typeLabel(morpheme.primary_type)}
        </span>
        {morpheme.origin_language && (
          <span className="shrink-0 inline-block bg-langcat-white border border-langcat-outline/30 rounded-langcat-button px-2 py-[1px] text-[10px] font-bold text-langcat-outline/65">
            {morpheme.origin_language}
          </span>
        )}
      </div>

      {/* 中文意义(主) */}
      <div className="text-langcat-outline text-[14px] font-bold leading-relaxed">
        {morpheme.core_meaning_cn}
      </div>

      {/* 英文意义(辅) */}
      <div className="text-langcat-outline/60 text-[12px] italic leading-snug">
        {morpheme.core_meaning_en}
      </div>

      {/* 变体 surface_forms(只在与 canonical 不同时显示) */}
      {morpheme.surface_forms.length > 0 &&
        !(morpheme.surface_forms.length === 1 &&
          morpheme.surface_forms[0] === morpheme.canonical_form) && (
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-langcat-outline/45 font-bold uppercase tracking-[0.14em]">
              变体
            </span>
            {morpheme.surface_forms.map((v) => (
              <span
                key={v}
                className="font-mono bg-langcat-pale-blue/30 border border-langcat-outline/25 rounded-langcat-button px-1.5 py-[1px] text-langcat-outline"
              >
                {v}
              </span>
            ))}
          </div>
        )}

      {/* 例词:点击切到查词视图 */}
      {morpheme.examples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-langcat-outline/10 mt-1">
          <span className="shrink-0 text-langcat-outline/45 text-[11px] font-bold uppercase tracking-[0.14em] mr-1">
            例
          </span>
          {morpheme.examples.slice(0, 8).map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onOpenWord(ex.toLowerCase())}
              className="font-mono text-[12px] text-langcat-outline/85 hover:text-langcat-mouth hover:underline transition-colors"
              title={`查看「${ex}」的拆解`}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {/* 同根词族 折叠 */}
      {family.length > 0 && (
        <div className="pt-1 border-t border-langcat-outline/10">
          <button
            type="button"
            onClick={() => setFamilyOpen((v) => !v)}
            className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-langcat-outline/55 hover:text-langcat-outline transition-colors"
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
            <ul className="mt-1.5 space-y-1">
              {family.map((entry, idx) => {
                const colonIdx = entry.indexOf(':');
                const word =
                  colonIdx > 0 ? entry.slice(0, colonIdx).trim() : entry.trim();
                const meaning =
                  colonIdx > 0 ? entry.slice(colonIdx + 1).trim() : '';
                return (
                  <li
                    key={idx}
                    className="flex items-baseline gap-2 text-[12px]"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenWord(word.toLowerCase())}
                      className="font-mono font-bold text-langcat-outline hover:text-langcat-mouth hover:underline shrink-0 transition-colors"
                    >
                      {word}
                    </button>
                    {meaning && (
                      <span className="text-langcat-outline/65 leading-snug">
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
    </article>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  翻牌学习模式                                                  */
/* ──────────────────────────────────────────────────────────── */

/**
 * 把当前筛选后的词素列表洗成随机序,大卡片正面 canonical_form,
 * 点击翻面看 core_meaning_cn / en + examples;键盘 ←/→ 切换。
 *
 * 进入时打乱一次,关闭后内部状态丢弃(下次重新洗牌)。
 */
function FlashcardOverlay({
  items,
  onClose,
}: {
  items: LangCatMorpheme[];
  onClose: () => void;
}): JSX.Element {
  // 进入时洗一次,后续切换不重洗
  const [shuffled] = useState(() => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  });
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const cur = shuffled[idx];

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') {
        setIdx((i) => Math.min(shuffled.length - 1, i + 1));
        setFlipped(false);
      } else if (e.key === 'ArrowLeft') {
        setIdx((i) => Math.max(0, i - 1));
        setFlipped(false);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shuffled.length, onClose]);

  if (!cur) return <div />;

  return (
    <div
      className="fixed inset-0 z-50 bg-langcat-outline/85 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl flex flex-col items-stretch gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部状态条 */}
        <div className="flex items-center justify-between text-langcat-white text-[12px] font-bold">
          <div className="opacity-70">
            {idx + 1} / {shuffled.length} · 空格翻面 · ← → 切换 · ESC 退出
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-langcat-button border-2 border-langcat-white/40 hover:bg-langcat-white/15 transition-colors"
          >
            退出
          </button>
        </div>

        {/* 卡片 */}
        <button
          type="button"
          onClick={() => setFlipped((v) => !v)}
          className="
            min-h-[320px] bg-langcat-white border-langcat border-langcat-outline
            rounded-langcat-card shadow-langcat-lg
            px-8 py-10 flex flex-col items-center justify-center gap-4
            text-center transition-transform hover:scale-[1.005] active:scale-[0.99]
          "
          title="点击或按空格翻面"
        >
          {!flipped ? (
            <>
              <div className="font-mono text-[64px] font-extrabold text-langcat-outline tracking-tight leading-none">
                {cur.canonical_form}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <span
                  className={`inline-block rounded-langcat-button border px-2.5 py-[2px] text-[12px] font-bold uppercase tracking-wide ${typeColor(cur.primary_type)}`}
                >
                  {typeLabel(cur.primary_type)}
                </span>
                {cur.origin_language && (
                  <span className="bg-langcat-white border border-langcat-outline/40 rounded-langcat-button px-2.5 py-[2px] text-[12px] font-bold text-langcat-outline/65">
                    {cur.origin_language}
                  </span>
                )}
              </div>
              <div className="text-langcat-outline/40 text-[12px] mt-2">
                点击或按空格看意义
              </div>
            </>
          ) : (
            <>
              <div className="font-mono text-[28px] font-extrabold text-langcat-outline tracking-tight">
                {cur.canonical_form}
              </div>
              <div className="text-langcat-outline text-[24px] font-extrabold leading-snug">
                {cur.core_meaning_cn}
              </div>
              <div className="text-langcat-outline/65 text-[15px] italic leading-relaxed">
                {cur.core_meaning_en}
              </div>
              {cur.examples.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 justify-center pt-3 border-t-2 border-langcat-outline/15 w-full">
                  {cur.examples.slice(0, 6).map((ex) => (
                    <span
                      key={ex}
                      className="font-mono bg-langcat-pale-blue/30 border-2 border-langcat-outline/30 rounded-langcat-button px-2 py-[2px] text-[13px] text-langcat-outline"
                    >
                      {ex}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </button>

        {/* 底部 prev/next 按钮 */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={idx === 0}
            onClick={() => {
              setIdx((i) => Math.max(0, i - 1));
              setFlipped(false);
            }}
            className="
              px-4 py-2 rounded-langcat-button
              border-2 border-langcat-white/40 text-langcat-white
              text-[13px] font-bold
              hover:bg-langcat-white/15
              disabled:opacity-35 disabled:cursor-not-allowed
              transition-colors
            "
          >
            ← 上一个
          </button>
          <button
            type="button"
            disabled={idx >= shuffled.length - 1}
            onClick={() => {
              setIdx((i) => Math.min(shuffled.length - 1, i + 1));
              setFlipped(false);
            }}
            className="
              px-4 py-2 rounded-langcat-button
              border-2 border-langcat-white/40 text-langcat-white
              text-[13px] font-bold
              hover:bg-langcat-white/15
              disabled:opacity-35 disabled:cursor-not-allowed
              transition-colors
            "
          >
            下一个 →
          </button>
        </div>
      </div>
    </div>
  );
}
