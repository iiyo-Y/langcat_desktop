/**
 * 主窗口 — Sidebar 布局
 *
 * ┌────────────────────────────────────┐
 * │ TitleBar(拖窗 + 窗口控制)         │
 * ├──────────┬─────────────────────────┤
 * │ Sidebar  │ 主内容区(随 route 切换) │
 * │  Logo    │                         │
 * │  ─ 仪表盘│  - DashboardView        │
 * │  ─ 查词  │  - DictionaryView       │
 * │  ─ 单词本│  - VocabularyView       │
 * │          │                         │
 * └──────────┴─────────────────────────┘
 *
 * 路由 state 留在 MainView 顶层,各 view 不知道自己路由名。
 * `Route` 类型从这里 export,Sidebar 也用同一个类型。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { DashboardView } from './DashboardView';
import { DictionaryView } from './DictionaryView';
import { VocabularyView } from './VocabularyView';
import { MorphemesView } from './MorphemesView';
import { LoginView } from './LoginView';
import { Toast, type ToastSpec } from './Toast';
import { isDue, type SavedWord } from '@/types/vocabulary';
import type { AuthSessionPublic, QuotaEndpoint, QuotaInfo } from '@/types/bridge';
import { subscribeLangCatErrors } from '@lib/langcat-api';

export type Route = 'dashboard' | 'dictionary' | 'vocabulary' | 'morphemes';

const BRIDGE_AVAILABLE = typeof window.langcat?.onLookupRecorded === 'function';

/** 端点中文名 — 给 Toast / Sidebar 用,集中防硬编码(规则 5) */
const ENDPOINT_LABELS_CN: Record<QuotaEndpoint, string> = {
  lookup: '查词',
  regenerate: '重新生成',
  ask: 'AI 追问',
};

export function MainView(): JSX.Element {
  const [route, setRoute] = useState<Route>('dashboard');
  /** dashboard 跳词条详情时,自动切到 dictionary 路由并预填查询 */
  const [pendingLookup, setPendingLookup] = useState<string | null>(null);
  const [vocab, setVocab] = useState<SavedWord[]>([]);
  const [session, setSession] = useState<AuthSessionPublic | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  /** 三个端点的最新配额(从 X-RateLimit-* 头)— 仅做展示,不参与业务判定 */
  const [quotas, setQuotas] = useState<Partial<Record<QuotaEndpoint, QuotaInfo>>>(
    {},
  );
  /** 当前 Toast(429 提示);null 表示无 */
  const [toast, setToast] = useState<ToastSpec | null>(null);

  useEffect(() => {
    const lc = window.langcat;
    if (!lc?.vocabularyList) return;
    let cancelled = false;
    void lc.vocabularyList().then((d) => {
      if (cancelled) return;
      if (Array.isArray(d)) setVocab(d as SavedWord[]);
    });
    const off = lc.onVocabularyChanged?.((next) => {
      if (cancelled) return;
      if (Array.isArray(next)) setVocab(next as SavedWord[]);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  // 启动时拉一次当前登录态;主进程同时会广播 onAuthChanged,这里 subscribe 保持同步
  useEffect(() => {
    const lc = window.langcat;
    if (!lc?.authCurrent) return;
    let cancelled = false;
    void lc.authCurrent().then((s) => {
      if (!cancelled) setSession(s);
    });
    const off = lc.onAuthChanged?.((s) => {
      if (!cancelled) setSession(s);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  // 订阅配额广播 — 主进程在每次 langcatFetch 拿到 X-RateLimit-* 头时推一次
  useEffect(() => {
    const lc = window.langcat;
    if (!lc?.onQuotaChanged) return;
    const off = lc.onQuotaChanged((info) => {
      setQuotas((prev) => ({ ...prev, [info.endpoint]: info }));
    });
    return () => off();
  }, []);

  // 登出时清空配额展示(下次登录会从 401 转 200 重新填上,反之亦然)
  useEffect(() => {
    if (session === null) setQuotas({});
  }, [session]);

  // 订阅 typed error 事件总线 —— langcat-api wrapper 在 catch 里 emit
  //   401 → 弹 LoginView;429 → 弹 Toast。
  // 用全局 bus 而不是每个 view 各自 catch,理由:
  //   - 失败处理逻辑跟"哪个 view 调的"无关,集中在一个地方
  //   - LoginView 弹出 / Toast 弹出 都需要 MainView 顶层 state 才能控制
  useEffect(() => {
    const off = subscribeLangCatErrors((evt) => {
      if (evt.kind === 'unauthorized') {
        // 已经登录的情况下还收到 401 — 多半 token 失效,用户要重新登录
        // 直接弹登录窗口,不强制清空 session(主进程那边 refresh 失败时会广播 sign-out)
        setLoginOpen(true);
        return;
      }
      // quota_exceeded
      const { endpoint, reset_at, limit } = evt.error;
      const label = ENDPOINT_LABELS_CN[endpoint];
      setToast({
        title: `${label} 已达今日上限`,
        body: `今日 ${label} 配额 ${limit} 次已用满。{{seconds}}后重置 — 或考虑升级 Pro 解锁更多额度。`,
        resetAt: reset_at,
      });
    });
    return () => off();
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const onAuthClick = (): void => {
    if (session) {
      // 已登录:简单 confirm 后退出。后续可换成下拉菜单(账户 / 设置 / 退出)
      const ok = window.confirm(`确认退出账号 ${session.user.email}?`);
      if (ok) {
        void window.langcat.authSignOut();
      }
    } else {
      setLoginOpen(true);
    }
  };

  const badges = useMemo(() => {
    const due = vocab.filter((x) => isDue(x)).length;
    return {
      dashboard: due,
      vocabulary: vocab.length,
    };
  }, [vocab]);

  const onOpenWord = (word: string): void => {
    setPendingLookup(word);
    setRoute('dictionary');
  };

  return (
    <div className="h-screen flex flex-col bg-langcat-brand font-langcat overflow-hidden">
      <TitleBar />

      {!BRIDGE_AVAILABLE && (
        <div className="bg-langcat-mouth text-langcat-white px-6 py-2 text-[13px] font-bold border-b-langcat border-langcat-outline">
          桥接(preload)未注入,主进程无法把"查到的词"推到这里。
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          active={route}
          onSelect={setRoute}
          badges={badges}
          session={session}
          onAuthClick={onAuthClick}
          quotas={quotas}
        />

        {/* 主内容区:品牌蓝背景包裹白色卡片们 */}
        <main className="flex-1 overflow-auto p-5">
          {route === 'dashboard' && (
            <DashboardView onOpenWord={onOpenWord} />
          )}
          {route === 'dictionary' && (
            <DictionaryView
              key={pendingLookup ?? 'fresh'}
              initialWord={pendingLookup ?? undefined}
            />
          )}
          {route === 'vocabulary' && <VocabularyView />}
          {route === 'morphemes' && <MorphemesView onOpenWord={onOpenWord} />}
        </main>
      </div>

      {loginOpen && <LoginView onClose={() => setLoginOpen(false)} />}
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}
