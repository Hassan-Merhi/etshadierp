import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("container loading scan audit metadata", () => {
  it("renders scanner identity and scan date metadata under each detailed bale row", () => {
    const panel = read("client/src/pages/factory/factorycontainerloadingscan/ScannedBalesPanel.tsx");

    expect(panel).toContain("includeScanAudit=1");
    expect(panel).toContain("Scanned by ${scanAudit.scannedBy}");
    expect(panel).toContain("text-bale-scan-audit-${bale.id}");
  });

  it("keeps the audit lookup on the existing bale-removals route", () => {
    const routes = read("server/routes/factory/customer-orders/bale-scanning/exchange.ts");

    expect(routes).toContain('req.query.includeScanAudit === "1"');
    expect(routes).toContain('scanned_by AS "scannedBy"');
    expect(routes).toContain('scanned_at AS "scannedAt"');
  });

  it("installs the persistent scan timestamp bridge at startup", () => {
    const preload = read("server/fxFetchTimeoutBridge.mjs");
    const bridge = read("server/customerOrderBaleScanAuditBridge.mjs");

    expect(preload).toContain('import "./customerOrderBaleScanAuditBridge.mjs"');
    expect(bridge).toContain("customer_order_bales_set_scanned_at");
    expect(bridge).toContain("customer_order_bales_history_copy_scanned_at");
  });
});
