import { sha256 } from "../lib/hash.js";
import { extractHtmlBlocks, hasHtmlStructure, reinsertHtmlTranslations } from "../pipeline/html.js";
import type {
  FeatureContext,
  FeatureRunResult,
  NormalizedItem,
  OperationUnit,
  TranslateFeatureConfig,
} from "../types.js";
import { generateFeatureOutputs } from "./shared.js";

const EXTRACTION_VERSION = "v2";

export async function runTranslateFeature(
  items: NormalizedItem[],
  feature: TranslateFeatureConfig,
  context: FeatureContext,
): Promise<FeatureRunResult> {
  const units: OperationUnit[] = [];

  for (const item of items) {
    for (const field of feature.fields) {
      const sourceValue = item[field];
      if (!sourceValue.trim()) {
        continue;
      }
      if (field === "title" || !hasHtmlStructure(sourceValue)) {
        units.push(makeTextUnit(context.feed.pathKey, item._meta.itemKey, field, sourceValue, feature.targetLanguage));
        continue;
      }
      const blocks = extractHtmlBlocks(sourceValue);
      for (const block of blocks) {
        units.push(makeHtmlBlockUnit(context.feed.pathKey, item._meta.itemKey, field, block.blockPath, block.text, feature.targetLanguage));
      }
    }
  }

  const generation = await generateFeatureOutputs({
    kind: "translate",
    systemPrompt: feature.systemPrompt,
    userPrompt: [
      `Translate the input into ${feature.targetLanguage}.`,
      "Preserve URLs, code fragments, numbers, product names, and proper nouns when appropriate.",
      "Return only the translated result for each item.",
    ].join("\n"),
    units,
    context,
    metadata: {
      targetLanguage: feature.targetLanguage,
      extractionVersion: EXTRACTION_VERSION,
    },
  });

  const outputById = new Map(generation.results.filter((result) => result.outputText).map((result) => [result.id, result.outputText as string]));
  const nextItems = items.map((item) => {
    const next: NormalizedItem = {
      ...item,
      category: [...item.category],
      enclosure: item.enclosure ? { ...item.enclosure } : undefined,
    };

    for (const field of feature.fields) {
      const sourceValue = item[field];
      if (!sourceValue.trim()) {
        continue;
      }
      if (field === "title" || !hasHtmlStructure(sourceValue)) {
        const unit = makeTextUnit(context.feed.pathKey, item._meta.itemKey, field, sourceValue, feature.targetLanguage);
        const translated = outputById.get(unit.id);
        if (translated) {
          next[field] = `${translated}¶${sourceValue}`;
        }
        continue;
      }

      const blockTranslations = new Map<string, string>();
      const blocks = extractHtmlBlocks(sourceValue);
      for (const block of blocks) {
        const unit = makeHtmlBlockUnit(context.feed.pathKey, item._meta.itemKey, field, block.blockPath, block.text, feature.targetLanguage);
        const translated = outputById.get(unit.id);
        if (translated) {
          blockTranslations.set(block.blockPath, translated);
        }
      }
      next[field] = reinsertHtmlTranslations(sourceValue, blockTranslations);
    }

    return next;
  });

  return {
    items: nextItems,
    issues: generation.issues,
    stats: {
      kind: "translate",
      units: units.length,
      cacheHits: generation.results.filter((result) => result.status === "cached").length,
      generated: generation.results.filter((result) => result.status === "generated").length,
      failed: generation.results.filter((result) => result.status === "failed").length,
      usedCacheKeys: generation.usedCacheKeys,
    },
  };
}

function makeTextUnit(pathKey: string, itemKey: string, field: TranslateFeatureConfig["fields"][number], sourceText: string, targetLanguage: string): OperationUnit {
  const normalized = normalizeSource(sourceText);
  const sourceHash = sha256(normalized);
  return {
    id: sha256(`translate:text|${pathKey}|${itemKey}|${field}|${sourceHash}`),
    itemKey,
    field,
    sourceText,
    sourceHash,
    feature: "translate",
    unitKind: "text",
    cacheKey: sha256(`cache:translate:text|${targetLanguage}|${EXTRACTION_VERSION}|${field}|${sourceHash}`),
  };
}

function makeHtmlBlockUnit(
  pathKey: string,
  itemKey: string,
  field: TranslateFeatureConfig["fields"][number],
  blockPath: string,
  sourceText: string,
  targetLanguage: string,
): OperationUnit {
  const normalized = normalizeSource(sourceText);
  const sourceHash = sha256(normalized);
  return {
    id: sha256(`translate:html|${pathKey}|${itemKey}|${field}|${blockPath}|${sourceHash}`),
    itemKey,
    field,
    sourceText,
    sourceHash,
    feature: "translate",
    unitKind: "html-block",
    blockPath,
    cacheKey: sha256(`cache:translate:html|${targetLanguage}|${EXTRACTION_VERSION}|${field}|${sourceHash}`),
  };
}

function normalizeSource(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
