/**
 * 单词本本地存储 + Spaced Repetition System(SRS / 遗忘曲线)。
 *
 * 数据按"用户桶"分文件存到 userData/vocab/<bucket>.json:
 *   - 已登录:bucket = Supabase user id(UUID)→ vocab/<uuid>.json
 *   - 未登录:bucket = "_anon"           → vocab/_anon.json
 *
 * 一台机器上多个账号互不干扰;退出登录退到 anon 桶,自己之前在 anon 攒的词还在;
 * 重登原账号能拿回原账号的词。
 *
 * 选 JSON 文件不选 SQLite:
 *   - 几百到上千词的规模,几毫秒内完成 read/write
 *   - 不引入 better-sqlite3 这种 native 依赖,跨平台打包简单
 *   - 用户随时可备份/编辑/迁移这个 JSON
 *
 * SRS 思路:
 *   加词 → stage=0,next_due_at=加词时间+1 天
 *   每次 markReviewed → stage++,next_due_at=复习时间+SRS_INTERVALS_DAYS[stage] 天
 *   stage 到顶视为学完(next_due_at 推到 Number.MAX_SAFE_INTEGER 不再到期)
 *
 * 旧数据兼容:
 *   - 0010 之前的 record 没有 stage/next_due_at/last_reviewed_at 字段,
 *     normalizeOldData 读取时给默认值,不破坏现有用户数据。
 *   - 登录功能上线之前的旧路径 userData/vocabulary.json:
 *     migrateLegacyFile() 在启动时把它一次性挪到 vocab/_anon.json,
 *     这样老用户重启后默认看到的还是自己之前积累的词(以"未登录"形式)。
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as auth from './auth';

export interface SavedWord {
  word: string;
  added_at: number;
  stage: number;
  next_due_at: number;
  last_reviewed_at: number | null;
}

const SRS_INTERVALS_DAYS = [1, 3, 7, 15, 30] as const;
const SRS_TOTAL_STAGES = SRS_INTERVALS_DAYS.length;
const DAY_MS = 24 * 60 * 60 * 1000;

function computeNextDue(stage: number, baseAt: number): number {
  if (stage >= SRS_TOTAL_STAGES) return Number.MAX_SAFE_INTEGER;
  const days = SRS_INTERVALS_DAYS[stage] ?? SRS_INTERVALS_DAYS[0];
  return baseAt + days * DAY_MS;
}

/** 当前活跃 bucket id —— 已登录走 user.id,未登录走 "_anon" */
function currentBucket(): string {
  const sess = auth.currentSession();
  return sess ? sess.user.id : '_anon';
}

function bucketDir(): string {
  return path.join(app.getPath('userData'), 'vocab');
}

function filePath(): string {
  return path.join(bucketDir(), `${currentBucket()}.json`);
}

/**
 * 一次性把登录功能上线前的旧 vocabulary.json 挪到 vocab/_anon.json。
 * 已经迁过(目标存在)就跳过;旧文件不存在也跳过。app.whenReady 后调一次。
 */
export async function migrateLegacyFile(): Promise<void> {
  const legacy = path.join(app.getPath('userData'), 'vocabulary.json');
  const anonTarget = path.join(bucketDir(), '_anon.json');

  let legacyExists = false;
  try {
    await fs.stat(legacy);
    legacyExists = true;
  } catch {
    // 旧文件不存在 — 全新用户,无需迁移
  }
  if (!legacyExists) return;

  try {
    await fs.stat(anonTarget);
    // 目标已存在 → 已经迁过,留旧文件别动(给用户保留备份)
    return;
  } catch {
    // 继续迁
  }

  await fs.mkdir(bucketDir(), { recursive: true });
  await fs.copyFile(legacy, anonTarget);
  console.info(
    `[LangCat] 单词本旧文件已迁移到访客桶:${legacy} → ${anonTarget}`,
  );
}

/** 把任意结构(可能是旧数据)规范化成完整 SavedWord */
function normalizeOldData(x: Record<string, unknown>): SavedWord | null {
  if (typeof x.word !== 'string' || x.word.trim() === '') return null;
  if (typeof x.added_at !== 'number') return null;
  const stage = typeof x.stage === 'number' ? x.stage : 0;
  const last = typeof x.last_reviewed_at === 'number' ? x.last_reviewed_at : null;
  const due =
    typeof x.next_due_at === 'number'
      ? x.next_due_at
      : computeNextDue(stage, last ?? x.added_at);
  return {
    word: x.word,
    added_at: x.added_at,
    stage,
    next_due_at: due,
    last_reviewed_at: last,
  };
}

async function readAll(): Promise<SavedWord[]> {
  try {
    const raw = await fs.readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeOldData(item as Record<string, unknown>))
      .filter((x): x is SavedWord => x !== null);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(items: SavedWord[]): Promise<void> {
  // 写入前确保 bucket 目录存在(首次给某用户保存时它还没建)
  await fs.mkdir(bucketDir(), { recursive: true });
  await fs.writeFile(filePath(), JSON.stringify(items, null, 2), 'utf-8');
}

function normalize(word: string): string {
  return word.trim().toLowerCase();
}

/* ──────────────────────────────────────────────────────────── */
/*  公开 API                                                    */
/* ──────────────────────────────────────────────────────────── */

export async function listVocabulary(): Promise<SavedWord[]> {
  return readAll();
}

export async function addToVocabulary(word: string): Promise<SavedWord[]> {
  const w = normalize(word);
  if (!w) throw new Error('vocabulary-add: word 不能为空');
  const all = await readAll();
  if (all.some((x) => x.word === w)) return all; // 幂等:已存在直接返回
  const now = Date.now();
  const next: SavedWord = {
    word: w,
    added_at: now,
    stage: 0,
    next_due_at: computeNextDue(0, now),
    last_reviewed_at: null,
  };
  const updated = [next, ...all];
  await writeAll(updated);
  return updated;
}

export async function removeFromVocabulary(word: string): Promise<SavedWord[]> {
  const w = normalize(word);
  const all = await readAll();
  const updated = all.filter((x) => x.word !== w);
  if (updated.length !== all.length) await writeAll(updated);
  return updated;
}

/**
 * 标记某词刚刚完成一次复习:stage++,重算下次到期。
 * 已学完(stage=TOTAL)的词调用此函数无效,直接返回当前列表。
 */
export async function markReviewed(word: string): Promise<SavedWord[]> {
  const w = normalize(word);
  const all = await readAll();
  const now = Date.now();
  let changed = false;
  const updated = all.map((x) => {
    if (x.word !== w) return x;
    if (x.stage >= SRS_TOTAL_STAGES) return x;
    changed = true;
    const newStage = x.stage + 1;
    return {
      ...x,
      stage: newStage,
      next_due_at: computeNextDue(newStage, now),
      last_reviewed_at: now,
    };
  });
  if (changed) await writeAll(updated);
  return updated;
}
