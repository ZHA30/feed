import { join } from "node:path";

const DEFAULT_STATE_DIR = "state";

export function getStateDir(): string {
  return process.env.TRANSFEED_STATE_DIR?.trim() || DEFAULT_STATE_DIR;
}

export function stateFilePath(path: string): string {
  return join(getStateDir(), path);
}
