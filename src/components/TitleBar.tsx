/**
 * 自定义 TitleBar(替代 OS 标题栏)
 *
 * - 整条 36px 品牌蓝,内部除按钮区域外都是窗口拖动区(WebkitAppRegion: drag)
 * - 左侧:LangCat logo + 名字
 * - 右侧:最小化 / 最大化-还原 / 关闭 三个按钮(关闭 hover 变嘴粉)
 *
 * 注意:button 元素必须显式标记 'no-drag',否则 click 会被拖动事件吞掉
 */

import { useEffect, useState } from 'react';

const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

const BRIDGE = typeof window.langcat?.windowMinimize === 'function';

export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!BRIDGE) return;
    const off = window.langcat.onWindowMaximizedChange(setMaximized);
    return off;
  }, []);

  return (
    <header
      className="bg-langcat-brand h-9 flex items-stretch select-none shrink-0 border-b border-langcat-outline/20"
      style={DRAG}
    >
      {/* 品牌区 —— 可拖 */}
      <div className="flex items-center gap-2 flex-1 min-w-0 pl-3">
        <img src="/brand/logo.png" alt="" className="h-5 w-5 shrink-0" />
        <span className="text-langcat-white text-xs font-extrabold tracking-[0.15em]">
          LANGCAT
        </span>
        <span className="text-langcat-white/55 text-[11px] truncate hidden sm:inline">
          · 别想太久,先收藏
        </span>
      </div>

      {/* 窗口按钮区 —— no-drag */}
      <div className="flex items-stretch" style={NO_DRAG}>
        <WindowButton
          ariaLabel="最小化"
          onClick={() => window.langcat?.windowMinimize?.()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line
              x1="2"
              y1="5"
              x2="8"
              y2="5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </WindowButton>

        <WindowButton
          ariaLabel={maximized ? '还原' : '最大化'}
          onClick={() => window.langcat?.windowToggleMaximize?.()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect
                x="1.5"
                y="3"
                width="5.5"
                height="5.5"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
              <path
                d="M3,3 L3,1.5 L8.5,1.5 L8.5,7 L7,7"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect
                x="2"
                y="2"
                width="6"
                height="6"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
              />
            </svg>
          )}
        </WindowButton>

        <WindowButton
          ariaLabel="关闭"
          onClick={() => window.langcat?.windowClose?.()}
          danger
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line
              x1="2.5"
              y1="2.5"
              x2="7.5"
              y2="7.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <line
              x1="2.5"
              y1="7.5"
              x2="7.5"
              y2="2.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </WindowButton>
      </div>
    </header>
  );
}

interface WindowButtonProps {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
  /** 关闭按钮 hover 时变嘴粉 */
  danger?: boolean;
}

function WindowButton({
  ariaLabel,
  onClick,
  children,
  danger = false,
}: WindowButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`
        h-9 w-11 flex items-center justify-center
        text-langcat-white/85 transition-colors
        ${danger ? 'hover:bg-langcat-mouth hover:text-langcat-white' : 'hover:bg-langcat-white/15'}
      `}
    >
      {children}
    </button>
  );
}
