import type { OperationCache, OperationCacheEntry, OperationUnit } from "../types.js";
import { readJsonFile, writeJsonFile } from "../lib/files.js";
import { stateFilePath } from "./paths.js";

export async function loadOperationCache(): Promise<OperationCache> {
  const cache = await readJsonFile<OperationCache>(stateFilePath("cache/units.json"), { schemaVersion: 1, entries: {} });
  if (cache.schemaVersion !== 1 || typeof cache.entries !== "object" || cache.entries === null) {
    return { schemaVersion: 1, entries: {} };
  }
  return cache;
}

export async function saveOperationCache(cache: OperationCache): Promise<void> {
  await writeJsonFile(stateFilePath("cache/manifest.json"), { schemaVersion: 1 });
  await writeJsonFile(stateFilePath("cache/units.json"), cache);
}

export function putCacheEntry(input: {
  cache: OperationCache;
  unit: OperationUnit;
  output: string;
  model: string;
  promptHash: string;
  metadata?: Record<string, string>;
}): void {
  const entry: OperationCacheEntry = {
    feature: input.unit.feature,
    sourceHash: input.unit.sourceHash,
    promptHash: input.promptHash,
    output: input.output,
    model: input.model,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
  input.cache.entries[input.unit.cacheKey] = entry;
}

export function pruneCache(cache: OperationCache, usedCacheKeys: Set<string>): OperationCache {
  const entries: OperationCache["entries"] = {};
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
