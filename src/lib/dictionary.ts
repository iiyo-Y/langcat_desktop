/**
 * Free Dictionary API 客户端 —— 镜像 langcat_chome/src/lib/dictionary.ts
 *
 * 文档:https://dictionaryapi.dev/
 * 失败就抛(规则 4)。404 也抛 HttpError,UI 层据此显示「该词不在词典中」。
 */

import { API_ENDPOINTS } from '@config/api';
import { getJson } from '@lib/http';
import type { Definition } from '@/types/word';

interface RawPhonetic {
  text?: string;
  audio?: string;
}

interface RawDefinition {
  definition: string;
  example?: string;
}

interface RawMeaning {
  partOfSpeech: string;
  definitions: RawDefinition[];
}

interface RawDictionaryEntry {
  word: string;
  phonetics: RawPhonetic[];
  meanings: RawMeaning[];
}

export interface DictionaryLookupResult {
  /** IPA 音标;该词没有音标数据时为空字符串(业务状态,非 fallback) */
  phonetic: string;
  /** 释义列表(已按词性压平) */
  definitions: Definition[];
}

export async function lookupDictionary(
  word: string,
  maxDefinitionsPerPos: number,
  signal?: AbortSignal,
): Promise<DictionaryLookupResult> {
  const url = API_ENDPOINTS.freeDictionary.word(word);
  const raw = await getJson<RawDictionaryEntry[]>(url, signal);

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`[LangCat] Free Dictionary 返回了空数组:${word}`);
  }

  const entry = raw[0]!;
  return {
    phonetic: extractPhonetic(entry.phonetics),
    definitions: extractDefinitions(entry.meanings, maxDefinitionsPerPos),
  };
}

function extractPhonetic(phonetics: RawPhonetic[]): string {
  for (const p of phonetics) {
    if (p.text && p.text.trim().length > 0) return p.text;
  }
  return '';
}

function extractDefinitions(
  meanings: RawMeaning[],
  maxPerPos: number,
): Definition[] {
  const result: Definition[] = [];
  for (const meaning of meanings) {
    for (const def of meaning.definitions.slice(0, maxPerPos)) {
      result.push({
        partOfSpeech: meaning.partOfSpeech,
        meaning: def.definition,
        example: def.example,
        source: 'free-dictionary',
      });
    }
  }
  return result;
}
