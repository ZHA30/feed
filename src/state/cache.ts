import type { TranslationCache, TranslationCacheEntry, TranslationUnit } from "../types.js";
import { readJsonFile, writeJsonFile } from "../lib/files.js";
import { stateFilePath } from "./paths.js";

export async function loadTranslationCache(): Promise<TranslationCache> {
  const cache = await readJsonFile<TranslationCache>(stateFilePath("cache/units.json"), { schemaVersion: 1, entries: {} });
  if (cache.schemaVersion !== 1 || typeof cache.entries !== "object" || cache.entries === null) {
    return { schemaVersion: 1, entries: {} };
  }
  return cache;
}

export async function saveTranslationCache(cache: TranslationCache): Promise<void> {
  await writeJsonFile(stateFilePath("cache/manifest.json"), { schemaVersion: 1 });
  await writeJsonFile(stateFilePath("cache/units.json"), cache);
}

export function putCacheEntry(input: {
  cache: TranslationCache;
  unit: TranslationUnit;
  translated: string;
  model: string;
  targetLanguage: string;
}): void {
  input.cache.entries[input.unit.cacheKey] = {
    targetLanguage: input.targetLanguage,
    kind: input.unit.kind,
    field: input.unit.field,
    sourceHash: input.unit.sourceHash,
    promptVersion: "v1",
    extractionVersion: "v1",
    translated: input.translated,
    model: input.model,
    createdAt: new Date().toISOString(),
  };
}

export function pruneCache(cache: TranslationCache, usedCacheKeys: Set<string>): TranslationCache {
  const entries: TranslationCache["entries"] = {};
  for (const key of usedCacheKeys) {
    const entry = cache.entries[key];
    if (entry) {
      entries[key] = entry;
    }
  }
  return {
    schemaVersion: 1,
    entries,
  };
}
