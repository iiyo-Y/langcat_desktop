/**
 * Toast — 极简浮窗提示组件
 *
 * 用途:429 配额超限时由 MainView 弹一条"今日 lookup 用满,N 秒后重置"。
 *
 * 设计:
 *   - 单条 toast(后来居上覆盖前一条),不做队列
 *   - 自动倒计时:每秒重渲染显示剩余秒数;到点自动 onDismiss
 *   - 用户可点 ✕ 提前关闭
 *   - 视觉跟 Sidebar / LoginView 错误卡风格一致(品牌嘴红 + 描边)
 *
 * 不引入第三方 toast 库(规则:不加新依赖)
 */

import { useEffect, useState } from 'react';

export interface ToastSpec {
  /** 标题(粗体) */
  title: string;
  /** 正文(允许包含 {{seconds}} 占位符,会被实时秒数替换) */
  body: string;
  /** 倒计时结束的 unix seconds(UTC);到点自动消失 */
  resetAt: number;
}

interface Props {
  toast: ToastSpec;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: Props): JSX.Element | null {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // 到点自动关 — useEffect 里调 onDismiss 避免 render 阶段 setState
  const remaining = Math.max(0, toast.resetAt - now);
  useEffect(() => {
    if (remaining === 0) onDismiss();
  }, [remaining, onDismiss]);

  if (remaining === 0) return null;

  // {{seconds}} 占位 — 不做更复杂模板,场景固定
  const body = toast.body.replace('{{seconds}}', formatDuration(remaining));

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm pointer-events-auto">
      <div className="border-2 border-langcat-mouth bg-langcat-white shadow-langcat-lg rounded-langcat-card px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-langcat-mouth text-[13px] font-extrabold tracking-tight">
            {toast.title}
          </div>
          <div className="text-langcat-outline/80 text-[12px] mt-1 leading-relaxed break-words">
            {body}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭"
          className="shrink-0 h-6 w-6 rounded-full border-2 border-langcat-outline/30 text-langcat-outline/55 text-[10px] hover:bg-langcat-mouth hover:text-langcat-white hover:border-langcat-mouth transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** 秒数 → "1 分 23 秒" / "45 秒" / "2 小时 5 分" */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}
