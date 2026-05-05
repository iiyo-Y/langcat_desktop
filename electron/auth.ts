/**
 * 桌面端认证(Supabase Auth REST 客户端)
 *
 * 设计:
 *   - 直接调 Supabase Auth REST API(不引入 supabase-js):
 *       POST /auth/v1/token?grant_type=password
 *       POST /auth/v1/signup
 *       POST /auth/v1/token?grant_type=refresh_token
 *       POST /auth/v1/logout
 *   - Token 用 electron `safeStorage` 加密 → 写入 userData/auth.json
 *     (Linux 走 secret-service,macOS 走 Keychain,Windows 走 DPAPI)
 *   - 启动时 load,过期则自动 refresh;refresh 失败就 sign-out 让用户重登
 *   - 公开数据(查词、词根表)即使未登录也能用;只有 /api/v1/me 等保护路由需要 token
 *
 * 跟 web 端共用同一个 Supabase 项目 —— auth.users 是同一张表,桌面注册的账号在
 * web 端也能登录。
 */

import { app, safeStorage } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = (process.env.LANGCAT_SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.LANGCAT_SUPABASE_ANON_KEY ?? '';

/**
 * Supabase 配置缺失时不抛异常 —— 让桌面 app 仍可在"未登录可用"模式下跑。
 * 真正调 sign-in / sign-up 才检查;查词、词根表等公开功能不受影响。
 */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';
}

interface StoredSession {
  access_token: string;
  refresh_token: string;
  /** 绝对时间戳(秒,UTC),Supabase 返回 expires_at */
  expires_at: number;
  user: { id: string; email: string };
}

let memSession: StoredSession | null = null;

function authFilePath(): string {
  return path.join(app.getPath('userData'), 'auth.json');
}

/**
 * 启动时加载 — 调用方在 app.whenReady 之后调,主进程内存里保留 session。
 * 解密失败 / 文件损坏:静默清空(用户体验是"自动登出"),log warn。
 */
export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await fsp.readFile(authFilePath());
    if (raw.length === 0) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(
        '[LangCat] safeStorage 不可用(Linux 上需要 secret-service / gnome-keyring),无法读取已保存的登录态',
      );
      return null;
    }
    const json = safeStorage.decryptString(raw);
    const parsed = JSON.parse(json) as StoredSession;
    memSession = parsed;
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn('[LangCat] auth 文件读取失败,视为未登录:', err);
    return null;
  }
}

async function persistSession(s: StoredSession | null): Promise<void> {
  if (s === null) {
    await fsp.rm(authFilePath(), { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      '[LangCat] safeStorage 不可用 —— 当前系统没有 secret service。' +
        ' Linux 用户需安装并启用 gnome-keyring / KWallet 或使用支持 secret-service 的桌面环境。',
    );
  }
  const buf = safeStorage.encryptString(JSON.stringify(s));
  await fsp.writeFile(authFilePath(), buf);
}

interface SupabaseAuthOk {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  user: { id: string; email: string };
}

interface SupabaseAuthErr {
  msg?: string;
  message?: string;
  error?: string;
  error_description?: string;
}

async function callSupabaseAuth(
  pathSeg: string,
  body: unknown,
  authToken?: string,
): Promise<SupabaseAuthOk> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      '[LangCat] 未配置 Supabase —— .env.local 缺 VITE_LANGCAT_SUPABASE_URL / VITE_LANGCAT_SUPABASE_ANON_KEY',
    );
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Accept: 'application/json',
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/${pathSeg}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`[Supabase] 非 JSON 响应:HTTP ${resp.status} - ${text.slice(0, 200)}`);
  }

  if (!resp.ok) {
    const err = parsed as SupabaseAuthErr;
    const msg =
      err.error_description ?? err.message ?? err.msg ?? err.error ?? `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return parsed as SupabaseAuthOk;
}

function toStored(ok: SupabaseAuthOk): StoredSession {
  return {
    access_token: ok.access_token,
    refresh_token: ok.refresh_token,
    expires_at: ok.expires_at,
    user: { id: ok.user.id, email: ok.user.email },
  };
}

export async function signIn(email: string, password: string): Promise<StoredSession> {
  const ok = await callSupabaseAuth('token?grant_type=password', { email, password });
  const sess = toStored(ok);
  memSession = sess;
  await persistSession(sess);
  return sess;
}

export async function signUp(email: string, password: string): Promise<StoredSession | null> {
  const ok = await callSupabaseAuth('signup', { email, password });
  // Supabase 项目若开启邮箱验证,signup 不返回 access_token —— user 需要先点链接才能登录。
  // 这种情况下 ok.access_token 是空字符串,sess.user 只有 id;返回 null 让 UI 提示去查邮箱。
  if (!ok.access_token) {
    return null;
  }
  const sess = toStored(ok);
  memSession = sess;
  await persistSession(sess);
  return sess;
}

export async function signOut(): Promise<void> {
  const cur = memSession;
  memSession = null;
  await persistSession(null);
  if (cur) {
    // Supabase 服务端把 refresh_token 也吊销;失败不阻塞本地登出
    try {
      await callSupabaseAuth('logout', {}, cur.access_token);
    } catch (err) {
      console.warn('[LangCat] Supabase logout 失败(本地已登出):', err);
    }
  }
}

/**
 * 拿当前 access_token,过期(或快过期 60s 内)就先 refresh。
 * 没登录返回 null;refresh 失败也清空登录态返回 null。
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (!memSession) return null;
  const now = Math.floor(Date.now() / 1000);
  if (memSession.expires_at - now > 60) {
    return memSession.access_token;
  }
  // 续期
  try {
    const ok = await callSupabaseAuth('token?grant_type=refresh_token', {
      refresh_token: memSession.refresh_token,
    });
    const next = toStored(ok);
    memSession = next;
    await persistSession(next);
    return next.access_token;
  } catch (err) {
    console.warn('[LangCat] refresh_token 失败,清空登录态:', err);
    memSession = null;
    await persistSession(null);
    return null;
  }
}

export interface CurrentSessionPublic {
  user: { id: string; email: string };
  expires_at: number;
}

export function currentSession(): CurrentSessionPublic | null {
  if (!memSession) return null;
  return {
    user: memSession.user,
    expires_at: memSession.expires_at,
  };
}
