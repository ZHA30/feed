import { rm } from "node:fs/promises";
import { loadConfig } from "../config/load.js";
import { extractFeed } from "../pipeline/extract.js";
import { writeTextFile, writeJsonFile } from "../lib/files.js";
import { fetchText } from "../feed/fetch.js";
import { parseFeedXml, windowFeed } from "../feed/normalize.js";
import { appendStepSummary, logGroup, logGroupEnd, logKeyValue, logNotice } from "../lib/logger.js";
import { redactUrl } from "../lib/url.js";
import { reembedFeed } from "../output/reembed.js";
import { renderRss } from "../output/rss.js";
import { loadTranslationCache, pruneCache, saveTranslationCache } from "../state/cache.js";
import { stateFilePath } from "../state/paths.js";
import { translateFeed } from "../pipeline/translate.js";
import type { FeedRunReport, PipelineIssue, RunReport } from "../types.js";

const FETCH_TIMEOUT_SECONDS = 30;

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  const issues: PipelineIssue[] = [];
  const feedReports: FeedRunReport[] = [];
  const usedCacheKeys = new Set<string>();

  await rm("dist", { recursive: true, force: true });

  logGroup("Transfeed setup");
  const configs = await loadConfig();
  const cache = await loadTranslationCache();
  logKeyValue("feeds", configs.length);
  logKeyValue("cache entries", Object.keys(cache.entries).length);
  logGroupEnd();

  for (const config of configs) {
    const feedStartedAt = Date.now();
    logGroup(`Feed ${config.path}`);
    try {
      logKeyValue("source", redactUrl(config.url));
      logKeyValue("target", config.targetLanguage);
      logKeyValue("limit", config.limit);
      const fetched = await fetchText(config.url, FETCH_TIMEOUT_SECONDS);
      const normalized = windowFeed(parseFeedXml(fetched.body, config, fetched.finalUrl));
      logKeyValue("items", normalized.channel.items.length);
      const extracted = extractFeed(normalized, config);
      logKeyValue("units", extracted.units.length);
      const translated = await translateFeed(extracted, cache);
      const renderedItems = reembedFeed(normalized, config, extracted, translated);
      const rendered = renderRss(normalized, config, renderedItems);

      for (const unit of extracted.units) {
        if (translated.units.some((result) => result.cacheKey === unit.cacheKey && result.status !== "failed")) {
          usedCacheKeys.add(unit.cacheKey);
        }
      }

      await writeTextFile(rendered.outputPath, rendered.xml);
      const failedUnits = translated.units.filter((unit) => unit.status === "failed").length;
      const feedIssues = [...normalized.issues, ...extracted.issues, ...translated.issues, ...rendered.issues];
      logKeyValue("cache hits", translated.units.filter((unit) => unit.status === "cached").length);
      logKeyValue("translated", translated.units.filter((unit) => unit.status === "translated").length);
      logKeyValue("failed", failedUnits);
      logKeyValue("output", rendered.outputPath);
      logKeyValue("duration", formatDuration(Date.now() - feedStartedAt));
      issues.push(...feedIssues);
      feedReports.push({
        path: config.path,
        sourceUrl: redactUrl(config.url),
        outputPath: rendered.outputPath,
        limit: config.limit,
        inputItems: normalized.channel.items.length,
        outputItems: rendered.itemCount,
        units: extracted.units.length,
        cacheHits: translated.units.filter((unit) => unit.status === "cached").length,
        translated: translated.units.filter((unit) => unit.status === "translated").length,
        failedUnits,
        issues: feedIssues,
      });
    }
    catch (error) {
      const issue: PipelineIssue = {
        stage: "fetch",
        severity: "error",
        code: "feed_failed",
        message: errorToMessage(error),
        path: config.path,
      };
      issues.push(issue);
      logKeyValue("error", issue.message);
      logKeyValue("duration", formatDuration(Date.now() - feedStartedAt));
      feedReports.push({
        path: config.path,
        sourceUrl: redactUrl(config.url),
        limit: config.limit,
        inputItems: 0,
        outputItems: 0,
        units: 0,
        cacheHits: 0,
        translated: 0,
        failedUnits: 0,
        issues: [issue],
      });
    }
    finally {
      logGroupEnd();
    }
  }

  logGroup("State and report");
  const nextCache = pruneCache(cache, usedCacheKeys);
  await saveTranslationCache(nextCache);
  logKeyValue("next cache", Object.keys(nextCache.entries).length);

  const report = makeReport(runId, startedAt, new Date().toISOString(), feedReports, issues);
  await writeJsonFile(stateFilePath("reports/latest.json"), report);
  logKeyValue("report", stateFilePath("reports/latest.json"));
  logGroupEnd();
  writeSummary(report);
  await appendStepSummary(renderStepSummary(report));

  if (report.status === "failed") {
    process.exitCode = 1;
  }
}

function makeReport(runId: string, startedAt: string, finishedAt: string, feeds: FeedRunReport[], issues: PipelineIssue[]): RunReport {
  const renderedFeeds = feeds.filter((feed) => feed.outputItems > 0).length;
  return {
    runId,
    startedAt,
    finishedAt,
    status: renderedFeeds === 0 ? "failed" : issues.some((issue) => issue.severity === "error") ? "partial" : "success",
    feeds,
    totals: {
      feeds: feeds.length,
      renderedFeeds,
      inputItems: feeds.reduce((sum, feed) => sum + feed.inputItems, 0),
      outputItems: feeds.reduce((sum, feed) => sum + feed.outputItems, 0),
      units: feeds.reduce((sum, feed) => sum + feed.units, 0),
      cacheHits: feeds.reduce((sum, feed) => sum + feed.cacheHits, 0),
      translated: feeds.reduce((sum, feed) => sum + feed.translated, 0),
      failedUnits: feeds.reduce((sum, feed) => sum + feed.failedUnits, 0),
    },
    issues,
  };
}

function writeSummary(report: RunReport): void {
  logNotice(`Transfeed ${report.status}: feeds ${report.totals.renderedFeeds}/${report.totals.feeds}, items ${report.totals.outputItems}, units ${report.totals.units}`);
  for (const issue of report.issues) {
    console.log(`[${issue.severity}] ${issue.path ?? ""} ${issue.code}: ${issue.message}`);
  }
}

function renderStepSummary(report: RunReport): string {
  const rows = report.feeds
    .map((feed) => `| ${feed.path} | ${feed.outputItems} | ${feed.units} | ${feed.cacheHits} | ${feed.translated} | ${feed.failedUnits} |`)
    .join("\n");
  return `## Transfeed ${report.status}

| Metric | Value |
|---|---:|
| Feeds | ${report.totals.renderedFeeds}/${report.totals.feeds} |
| Items | ${report.totals.outputItems} |
| Units | ${report.totals.units} |
| Cache hits | ${report.totals.cacheHits} |
| Translated | ${report.totals.translated} |
| Failed units | ${report.totals.failedUnits} |

| Feed | Items | Units | Cache hits | Translated | Failed |
|---|---:|---:|---:|---:|---:|
${rows}
`;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return "feed failed";
}

await main();
