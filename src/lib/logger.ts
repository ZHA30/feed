import { appendFile } from "node:fs/promises";

export function logGroup(title: string): void {
  console.log(`::group::${title}`);
}

export function logGroupEnd(): void {
  console.log("::endgroup::");
}

export function logNotice(message: string): void {
  console.log(`::notice::${message}`);
}

export function logKeyValue(key: string, value: string | number): void {
  console.log(`${key.padEnd(16)} ${value}`);
}

export async function appendStepSummary(markdown: string): Promise<void> {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {
    return;
  }
  await appendFile(path, `${markdown.trimEnd()}\n`);
}
