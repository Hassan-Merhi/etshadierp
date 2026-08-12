import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "config/route-manifest.json"), "utf8")) as {
  routes: string[];
};

describe("waste dispatch route registration", () => {
  it("keeps the optimized waste dispatch read routes registered", () => {
    const expected = [
      "GET /api/factory/waste-dispatch/summary",
      "GET /api/factory/waste-dispatch/group-bales/:productId",
      "GET /api/factory/waste-dispatch/scan",
    ];
    for (const prefix of expected) {
      expect(manifest.routes.some((route) => route.startsWith(prefix))).toBe(true);
    }
  });
});
