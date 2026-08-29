import { existsSync } from "fs";

/**
 * Puppeteer 25+ may return a Promise from executablePath(). Node's fs.existsSync
 * accepts only path-like values and emits DEP0187 when given that Promise.
 *
 * Keep synchronous scraper availability checks safe: only touch the filesystem
 * when the candidate is already a concrete string path.
 */
export function existingStringPath(candidate: unknown): string | null {
  return typeof candidate === "string" && candidate.length > 0 && existsSync(candidate) ? candidate : null;
}
