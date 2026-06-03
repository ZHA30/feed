import type { ExtractedFeed, TranslationCache, TranslationResult, TranslationUnit, TranslationUnitResult } from "../types.js";
import { logGroup, logGroupEnd, logKeyValue } from "../lib/logger.js";
import { putCacheEntry } from "../state/cache.js";
import { loadLlmConfig, translateBatch } from "./llm.js";

const BATCH_MAX_UNITS = 40;
const BATCH_MAX_CHARS = 12_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function translateFeed(extracted: ExtractedFeed, cache: TranslationCache): Promise<TranslationResult> {
  const config = loadLlmConfig();
  const results: TranslationUnitResult[] = [];
  const misses: TranslationUnit[] = [];

  for (const unit of extracted.units) {
    const cached = cache.entries[unit.cacheKey];
    if (cached?.translated) {
      results.push(resultFromUnit(unit, "cached", cached.translated, 0));
    }
    else {
      misses.push(unit);
    }
  }

  if (!config) {
    for (const unit of misses) {
      results.push(resultFromUnit(unit, "failed", undefined, 0, "missing_llm_config"));
    }
    return makeResult(extracted, results);
  }

  const batches = makeBatches(misses);
  logGroup(`Translate ${extracted.path}`);
  logKeyValue("cache hits", results.length);
  logKeyValue("misses", misses.length);
  logKeyValue("batches", batches.length);
  let batchIndex = 0;
  for (const batch of batches) {
    batchIndex++;
    const batchStartedAt = Date.now();
    console.log(`batch ${batchIndex}/${batches.length}: ${batch.length} units, ${batch.reduce((sum, unit) => sum + unit.sourceText.length, 0)} chars`);
    try {
      const translated = await withHeartbeat(
        `batch ${batchIndex}/${batches.length}`,
        batchStartedAt,
        () => translateBatch(config, extracted.targetLanguage, batch),
      );
      for (const item of translated) {
        const unit = batch.find((unit) => unit.unitId === item.id);
        if (!unit || !item.translatedText) {
          continue;
        }
        putCacheEntry({ cache, unit, translated: item.translatedText, model: config.model, targetLanguage: extracted.targetLanguage });
        results.push(resultFromUnit(unit, "translated", item.translatedText, 1));
      }
      console.log(`batch ${batchIndex}/${batches.length}: ok in ${formatDuration(Date.now() - batchStartedAt)}`);
    }
    catch {
      console.log(`batch ${batchIndex}/${batches.length}: failed, retrying as single-unit requests`);
      let fallbackIndex = 0;
      for (const unit of batch) {
        fallbackIndex++;
        const fallbackStartedAt = Date.now();
        try {
          const [translated] = await withHeartbeat(
            `batch ${batchIndex}/${batches.length} fallback ${fallbackIndex}/${batch.length}`,
            fallbackStartedAt,
            () => translateBatch(config, extracted.targetLanguage, [unit]),
          );
          if (translated?.translatedText) {
            putCacheEntry({ cache, unit, translated: translated.translatedText, model: config.model, targetLanguage: extracted.targetLanguage });
            results.push(resultFromUnit(unit, "translated", translated.translatedText, 2));
          }
          else {
            results.push(resultFromUnit(unit, "failed", undefined, 2, "empty_translation"));
          }
        }
        catch (error) {
          results.push(resultFromUnit(unit, "failed", undefined, 2, error instanceof Error ? error.message : "translation_failed"));
        }
      }
      console.log(`batch ${batchIndex}/${batches.length}: fallback done in ${formatDuration(Date.now() - batchStartedAt)}`);
    }
  }
  logGroupEnd();

  return makeResult(extracted, results);
}

function makeBatches(units: TranslationUnit[]): TranslationUnit[][] {
  const batches: TranslationUnit[][] = [];
  let current: TranslationUnit[] = [];
  let chars = 0;
  for (const unit of units) {
    if (current.length > 0 && (current.length >= BATCH_MAX_UNITS || chars + unit.sourceText.length > BATCH_MAX_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(unit);
    chars += unit.sourceText.length;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

function resultFromUnit(
  unit: TranslationUnit,
  status: TranslationUnitResult["status"],
  translatedText?: string,
  attempts = 0,
  errorCode?: string,
): TranslationUnitResult {
  return {
    unitId: unit.unitId,
    path: unit.path,
    itemKey: unit.itemKey,
    field: unit.field,
    cacheKey: unit.cacheKey,
    status,
    translatedText,
    attempts,
    translatedAt: translatedText ? new Date().toISOString() : undefined,
    errorCode,
  };
}

function makeResult(extracted: ExtractedFeed, units: TranslationUnitResult[]): TranslationResult {
  return {
    path: extracted.path,
    pathKey: extracted.pathKey,
    feedId: extracted.feedId,
    limit: extracted.limit,
    targetLanguage: extracted.targetLanguage,
    units,
    issues: [],
  };
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function withHeartbeat<T>(label: string, startedAt: number, task: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    console.log(`${label}: running ${formatDuration(Date.now() - startedAt)}...`);
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  try {
    return await task();
  }
  finally {
    clearInterval(timer);
  }
}
