import type { FeedFeatureConfig, FeatureContext, FeatureRunResult, NormalizedItem } from "../types.js";
import { runSummaryFeature } from "./summary.js";
import { runTranslateFeature } from "./translate.js";

export async function runFeature(
  items: NormalizedItem[],
  feature: FeedFeatureConfig,
  context: FeatureContext,
): Promise<FeatureRunResult> {
  switch (feature.kind) {
    case "translate":
      return runTranslateFeature(items, feature, context);
    case "summary":
      return runSummaryFeature(items, feature, context);
    default: {
      const exhaustive: never = feature;
      throw new Error(`unsupported feature: ${String(exhaustive)}`);
    }
  }
}
