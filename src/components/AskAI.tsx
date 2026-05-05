/**
 * AskAI —— 词条追问区块
 *
 * 嵌在 WordPopover 右栏(并列于词语解析)。用户对当前词有疑问可以追问,
 * 历史对话留在 popover 实例内存(关闭/切词清空)。
 *
 * 设计:
 *   - 常驻展开:右栏整列就是 AI 面板,不再折叠
 *   - 顶部小标题(AI 助手 · WORD)+ 对话历史 + 输入框 + 发送
 *   - 简单输入(textarea 2 行高,Enter 发送,Shift+Enter 换行)
 *   - 错误时在历史下面显示红色提示,不打断输入
 *   - 没历史时占位提示("还没有提问"),让面板不空荡
 */

import { useEffect, useRef, useState } from 'react';
import { askLangCatAI } from '@lib/langcat-api';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface AskAIResponse {
  data?: { answer?: string };
}

export function AskAI({ word }: { word: string }): JSX.Element {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 词变更时清空对话(每个词独立上下文)
  useEffect(() => {
    setHistory([]);
    setInput('');
    setError(null);
  }, [word]);

  // 新消息时滚到底
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [history, pending]);

  const submit = async (): Promise<void> => {
    const q = input.trim();
    if (!q || pending) return;
    setInput('');
    setError(null);
    const userTurn: ChatTurn = { role: 'user', content: q };
    setHistory((prev) => [...prev, userTurn]);
    setPending(true);
    try {
      // 走 askLangCatAI wrapper:401/429 会变 typed error,触发全局 errorBus
      // → MainView 弹登录 / Toast。这里 catch 仍展示 message,跟原行为一致。
      const res = (await askLangCatAI({
        word,
        question: q,
        history: history, // 把发送之前的历史给 LLM 做上下文
      })) as AskAIResponse;
      const answer = res?.data?.answer ?? '';
      if (!answer) {
        throw new Error('AI 未返回内容');
      }
      setHistory((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <section className="h-full flex flex-col border-2 border-langcat-outline rounded-langcat-small bg-langcat-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b-2 border-langcat-outline/15 bg-langcat-pale-blue/15 shrink-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-langcat-outline/65">
          AI 助手 · {word}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-langcat-outline/40">
          切词清空 · 不持久化
        </div>
      </div>

      {/* 对话历史(占满剩余高度,内部滚动) */}
      <div
        ref={scrollerRef}
        className="flex-1 px-3 py-3 overflow-auto space-y-2 min-h-0"
      >
        {history.length === 0 && !pending && (
          <div className="h-full flex items-center justify-center text-center px-2">
            <div className="text-langcat-outline/50 text-[12px] leading-relaxed">
              问关于 <span className="font-bold text-langcat-outline/70">{word}</span> 的任何问题
              <br />
              用法 · 记忆方法 · 近义词 · 词源…
            </div>
          </div>
        )}
        {history.map((t, idx) => (
          <ChatBubble key={idx} turn={t} />
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-langcat-outline/55 text-[12px]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-langcat-outline/55 animate-pulse" />
            <span>AI 正在思考…</span>
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 text-langcat-mouth text-[12px] bg-langcat-mouth/10 border-t border-langcat-mouth/30 shrink-0">
          {error}
        </div>
      )}

      {/* 输入区 */}
      <div className="px-3 py-2.5 border-t-2 border-langcat-outline/15 shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`问关于 ${word} 的任何问题…`}
          rows={2}
          disabled={pending}
          className="
            w-full px-3 py-2 rounded-langcat-small
            border-2 border-langcat-outline/30 bg-langcat-white
            text-langcat-outline text-[13px] leading-relaxed
            placeholder:text-langcat-outline/35
            focus:outline-none focus:border-langcat-outline
            resize-none transition-colors
            disabled:opacity-60
          "
        />
        <div className="flex items-center justify-between mt-2">
          <div className="text-langcat-outline/40 text-[11px]">
            Enter 发送 · Shift+Enter 换行
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending || input.trim() === ''}
            className="
              px-4 py-1.5 rounded-langcat-button
              border-2 border-langcat-outline bg-langcat-mouth text-langcat-white
              text-[12px] font-bold
              hover:bg-langcat-outline transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {pending ? '思考中' : '发送'}
          </button>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({ turn }: { turn: ChatTurn }): JSX.Element {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-langcat-pale-blue/40 border-2 border-langcat-outline/40 rounded-langcat-small px-3 py-1.5 text-langcat-outline text-[13px] leading-relaxed whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-langcat-crown/30 border-2 border-langcat-outline rounded-langcat-small px-3 py-2 text-langcat-outline text-[13px] leading-relaxed whitespace-pre-wrap">
        {turn.content}
      </div>
    </div>
  );
}
