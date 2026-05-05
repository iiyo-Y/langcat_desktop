/**
 * 业务常量集中管理(规则 5:不允许写死数字/字符串)
 */

export const DICTIONARY_LIMITS = {
  /** 每个词性最多显示几条释义,避免 popover 太挤 */
  maxDefinitionsPerPos: 2,
} as const;

export const HOVER_BEHAVIOR = {
  /** hover 进入到触发查询的延迟(ms),防止鼠标快速划过时狂查 */
  triggerDelayMs: 250,
  /** popover 距离触发单词的垂直间距(px) */
  popoverGap: 10,
  /** popover 宽度(px) */
  popoverWidth: 360,
  /** popover 距离视口边缘的最小留白(px) */
  edgePadding: 16,
} as const;

export const TEXT_LIMITS = {
  /** 输入文本最大字数;超过限制将被截断,避免渲染卡顿 */
  maxInputLength: 4000,
} as const;
