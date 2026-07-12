import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "server/routes/location/commonInventoryPerformanceRoutes.ts"),
  "utf8",
);

describe("Phase 7B common inventory performance routes", () => {
  it("keeps legacy no-page requests on the established handlers", () => {
    expect(source.match(/if \(!req\.query\.page\) return next\(\);/g)).toHaveLength(2);
  });

  it("runs count and page-data queries concurrently", () => {
    expect(source.match(/await Promise\.all\(/g)).toHaveLength(2);
  });

  it("avoids the unused stock-groups join in the inventory count query", () => {
    const countSection = source.slice(source.indexOf("const countQuery"), source.indexOf("const dataQuery"));
    expect(countSection).not.toContain("stockGroups");
  });

  it("preserves the existing pagination ceiling", () => {
    expect(source).toContain("Math.min(500");
  });
});
