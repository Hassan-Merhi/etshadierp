import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const configPath = path.join(root, "config/company-scope-review.json");

describe("company-scope review registry", () => {
  it("contains unique, existing files with actionable review reasons", () => {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      reviews: Array<{ path: string; reason: string }>;
    };
    const paths = config.reviews.map((review) => review.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const review of config.reviews) {
      expect(fs.existsSync(path.join(root, review.path)), review.path).toBe(true);
      expect(review.reason.trim().length, review.path).toBeGreaterThan(40);
    }
  });
});