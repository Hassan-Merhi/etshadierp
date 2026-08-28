import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const bridge = fs.readFileSync(path.join(process.cwd(), "server/customerOrderBaleScanAuditBridge.mjs"), "utf8");

describe("customer order bale scan audit bridge", () => {
  it("does not backfill historical rows with an invented timestamp", () => {
    expect(bridge).toContain("ADD COLUMN scanned_at TIMESTAMPTZ");
    expect(bridge).not.toContain("UPDATE customer_order_bales SET scanned_at");
  });

  it("uses server time for new scans and preserves archived timestamps on restore", () => {
    expect(bridge).toContain("NEW.scanned_at := CURRENT_TIMESTAMP");
    expect(bridge).toContain("FROM public.customer_order_bales_history h");
    expect(bridge).toContain("FROM public.customer_order_bales cob");
  });
});
