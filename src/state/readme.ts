import type { FeedConfig } from "../types.js";

export function renderReadme(feeds: FeedConfig[], pageUrl: string): string {
  const baseUrl = normalizeBaseUrl(pageUrl);
  const rows = feeds
    .map((feed) => {
      const href = `${baseUrl}${encodePath(feed.pathKey)}.xml`;
      return `| ${feed.path} | ${feed.targetLanguage} | ${feed.limit} | [${href}](${href}) |`;
    })
    .join("\n");

  return `# Transfeed State

This branch stores Transfeed configuration and runtime state.

## Subscriptions

| Path | Target | Limit | Feed |
|---|---:|---:|---|
${rows}

## Files

- \`config/feeds.yaml\`: feed configuration.
- \`cache/manifest.json\`: cache schema marker.
- \`cache/units.json\`: translation unit cache.
- \`reports/latest.json\`: latest build report.
`;
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("page URL is required to render state README");
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function encodePath(pathKey: string): string {
  return pathKey.split("/").map(encodeURIComponent).join("/");
}
