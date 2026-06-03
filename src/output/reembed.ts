import type { ExtractedFeed, FeedConfig, NormalizedFeed, NormalizedItem, TranslationResult, TranslationUnit } from "../types.js";
import { reinsertHtmlTranslations } from "../pipeline/html.js";

export function reembedFeed(
  feed: NormalizedFeed,
  config: FeedConfig,
  extracted: ExtractedFeed,
  translation: TranslationResult,
): NormalizedItem[] {
  const unitsById = new Map(extracted.units.map((unit) => [unit.unitId, unit]));
  const translationByUnitId = new Map(
    translation.units
      .filter((result) => result.translatedText)
      .map((result) => [result.unitId, result.translatedText as string]),
  );

  return feed.channel.items.map((item) => {
    const next: NormalizedItem = {
      ...item,
      category: [...item.category],
      enclosure: item.enclosure ? { ...item.enclosure } : undefined,
    };
    const extractedItem = extracted.items.find((entry) => entry.itemKey === item._meta.itemKey);
    if (!extractedItem) {
      return next;
    }

    for (const field of config.fields) {
      const extractedField = extractedItem.fields[field];
      if (!extractedField) {
        continue;
      }
      const fieldUnits = extractedField.unitIds.map((unitId) => unitsById.get(unitId)).filter((unit): unit is TranslationUnit => !!unit);
      if (fieldUnits.length === 0) {
        continue;
      }

      if (extractedField.kind === "text") {
        const unit = fieldUnits[0];
        const translated = translationByUnitId.get(unit.unitId);
        next[field] = translated ? `${translated}¶${extractedField.sourceValue}` : extractedField.sourceValue;
        continue;
      }

      const blockTranslations = new Map<string, string>();
      for (const unit of fieldUnits) {
        if (unit.blockPath === undefined) {
          continue;
        }
        const translated = translationByUnitId.get(unit.unitId);
        if (translated) {
          blockTranslations.set(unit.blockPath, translated);
        }
      }
      next[field] = reinsertHtmlTranslations(extractedField.sourceValue, blockTranslations);
    }

    return next;
  });
}
