/**
 * LangCat 设计 Token —— Desktop 端镜像
 *
 * 唯一真相源在 langcat_chome/src/config/theme.ts,本文件 1:1 同步。
 * 改色号:同时改这里 + tailwind.config.ts(规则 5)
 */

export const LANGCAT_COLORS = {
  brand: '#4F65F5',
  mouth: '#EE3A5F',
  outline: '#1F2D4D',
  crown: '#F8D930',
  scarf: '#7FCFB6',
  white: '#FFFFFF',
  paleBlue: '#A8B5F8',
} as const;

export const LANGCAT_RADIUS = {
  card: '16px',
  button: '999px',
  small: '8px',
} as const;

export const LANGCAT_BORDER_WIDTH = {
  thick: '3px',
  thin: '2px',
} as const;

export const LANGCAT_DURATION = {
  fast: 150,
  normal: 200,
  slow: 300,
} as const;

export type LangcatColorKey = keyof typeof LANGCAT_COLORS;
