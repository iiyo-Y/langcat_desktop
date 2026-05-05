/**
 * 单词数据结构
 *
 * Desktop 端只保留 Definition(Free Dictionary 英文释义条目)。
 * 中文释义不再走 MyMemory,而是由 LangCat 后端 LLM 生成的 core_meaning_cn
 * + extended_meanings 提供,直接挂在 LangCatLookupResult 上。
 */

export interface Definition {
  partOfSpeech: string;
  meaning: string;
  example: string | undefined;
  source: 'free-dictionary' | 'manual';
}
