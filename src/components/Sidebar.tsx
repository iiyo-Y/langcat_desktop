/**
 * 主窗口左侧导航栏
 *
 * 设计:
 *   - 顶部 logo + LangCat brand
 *   - 中间 nav items(Dashboard / Dictionary / Vocabulary)
 *   - 底部预留 Settings 等次要项位置
 *
 * 视觉:品牌蓝底,白色 active 项,半透明 hover。Sidebar 整体可拖动窗口
 *(WebkitAppRegion:drag),按钮区 no-drag 让 click 不被吞。
 */

import type { Route } from './MainView';
import type { AuthSessionPublic, QuotaEndpoint, QuotaInfo } from '@/types/bridge';

interface NavItem {
  route: Route;
  label: string;
  /** 可选 badge,如"今日待复习 N"显示在右侧 */
  badge?: number;
}

interface Props {
  active: Route;
  onSelect: (r: Route) => void;
  /** 各 route 的 badge 数(在 dashboard 显示今日待复习,vocabulary 显示总数) */
  badges?: Partial<Record<Route, number>>;
  /** 当前登录态 — null 表示未登录(底部显示"登录"按钮) */
  session: AuthSessionPublic | null;
  /** 用户点击底部登录区域(未登录:打开 LoginView;已登录:展开账户菜单退出) */
  onAuthClick: () => void;
  /**
   * 三个端点的实时配额 —— 主进程从 X-RateLimit-* 头里拿,MainView 订阅后传下来。
   * 已登录时显示在账户 chip 下方;未登录或某个端点还没调用过则不显示对应行
   */
  quotas?: Partial<Record<QuotaEndpoint, QuotaInfo>>;
}

/** Sidebar 配额条展示顺序 + 中文标签;改这里同步调整即可(规则 5) */
const QUOTA_DISPLAY: Array<{ endpoint: QuotaEndpoint; label: string }> = [
  { endpoint: 'lookup', label: '查词' },
  { endpoint: 'regenerate', label: '重新生成' },
  { endpoint: 'ask', label: 'AI 追问' },
];

const ITEMS: NavItem[] = [
  { route: 'dashboard', label: '仪表盘' },
  { route: 'dictionary', label: '查词' },
  { route: 'morphemes', label: '词根表' },
  { route: 'vocabulary', label: '单词本' },
];

