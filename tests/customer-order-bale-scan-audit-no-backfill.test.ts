import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "server/customerOrderBaleScanAuditBridge.mjs"), "utf8");

describe("customer order bale scan audit legacy safety", () => {
  it("leaves pre-feature scan timestamps unknown", () => {
    expect(source).not.toMatch(/UPDATE\s+public\.customer_order_bales\s+SET\s+scanned_at/i);
    expect(source).toContain("A legacy archived row with no timestamp deliberately stays NULL");
  });
});
