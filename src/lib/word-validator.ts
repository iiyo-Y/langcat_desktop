/**
 * 英文单词合法性验证 —— 镜像 langcat_chome/src/lib/word-validator.ts
 *
 * 用途:剪贴板内容五花八门(中文、URL、整段文本、纯标点……),只对"看起来是单个英文单词"
 * 的剪贴板才触发取词;否则静默跳过(不是错误,是"不适用"业务状态)。
 */

const MIN = 2;
const MAX = 50;

export type ValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: ValidationFailureReason };

export type ValidationFailureReason =
  | 'empty'
  | 'too-short'
  | 'too-long'
  | 'contains-non-letter'
  | 'multiple-words';

export function validateWord(raw: string): ValidationResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: false, reason: 'empty' };
  if (trimmed.length < MIN) return { valid: false, reason: 'too-short' };
  if (trimmed.length > MAX) return { valid: false, reason: 'too-long' };
  if (/\s/.test(trimmed)) return { valid: false, reason: 'multiple-words' };
  if (!/^[a-zA-Z]+(-[a-zA-Z]+)*$/.test(trimmed)) {
    return { valid: false, reason: 'contains-non-letter' };
  }
  return { valid: true, normalized: trimmed.toLowerCase() };
}
