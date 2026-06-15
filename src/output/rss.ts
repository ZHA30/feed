import { XMLBuilder } from "fast-xml-parser";
import type { FeedConfig, NormalizedFeed, NormalizedItem, RenderedFeed } from "../types.js";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  textNodeName: "#text",
  format: false,
});

export function renderRss(feed: NormalizedFeed, config: FeedConfig, renderedItems: NormalizedItem[]): RenderedFeed {
  const channelItems = renderedItems.map((item) => renderItem(item));
  const document = {
    rss: {
      "@_version": "2.0",
      "@_xmlns:content": "http://purl.org/rss/1.0/modules/content/",
      channel: {
        title: feed.channel.title,
        link: feed.channel.link,
        description: feed.channel.description || feed.channel.title,
        language: feed.channel.language,
        lastBuildDate: new Date().toUTCString(),
        item: channelItems,
      },
    },
  };

  const outputPath = `dist/${config.pathKey}.xml`;
  return {
    path: config.path,
    pathKey: config.pathKey,
    feedId: config.feedId,
    outputPath,
    limit: config.limit,
    itemCount: renderedItems.length,
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(document)}`.replace(/&apos;|&#x27;/g, "'"),
    issues: [],
  };
}

function renderItem(item: NormalizedItem): Record<string, unknown> {
  const output: Record<string, unknown> = {
    title: item.title,
  };
  if (item.link) {
    output.link = item.link;
  }
  output.guid = item.guid || item.link || item._meta.itemKey;
  const date = rssDate(item.publishedAt || item.updatedAt || item.sortDate);
  if (date) {
    output.pubDate = date;
  }
  if (item.author) {
    output.author = item.author;
  }
  if (item.category.length > 0) {
    output.category = item.category;
  }
  if (item.enclosure?.url) {
    output.enclosure = {
      "@_url": item.enclosure.url,
      "@_type": item.enclosure.type,
      "@_length": item.enclosure.length,
    };
  }
  const description = item.description || item.summary;
  if (description) {
    output.description = { "#cdata": cdataSafe(description) };
  }
  const content = item["content:encoded"] || item.content;
  if (content) {
    output["content:encoded"] = { "#cdata": cdataSafe(content) };
  }
  return output;
}

function rssDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toUTCString() : "";
}

function cdataSafe(value: string): string {
  return value.replace(/\]\]>/g, "]]]]><![CDATA[>");
}
