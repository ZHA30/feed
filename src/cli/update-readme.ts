import { loadConfig } from "../config/load.js";
import { writeTextFile } from "../lib/files.js";
import { renderReadme } from "../state/readme.js";
import { stateFilePath } from "../state/paths.js";

const pageUrl = process.env.TRANSFEED_PAGE_URL;

if (!pageUrl) {
  throw new Error("TRANSFEED_PAGE_URL is required");
}

const feeds = await loadConfig();
await writeTextFile(stateFilePath("README.md"), renderReadme(feeds, pageUrl));
