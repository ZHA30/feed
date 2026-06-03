export const ITEM_FIELDS = ["title", "description", "content:encoded", "summary", "content"] as const;

export type ItemField = (typeof ITEM_FIELDS)[number];

export interface FeedConfig {
  path: string;
  pathKey: string;
  feedId: string;
  url: string;
  targetLanguage: string;
  limit: number;
  fields: ItemField[];
}

export interface PipelineIssue {
  stage: "config" | "fetch" | "normalize" | "window" | "extract" | "translate" | "render" | "write" | "publish" | "commit-state";
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
  itemKey?: string;
  field?: ItemField;
  unitId?: string;
}

export interface NormalizedFeed {
  channel: {
    _meta: {
      path: string;
      pathKey: string;
      feedId: string;
      sourceUrl: string;
      finalUrl?: string;
      targetLanguage: string;
      sourceFormat: "rss" | "atom" | "unknown";
      fetchedAt: string;
      sourceHash: string;
      limit: number;
    };
    title: string;
    link: string;
    description: string;
    language: string;
    image?: {
      url?: string;
      title?: string;
      link?: string;
    };
    lastBuildDate: string;
    items: NormalizedItem[];
  };
  issues: PipelineIssue[];
}

export interface NormalizedItem {
  _meta: {
    itemKey: string;
    sourceOrder: number;
    sourceHash: string;
    sourceId?: string;
  };
  title: string;
  description: string;
  "content:encoded": string;
  summary: string;
  content: string;
  link: string;
  guid: string;
  publishedAt: string;
  updatedAt: string;
  sortDate: string;
  author: string;
  category: string[];
  enclosure?: {
    url?: string;
    type?: string;
    length?: string;
  };
}

export interface TranslationUnit {
  unitId: string;
  path: string;
  pathKey: string;
  feedId: string;
  itemKey: string;
  field: ItemField;
  unitIndex: number;
  kind: "text" | "html-block";
  sourceText: string;
  normalizedSourceText: string;
  sourceHash: string;
  cacheKey: string;
  blockPath?: string;
}

export interface ExtractedField {
  field: ItemField;
  kind: "text" | "html";
  sourceValue: string;
  sourceHash: string;
  unitIds: string[];
}

export interface ExtractedItem {
  itemKey: string;
  sourceItem: NormalizedItem;
  fields: Partial<Record<ItemField, ExtractedField>>;
}

export interface ExtractedFeed {
  path: string;
  pathKey: string;
  feedId: string;
  targetLanguage: string;
  limit: number;
  items: ExtractedItem[];
  units: TranslationUnit[];
  issues: PipelineIssue[];
}

export interface TranslationUnitResult {
  unitId: string;
  path: string;
  itemKey: string;
  field: ItemField;
  cacheKey: string;
  status: "cached" | "translated" | "failed" | "skipped";
  translatedText?: string;
  attempts: number;
  translatedAt?: string;
  errorCode?: string;
}

export interface TranslationResult {
  path: string;
  pathKey: string;
  feedId: string;
  limit: number;
  targetLanguage: string;
  units: TranslationUnitResult[];
  issues: PipelineIssue[];
}

export interface RenderedFeed {
  path: string;
  pathKey: string;
  feedId: string;
  outputPath: string;
  limit: number;
  targetLanguage: string;
  itemCount: number;
  xml: string;
  issues: PipelineIssue[];
}

export interface TranslationCacheEntry {
  targetLanguage: string;
  kind: "text" | "html-block";
  field: ItemField;
  sourceHash: string;
  promptVersion: string;
  extractionVersion: string;
  translated: string;
  model: string;
  createdAt: string;
}

export interface TranslationCache {
  schemaVersion: 1;
  entries: Record<string, TranslationCacheEntry>;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "partial" | "failed";
  feeds: FeedRunReport[];
  totals: {
    feeds: number;
    renderedFeeds: number;
    inputItems: number;
    outputItems: number;
    units: number;
    cacheHits: number;
    translated: number;
    failedUnits: number;
  };
  issues: PipelineIssue[];
}

export interface FeedRunReport {
  path: string;
  sourceUrl: string;
  outputPath?: string;
  limit: number;
  inputItems: number;
  outputItems: number;
  units: number;
  cacheHits: number;
  translated: number;
  failedUnits: number;
  issues: PipelineIssue[];
}
