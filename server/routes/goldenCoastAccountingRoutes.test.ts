import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(new URL("./goldenCoastAccountingRoutes.ts", import.meta.url), "utf8");
const permissionBoundarySource = readFileSync(new URL("./core/permissionBoundaryRoutes.ts", import.meta.url), "utf8");

describe("Golden Coast Phase 1 route surface", () => {
  it("registers the four protected Phase 1 endpoints", () => {
    expect(routeSource).toContain('"/api/golden-coast/accounting/phase1/setup-accounts"');
    expect(routeSource).toContain('"/api/golden-coast/accounting/phase1/accounts"');
    expect(routeSource).toContain('"/api/golden-coast/accounting/phase1/preview"');
    expect(routeSource).toContain('"/api/golden-coast/accounting/phase1/post"');
  });

  it("enforces accounting module and voucher-create permissions on live posting", () => {
    expect(permissionBoundarySource).toContain('"/api/golden-coast/accounting"');
    expect(permissionBoundarySource).toContain(
      'app.post("/api/golden-coast/accounting/phase1/post", requireActionAccess("act_create_voucher"));',
    );
  });

  it("reactivates inactive required ledgers during setup", () => {
    expect(routeSource).toContain(".set({ active: true })");
    expect(routeSource).toContain("eq(ledgerAccounts.active, false)");
  });
});
