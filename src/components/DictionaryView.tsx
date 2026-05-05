/**
 * Dictionary 主动查词视图
 *
 * 用户场景:不靠选中文本/Ctrl+C 触发,而是想"翻字典"主动查一个词。
 *
 * 流程:
 *   输入框输入 → 回车 / 点击查询 → 进入 detail 模式显示完整词条卡
 *   detail 模式右上有"返回"回到搜索框 + 历史记录(本会话)
 */

import { useState } from 'react';
import { WordDetail } from './WordDetail';

const VALID_WORD_RE = /^[a-zA-Z]+(-[a-zA-Z]+)*$/;

export function DictionaryView({
  initialWord,
}: {
  /** 由父级(dashboard 跳转/单词本跳转)预填查询;父级 key 变更触发 remount */
  initialWord?: string;
} = {}): JSX.Element {
  const [query, setQuery] = useState(initialWord ?? '');
  const [activeWord, setActiveWord] = useState<string | null>(
    initialWord ?? null,
  );
  const [history, setHistory] = useState<string[]>(
    initialWord ? [initialWord] : [],
  );
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const w = query.trim().toLowerCase();
    if (!w) {
      setError('请输入要查的英文单词');
      return;
    }
    if (w.length < 2 || w.length > 50) {
      setError('单词长度必须在 2 到 50 个字符之间');
      return;
    }
    if (!VALID_WORD_RE.test(w)) {
      setError('只能输入英文字母和连字符');
      return;
    }
    setError(null);
    setActiveWord(w);
    setHistory((prev) => {
      const without = prev.filter((x) => x !== w);
      return [w, ...without].slice(0, 12);
    });
  };

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

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-langcat-white text-3xl font-extrabold tracking-tight">
          查词
        </h1>
        <p className="text-langcat-white/70 text-[13px] mt-1">
          输入英文单词,获取词素拆解 / 多义项 / 词源 / 同根词。AI 会按需自动生成新词条入库。
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="bg-langcat-white border-langcat border-langcat-outline rounded-langcat-card shadow-langcat-lg p-5"
      >
        <div className="flex items-stretch gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (error) setError(null);
            }}
            placeholder="例如 magnificent / philosophy / fundamental"
            autoFocus
            className="flex-1 h-11 px-4 rounded-langcat-button border-2 border-langcat-outline bg-langcat-white text-langcat-outline text-[15px] placeholder:text-langcat-outline/40 focus:outline-none focus:border-langcat-mouth transition-colors"
          />
          <button
            type="submit"
            className="
              h-11 px-6 rounded-langcat-button
              border-2 border-langcat-outline bg-langcat-mouth text-langcat-white
              text-[14px] font-bold
              hover:bg-langcat-outline transition-colors
            "
          >
            查询
          </button>
        </div>
        {error && (
          <div className="mt-3 text-langcat-mouth text-[13px] font-bold">
            {error}
          </div>
        )}
      </form>

      {history.length > 0 && (
        <section className="bg-langcat-white/95 border-langcat border-langcat-outline rounded-langcat-card shadow-langcat-lg p-5">
          <div className="text-langcat-outline/60 text-[11px] font-bold uppercase tracking-[0.16em] mb-3">
            最近查过
          </div>
          <ul className="flex flex-wrap gap-2">
            {history.map((w) => (
              <li key={w}>
                <button
                  type="button"
                  onClick={() => setActiveWord(w)}
                  className="
                    px-3 py-1.5 rounded-langcat-button
                    border-2 border-langcat-outline/30 bg-langcat-pale-blue/20
                    text-langcat-outline text-[13px] font-mono font-bold
                    hover:border-langcat-outline hover:bg-langcat-pale-blue/40
                    transition-colors
                  "
                >
                  {w}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
