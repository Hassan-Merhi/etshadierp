import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PRECISE_REPORT_FILES = [
  "server/routes/factory/bale-exports/daily-report.ts",
  "server/routes/stats/netProfitRentalSection.ts",
  "server/routes/stats/netProfitStockSection.ts",
  "server/routes/stats/statsDataRoutes.ts",
  "server/routes/stats/statsReportsRoutes.ts",
  "server/routes/stats/statsSalesRoutes.ts",
] as const;

describe("report precision ratchet", () => {
  for (const relativePath of PRECISE_REPORT_FILES) {
    it(`${relativePath} keeps report arithmetic out of binary-float helpers`, () => {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      expect(source).not.toMatch(/\bparseFloat\s*\(/);
      expect(source).not.toMatch(/Number\.EPSILON/);
      expect(source).not.toMatch(/Math\.round\s*\([^\n]*(?:100|1000|1000000)/);
    });
  }
});
