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
      'app.use("/api/golden-coast/accounting/phase1/post", requireActionAccess("act_create_voucher"));'
    );
  });

  it("rate-limits reads and mutations and caps request size", () => {
    expect(routeSource).toContain("privilegedReadRateLimit");
    expect(routeSource).toContain("privilegedMutationRateLimit");
    expect(routeSource).toContain("phase1RequestBudget");
  });

  it("restores inactive or soft-deleted required ledgers during setup", () => {
    expect(routeSource).toContain(".set({ active: true, deletedAt: null })");
    expect(routeSource).toContain("GOLDEN_COAST_PHASE1_LEDGER_SUBTYPES");
  });

  it("validates cash-side posting roles before central persistence", () => {
    expect(routeSource).toContain("getGoldenCoastPhase1CashRoleRequirements");
    expect(routeSource).toContain("validatePhase1CashRolesTx");
    expect(routeSource).toContain('["Cash", "Bank"]');
  });
});