const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function Sidebar({
  active,
  onSelect,
  badges,
  session,
  onAuthClick,
  quotas,
}: Props): JSX.Element {
  return (
    <aside
      className="bg-langcat-brand w-52 shrink-0 flex flex-col border-r-2 border-langcat-outline/30"
      style={DRAG}
    >
      {/* 顶部 logo */}
      <div className="px-5 py-5 flex items-center gap-3 shrink-0">
        <span className="border-langcat border-langcat-outline bg-langcat-white inline-flex h-9 w-9 items-center justify-center rounded-langcat-small shrink-0">
          <img src="./brand/logo.png" alt="" className="h-7 w-7" />
        </span>
        <div className="text-langcat-white text-[15px] font-extrabold tracking-[0.1em]">
          LANGCAT
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 px-3 py-2 space-y-1" style={NO_DRAG}>
        {ITEMS.map((it) => (
          <NavRow
            key={it.route}
            item={it}
            active={active === it.route}
            badge={badges?.[it.route]}
            onClick={() => onSelect(it.route)}
          />
        ))}
      </nav>

      {/* 底部:账户区 + 配额 + 版本 */}
      <div className="px-3 py-3 space-y-2 shrink-0" style={NO_DRAG}>
        <button
          type="button"
          onClick={onAuthClick}
          className={`
            w-full px-3 py-2 rounded-langcat-small
            flex items-center gap-2.5
            text-[12px] font-bold tracking-wide
            transition-colors
            ${
              session
                ? 'bg-langcat-white/10 text-langcat-white hover:bg-langcat-white/20'
                : 'border-2 border-dashed border-langcat-white/40 text-langcat-white/85 hover:border-langcat-white hover:bg-langcat-white/10'
            }
          `}
          title={session ? `${session.user.email} · 点击退出` : '点击登录或注册'}
        >
          <span
            className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-extrabold ${
              session
                ? 'bg-langcat-mouth text-langcat-white'
                : 'bg-langcat-white/15 text-langcat-white/65'
            }`}
          >
            {session ? session.user.email.charAt(0).toUpperCase() : '?'}
          </span>
          <span className="flex-1 text-left truncate">
            {session ? session.user.email : '未登录 · 点击登录'}
          </span>
        </button>

        {/* 今日额度:仅登录态显示;且要至少有一个端点的配额信息(用过一次受保护接口) */}
        {session && quotas && hasAnyQuota(quotas) && (
          <QuotaPanel quotas={quotas} />
        )}

        <div className="px-3 text-langcat-white/45 text-[10px]">v0.1 · alpha</div>
      </div>
    </aside>
  );
}

/** 至少有一个端点的配额信息才显示面板 */
function hasAnyQuota(quotas: Partial<Record<QuotaEndpoint, QuotaInfo>>): boolean {
  return QUOTA_DISPLAY.some(({ endpoint }) => quotas[endpoint] !== undefined);
}

/**
 * 配额展示面板 — 紧凑布局放在账户 chip 下方:
 *   今日额度
 *   ─────────
 *   查词       12/50
 *   ▰▰▰▰▰▱▱▱▱▱
 *   ...
 *
 * 进度条用纯 CSS,不用图标库
 */
function QuotaPanel({
  quotas,
}: {
  quotas: Partial<Record<QuotaEndpoint, QuotaInfo>>;
}): JSX.Element {
  return (
    <div className="px-3 pt-2 pb-1 rounded-langcat-small bg-langcat-white/5">
      <div className="text-langcat-white/55 text-[10px] font-bold uppercase tracking-[0.16em] mb-1.5">
        今日额度
      </div>
      <div className="space-y-1.5">
        {QUOTA_DISPLAY.map(({ endpoint, label }) => {
          const q = quotas[endpoint];
          if (q === undefined) return null;
          return <QuotaRow key={endpoint} label={label} info={q} />;
        })}
      </div>
    </div>
  );
}

function QuotaRow({
  label,
  info,
}: {
  label: string;
  info: QuotaInfo;
}): JSX.Element {
  // remaining 可能在配额异常时 < 0(后端 bug)或 > limit(种子覆盖);clamp 到 [0, limit]
  // 这是显示侧的视觉 clamp,不掩盖业务错误(规则 4 的边界情况:展示安全)
  const safeRemaining = Math.max(0, Math.min(info.remaining, info.limit));
  const used = info.limit - safeRemaining;
  const pct = info.limit > 0 ? Math.round((used / info.limit) * 100) : 0;
  // 颜色阈值:剩 30% 转黄、剩 10% 转红 — 给用户视觉早期信号
  const remainingPct = info.limit > 0 ? safeRemaining / info.limit : 0;
  const barColor =
    remainingPct <= 0.1
      ? 'bg-langcat-mouth'
      : remainingPct <= 0.3
        ? 'bg-langcat-crown'
        : 'bg-langcat-white';
  return (
    <div title={`${label}:剩 ${safeRemaining} / ${info.limit}`}>
      <div className="flex items-center justify-between text-langcat-white/85 text-[11px]">
        <span className="font-bold">{label}</span>
        <span className="font-mono tabular-nums">
          {safeRemaining}
          <span className="text-langcat-white/50">/{info.limit}</span>
        </span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-langcat-white/15 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function NavRow({
  item,
  active,
  badge,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        w-full px-3 py-2.5 rounded-langcat-small
        flex items-center gap-3
        text-[14px] font-bold tracking-wide
        transition-colors
        ${
          active
            ? 'bg-langcat-white text-langcat-outline'
            : 'text-langcat-white/85 hover:bg-langcat-white/15'
        }
      `}
    >
      <span className="flex-1 text-left">{item.label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span
          className={`
            text-[11px] font-bold
            px-1.5 py-[1px] rounded-full
            ${
              active
                ? 'bg-langcat-mouth text-langcat-white'
                : 'bg-langcat-white/25 text-langcat-white'
            }
          `}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
