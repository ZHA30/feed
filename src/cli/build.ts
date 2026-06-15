import { rm } from "node:fs/promises";
import { loadConfig } from "../config/load.js";
import { writeJsonFile, writeTextFile } from "../lib/files.js";
import { appendStepSummary, logGroup, logGroupEnd, logKeyValue, logNotice } from "../lib/logger.js";
import { redactUrl } from "../lib/url.js";
import { fetchText } from "../feed/fetch.js";
import { parseFeedXml, windowFeed } from "../feed/normalize.js";
import { runFeature } from "../features/index.js";
import { renderRss } from "../output/rss.js";
import { loadOperationCache, pruneCache, saveOperationCache } from "../state/cache.js";
import { stateFilePath } from "../state/paths.js";
import type { FeatureRunStatsReport, PipelineIssue, RunReport } from "../types.js";

const FETCH_TIMEOUT_SECONDS = 30;

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  const issues: PipelineIssue[] = [];
  const feedReports: RunReport["feeds"] = [];
  const usedCacheKeys = new Set<string>();

  await rm("dist", { recursive: true, force: true });

  logGroup("Feed build setup");
  const appConfig = await loadConfig();
  const cache = await loadOperationCache();
  logKeyValue("feeds", appConfig.feeds.length);
  logKeyValue("cache entries", Object.keys(cache.entries).length);
  logGroupEnd();

  for (const feedConfig of appConfig.feeds) {
    const feedStartedAt = Date.now();
    logGroup(`Feed ${feedConfig.path}`);
    try {
      logKeyValue("source", redactUrl(feedConfig.url));
      logKeyValue("limit", feedConfig.limit);
      logKeyValue("features", feedConfig.features.map((feature) => feature.kind).join(", "));

      const fetched = await fetchText(feedConfig.url, FETCH_TIMEOUT_SECONDS);
      const normalized = windowFeed(parseFeedXml(fetched.body, feedConfig, fetched.finalUrl));
      logKeyValue("items", normalized.channel.items.length);

      let currentItems = normalized.channel.items;
      const featureStats: FeatureRunStatsReport[] = [];
      const feedIssues: PipelineIssue[] = [...normalized.issues];

      for (const feature of feedConfig.features) {
        const result = await runFeature(currentItems, feature, { feed: feedConfig, cache });
        currentItems = result.items;
        feedIssues.push(...result.issues);
        featureStats.push({
          kind: result.stats.kind,
          units: result.stats.units,
          cacheHits: result.stats.cacheHits,
          generated: result.stats.generated,
          failed: result.stats.failed,
        });
        for (const cacheKey of result.stats.usedCacheKeys) {
          usedCacheKeys.add(cacheKey);
        }
      }

      const rendered = renderRss(normalized, feedConfig, currentItems);
      await writeTextFile(rendered.outputPath, rendered.xml);

      logKeyValue("output", rendered.outputPath);
      logKeyValue("duration", formatDuration(Date.now() - feedStartedAt));

      issues.push(...feedIssues);
      feedReports.push({
        path: feedConfig.path,
        sourceUrl: redactUrl(feedConfig.url),
        outputPath: rendered.outputPath,
        limit: feedConfig.limit,
        inputItems: normalized.channel.items.length,
        outputItems: rendered.itemCount,
        featureStats,
        issues: feedIssues,
      });
    }
    catch (error) {
      const issue: PipelineIssue = {
        stage: "fetch",
        severity: "error",
        code: "feed_failed",
        message: errorToMessage(error),
        path: feedConfig.path,
      };
      issues.push(issue);
      logKeyValue("error", issue.message);
      logKeyValue("duration", formatDuration(Date.now() - feedStartedAt));
      feedReports.push({
        path: feedConfig.path,
        sourceUrl: redactUrl(feedConfig.url),
        limit: feedConfig.limit,
        inputItems: 0,
        outputItems: 0,
        featureStats: [],
        issues: [issue],
      });
    }
    finally {
      logGroupEnd();
    }
  }

  logGroup("State and report");
  const nextCache = pruneCache(cache, usedCacheKeys);
  await saveOperationCache(nextCache);
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

function makeReport(runId: string, startedAt: string, finishedAt: string, feeds: RunReport["feeds"], issues: PipelineIssue[]): RunReport {
  const renderedFeeds = feeds.filter((feed) => feed.outputItems > 0).length;
  const featureStats = summarizeFeatureStats(feeds);

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
      featureStats,
    },
    issues,
  };
}

function summarizeFeatureStats(feeds: RunReport["feeds"]): FeatureRunStatsReport[] {
  const stats = new Map<string, FeatureRunStatsReport>();
  for (const feed of feeds) {
    for (const feature of feed.featureStats) {
      const existing = stats.get(feature.kind);
      if (existing) {
        existing.units += feature.units;
        existing.cacheHits += feature.cacheHits;
        existing.generated += feature.generated;
        existing.failed += feature.failed;
      }
      else {
        stats.set(feature.kind, { ...feature });
      }
    }
  }
  return [...stats.values()];
}

function writeSummary(report: RunReport): void {
  const featureSummary = report.totals.featureStats
    .map((feature) => `${feature.kind} generated ${feature.generated}/${feature.units}`)
    .join(", ");
  logNotice(`Feed build ${report.status}: feeds ${report.totals.renderedFeeds}/${report.totals.feeds}, items ${report.totals.outputItems}${featureSummary ? `, ${featureSummary}` : ""}`);
  for (const issue of report.issues) {
    console.log(`[${issue.severity}] ${issue.path ?? ""} ${issue.code}: ${issue.message}`);
  }
}

function renderStepSummary(report: RunReport): string {
  const totals = report.totals.featureStats
    .map((feature) => `| ${feature.kind} | ${feature.units} | ${feature.cacheHits} | ${feature.generated} | ${feature.failed} |`)
    .join("\n");

  const feeds = report.feeds
    .map((feed) => {
      const summary = feed.featureStats.map((feature) => `${feature.kind}: ${feature.generated}/${feature.units}`).join(", ");
      return `| ${feed.path} | ${feed.outputItems} | ${summary || "-"} |`;
    })
    .join("\n");

  return `## Feed Build ${report.status}

| Metric | Value |
|---|---:|
| Feeds | ${report.totals.renderedFeeds}/${report.totals.feeds} |
| Items | ${report.totals.outputItems} |

| Feature | Units | Cache hits | Generated | Failed |
|---|---:|---:|---:|---:|
${totals || "| - | 0 | 0 | 0 | 0 |"}

| Feed | Items | Features |
|---|---:|---|
${feeds || "| - | 0 | - |"}
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
