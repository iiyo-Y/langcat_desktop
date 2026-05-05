/**
 * 登录 / 注册视图(全屏覆盖式 modal)
 *
 * 用户点 Sidebar 底部"登录"打开;登录成功 / 关闭 → onClose 由父级关闭。
 *
 * 设计:
 *   - 默认登录模式;有"还没账号?注册"切换到注册模式
 *   - 注册成功后:如果 Supabase 项目开启了邮件验证,提示去查邮件;否则直接登入
 *   - 错误信息红色卡片显示,不打断输入
 *   - Esc 关闭(交给父级 onClose 处理)
 */

import { useEffect, useState } from 'react';

interface Props {
  onClose: () => void;
}

type Mode = 'sign-in' | 'sign-up';

export function LoginView({ onClose }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (): Promise<void> => {
    if (pending) return;
    setError(null);
    setInfo(null);
    if (!email.includes('@')) {
      setError('邮箱格式不对');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    setPending(true);
    try {
      if (mode === 'sign-in') {
        await window.langcat.authSignIn({ email, password });
        onClose();
      } else {
        const result = await window.langcat.authSignUp({ email, password });
        if (result.needs_email_verification) {
          setInfo(
            '注册成功。Supabase 项目开启了邮箱验证 —— 请去邮箱点确认链接,然后回来登录。',
          );
        } else {
          // 直接登入
          onClose();
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-langcat-outline/85 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="
          w-full max-w-sm bg-langcat-white border-langcat border-langcat-outline
          rounded-langcat-card shadow-langcat-lg overflow-hidden
        "
      >
        {/* 标题 */}
        <header className="px-5 pt-5 pb-3 flex items-center gap-3">
          <span className="border-langcat border-langcat-outline bg-langcat-pale-blue/40 inline-flex h-9 w-9 items-center justify-center rounded-langcat-small shrink-0">
            <img src="./brand/logo.png" alt="" className="h-7 w-7" />
          </span>
          <div className="flex-1">
            <div className="text-langcat-outline text-lg font-extrabold tracking-tight">
              {mode === 'sign-in' ? '登录 LangCat' : '注册 LangCat'}
            </div>
            <div className="text-langcat-outline/55 text-[12px] mt-0.5">
              {mode === 'sign-in' ? '欢迎回来' : '使用邮箱创建一个账号'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 h-7 w-7 rounded-full border-2 border-langcat-outline/40 text-langcat-outline/55 text-xs hover:bg-langcat-mouth hover:text-langcat-white hover:border-langcat-mouth transition-colors"
          >
            ✕
          </button>
        </header>

        {/* 表单 */}
        <form
          className="px-5 pb-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.16em] text-langcat-outline/55 mb-1">
              邮箱
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              placeholder="you@example.com"
              className="
                w-full px-3 py-2 rounded-langcat-small
                border-2 border-langcat-outline/30 bg-langcat-white
                text-langcat-outline text-[14px]
                placeholder:text-langcat-outline/35
                focus:outline-none focus:border-langcat-outline
                disabled:opacity-60 transition-colors
              "
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.16em] text-langcat-outline/55 mb-1">
              密码
            </label>
            <input
              type="password"
              required
              autoComplete={
                mode === 'sign-in' ? 'current-password' : 'new-password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              placeholder="至少 6 位"
              className="
                w-full px-3 py-2 rounded-langcat-small
                border-2 border-langcat-outline/30 bg-langcat-white
                text-langcat-outline text-[14px]
                placeholder:text-langcat-outline/35
                focus:outline-none focus:border-langcat-outline
                disabled:opacity-60 transition-colors
              "
            />
          </div>

          {error && (
            <div className="border-2 border-langcat-mouth bg-langcat-mouth/10 rounded-langcat-small px-3 py-2 text-langcat-mouth text-[12px] break-words leading-relaxed">
              {error}
            </div>
          )}
          {info && (
            <div className="border-2 border-langcat-outline/40 bg-langcat-crown/30 rounded-langcat-small px-3 py-2 text-langcat-outline text-[12px] break-words leading-relaxed">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={pending || email.trim() === '' || password === ''}
            className="
              w-full h-10 rounded-langcat-button
              border-2 border-langcat-outline bg-langcat-mouth text-langcat-white
              text-[13px] font-bold tracking-wide
              hover:bg-langcat-outline transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {pending
              ? mode === 'sign-in'
                ? '登录中…'
                : '注册中…'
              : mode === 'sign-in'
                ? '登录'
                : '注册'}
          </button>

          <div className="text-center text-[12px] text-langcat-outline/55 pt-1">
            {mode === 'sign-in' ? '还没有账号?' : '已经有账号?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setError(null);
                setInfo(null);
              }}
              className="text-langcat-mouth font-bold hover:underline"
            >
              {mode === 'sign-in' ? '注册新账号' : '去登录'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
