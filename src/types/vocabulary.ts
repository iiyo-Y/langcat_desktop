/**
 * 单词本数据结构 + 遗忘曲线(Spaced Repetition System)逻辑。
 *
 * 与 electron/vocabulary.ts 的同名类型必须 shape 一致(主/渲染层是两个 bundle,
 * 不能跨 import)。改一处必须同步另一处。
 *
 * SRS 思路:
 *   用户加词进单词本 → stage=0, next_due_at = 加入时间 + 1 天
 *   每完成一次复习 → stage++,next_due_at = 复习时间 + SRS_INTERVALS_DAYS[stage] 天
 *   stage 到达 SRS_TOTAL_STAGES 即"学完",next_due_at 设为永远未来
 */

export interface SavedWord {
  /** 小写归一化的英文单词;主键 */
  word: string;
  /** 加入时间(epoch ms) */
  added_at: number;
  /** 已完成复习阶段:0=刚加入未复习,SRS_TOTAL_STAGES=学完 */
  stage: number;
  /** 下次复习到期时间(epoch ms);今天/早于今天的词出现在 dashboard "今日待复习" */
  next_due_at: number;
  /** 上次复习时间(epoch ms);null = 还没复习过 */
  last_reviewed_at: number | null;
}

/**
 * 遗忘曲线复习间隔(天)。指数式增长:1→3→7→15→30。
 * 每完成一次复习,使用对应 stage 的 interval 计算下次到期。
 */
export const SRS_INTERVALS_DAYS = [1, 3, 7, 15, 30] as const;

/** 完成全部阶段所需的复习次数 */
export const SRS_TOTAL_STAGES = SRS_INTERVALS_DAYS.length;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 计算从 baseAt 开始,完成 stage 阶段后下次到期的时间 */
export function computeNextDue(stage: number, baseAt: number): number {
  if (stage >= SRS_TOTAL_STAGES) return Number.MAX_SAFE_INTEGER;
  const days = SRS_INTERVALS_DAYS[stage] ?? SRS_INTERVALS_DAYS[0];
  return baseAt + days * DAY_MS;
}

/** 词当前是否到期需要复习(到期或已过期) */
export function isDue(w: SavedWord, now: number = Date.now()): boolean {
  return w.stage < SRS_TOTAL_STAGES && w.next_due_at <= now;
}

/** 词是否学完(stage 已到顶) */
export function isMastered(w: SavedWord): boolean {
  return w.stage >= SRS_TOTAL_STAGES;
}
