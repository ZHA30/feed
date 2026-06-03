import type { ExtractedFeed, ExtractedItem, FeedConfig, ItemField, NormalizedFeed, TranslationUnit } from "../types.js";
import { sha256 } from "../lib/hash.js";
import { extractHtmlBlocks, hasHtmlStructure } from "./html.js";

const PROMPT_VERSION = "v1";
const EXTRACTION_VERSION = "v1";

export function extractFeed(feed: NormalizedFeed, config: FeedConfig): ExtractedFeed {
  const items: ExtractedItem[] = [];
  const units: TranslationUnit[] = [];

  for (const item of feed.channel.items) {
    const extractedItem: ExtractedItem = {
      itemKey: item._meta.itemKey,
      sourceItem: item,
      fields: {},
    };

    for (const field of config.fields) {
      const sourceValue = item[field] ?? "";
      if (!sourceValue.trim()) {
        continue;
      }

      const unitStart = units.length;
      if (field === "title" || !hasHtmlStructure(sourceValue)) {
        units.push(makeUnit(feed, item._meta.itemKey, field, "text", sourceValue, units.length));
        extractedItem.fields[field] = {
          field,
          kind: "text",
          sourceValue,
          sourceHash: sha256(sourceValue),
          unitIds: units.slice(unitStart).map((unit) => unit.unitId),
        };
        continue;
      }

      const blocks = extractHtmlBlocks(sourceValue);
      for (const block of blocks) {
        units.push(makeUnit(feed, item._meta.itemKey, field, "html-block", block.text, units.length, block.blockPath));
      }
      extractedItem.fields[field] = {
        field,
        kind: "html",
        sourceValue,
        sourceHash: sha256(sourceValue),
        unitIds: units.slice(unitStart).map((unit) => unit.unitId),
      };
    }

    items.push(extractedItem);
  }

  return {
    path: config.path,
    pathKey: config.pathKey,
    feedId: config.feedId,
    targetLanguage: config.targetLanguage,
    limit: config.limit,
    items,
    units,
    issues: [],
  };
}

function makeUnit(
  feed: NormalizedFeed,
  itemKey: string,
  field: ItemField,
  kind: "text" | "html-block",
  sourceText: string,
  unitIndex: number,
  blockPath?: string,
): TranslationUnit {
  const normalizedSourceText = sourceText.replace(/\s+/g, " ").trim();
  const sourceHash = sha256(normalizedSourceText);
  const targetLanguage = feed.channel._meta.targetLanguage;
  return {
    unitId: sha256(`unit:v1|${feed.channel._meta.pathKey}|${itemKey}|${field}|${unitIndex}|${sourceHash}`),
    path: feed.channel._meta.path,
    pathKey: feed.channel._meta.pathKey,
    feedId: feed.channel._meta.feedId,
    itemKey,
    field,
    unitIndex,
    kind,
    sourceText,
    normalizedSourceText,
    sourceHash,
    cacheKey: sha256(`cache:v1|${targetLanguage}|${kind}|${PROMPT_VERSION}|${EXTRACTION_VERSION}|${normalizedSourceText}`),
    blockPath,
  };
}
