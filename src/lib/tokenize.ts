/**
 * 文本分词
 *
 * 把一段任意文本切成 token 序列,每个 token 标记是不是英文单词。
 * 渲染层对「英文单词」token 包成 hover 触发器,其他 token 原样输出(保留空格、换行、标点)。
 *
 * 规则 5:正则集中在这里,不让组件层散写
 */

export type Token =
  | { kind: 'word'; text: string }
  | { kind: 'gap'; text: string };

/**
 * 英文单词:连续字母,允许中间一个连字符(如 self-driving)
 *
 * 注意刻意不匹配数字、Unicode 中文、emoji —— 跟 chrome 端的 word-validator 一致
 */
const WORD_REGEX = /[A-Za-z]+(?:-[A-Za-z]+)*/g;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of input.matchAll(WORD_REGEX)) {
    const start = match.index;
    if (start === undefined) continue;
    if (start > cursor) {
      tokens.push({ kind: 'gap', text: input.slice(cursor, start) });
    }
    tokens.push({ kind: 'word', text: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < input.length) {
    tokens.push({ kind: 'gap', text: input.slice(cursor) });
  }
  return tokens;
}

/** 归一化:统一小写,作为缓存键 / API 查询参数 */
export function normalizeWord(word: string): string {
  return word.toLowerCase();
}
