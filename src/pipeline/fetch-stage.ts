import { FetchHttpError, fetchText } from "../feed/fetch.js";
import { parseFeedXml, windowFeed } from "../feed/normalize.js";
import { redactUrl } from "../lib/url.js";
import type { FeedConfig, FetchedFeedResult, PipelineIssue } from "../types.js";

const FETCH_TIMEOUT_SECONDS = 30;
const MAX_FETCH_RETRIES = 2;
const RETRY_DELAYS_MS = [5_000, 15_000] as const;

export async function runFetchStage(feeds: FeedConfig[]): Promise<FetchedFeedResult[]> {
  const results = new Map<string, FetchedFeedResult>();
  const retryQueue: FetchRetryTask[] = [];

  for (const feed of feeds) {
    const result = await fetchFeed(feed);
    results.set(feed.path, result);
    if (result.kind === "failure" && shouldRetryFetch(result.error)) {
      retryQueue.push({
        feed,
        attempt: 1,
        firstStartedAt: result.startedAt,
        retryIssues: [makeRetryIssue(feed, result.error, 1)],
      });
    }
  }

  while (retryQueue.length > 0) {
    const task = retryQueue.shift()!;
    await delay(RETRY_DELAYS_MS[task.attempt - 1] ?? 0);

    const result = await fetchFeed(task.feed, task.firstStartedAt);
    if (result.kind === "success") {
      result.issues.unshift(...task.retryIssues);
      results.set(task.feed.path, result);
      continue;
    }

    if (task.attempt < MAX_FETCH_RETRIES && shouldRetryFetch(result.error)) {
      retryQueue.push({
        feed: task.feed,
        attempt: task.attempt + 1,
        firstStartedAt: task.firstStartedAt,
        retryIssues: [...task.retryIssues, makeRetryIssue(task.feed, result.error, task.attempt + 1)],
      });
      continue;
    }

    result.issues.unshift(...task.retryIssues);
    results.set(task.feed.path, result);
  }

  return feeds.map((feed) => results.get(feed.path)).filter((result): result is FetchedFeedResult => Boolean(result));
}

export function describeFetchSource(feed: FeedConfig): string {
  return redactUrl(feed.url);
}

type FetchRetryTask = {
  feed: FeedConfig;
  attempt: number;
  firstStartedAt: number;
  retryIssues: PipelineIssue[];
};

type FetchFeedResult = FetchedFeedResult & {
  error?: unknown;
};

async function fetchFeed(feed: FeedConfig, startedAt = Date.now()): Promise<FetchFeedResult> {
  try {
    const fetched = await fetchText(feed.url, FETCH_TIMEOUT_SECONDS);
    const normalized = windowFeed(parseFeedXml(fetched.body, feed, fetched.finalUrl));
    return {
      kind: "success",
      feed,
      normalized,
      issues: [...normalized.issues],
      startedAt,
      finishedAt: Date.now(),
    };
  } catch (error) {
    return {
      kind: "failure",
      feed,
      issues: [makeFeedFailedIssue(feed, error)],
      startedAt,
      finishedAt: Date.now(),
      error,
    };
  }
}

function makeFeedFailedIssue(feed: FeedConfig, error: unknown): PipelineIssue {
  return {
    stage: "fetch",
    severity: "error",
    code: "feed_failed",
    message: errorToMessage(error),
    path: feed.path,
  };
}

function makeRetryIssue(feed: FeedConfig, error: unknown, attempt: number): PipelineIssue {
  return {
    stage: "fetch",
    severity: "warning",
    code: "fetch_retry",
    message: `retry ${attempt}/${MAX_FETCH_RETRIES} after ${errorToMessage(error)}`,
    path: feed.path,
  };
}

function shouldRetryFetch(error: unknown): boolean {
  if (error instanceof FetchHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return "feed failed";
}
