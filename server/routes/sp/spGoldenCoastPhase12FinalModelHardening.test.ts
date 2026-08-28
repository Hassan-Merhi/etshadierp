import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const phase6RouteSource = readFileSync(new URL("./spGoldenCoastPhase6PosSaleRoutes.ts", import.meta.url), "utf8");
const phase7RouteSource = readFileSync(new URL("./spGoldenCoastPhase7HadiTransferRoutes.ts", import.meta.url), "utf8");
const phase7ServiceSource = readFileSync(
  new URL("../../services/accounting/goldenCoastPhase7HadiTransfer.ts", import.meta.url),
  "utf8"
);
const phase10RouteSource = readFileSync(
  new URL("./spGoldenCoastPhase10SalesCashSettlementRoutes.ts", import.meta.url),
  "utf8"
);
const phase11RouteSource = readFileSync(new URL("./spGoldenCoastPhase11MonthlyCloseRoutes.ts", import.meta.url), "utf8");
const spIndexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("Golden Coast Phase 12 final accounting-model hardening", () => {
  it("forces every production Golden Coast sale through canonical GC Sales Cash", () => {
    expect(phase6RouteSource).toContain("GC_PHASE6_SALE_SIDE_OVERRIDE_RETIRED");
    expect(phase6RouteSource).toContain("saleSideAccount overrides are retired for Golden Coast");
    expect(phase6RouteSource).toContain('const saleSideAccount = { kind: "ledger" as const, id: accounts.gcSalesCashAccountId };');
  });

  it("keeps physical cash collection on the existing HADI cash-only intercompany path", () => {
    expect(phase7ServiceSource).toContain('operation !== "collect_via_hadi"');
    expect(phase7ServiceSource).toContain("gcSalesCashDebitBalanceUsd");
    expect(phase7RouteSource).toContain("resolveParentCompanyId");
    expect(phase7RouteSource).toContain("postBalancedVoucherTx");
  });

  it("keeps direct bank/cash settlement separate from POS sale recognition", () => {
    expect(phase10RouteSource).toContain("gcSalesCashDebitBalanceUsd");
    expect(phase10RouteSource).toContain("resolveSettlementAccount");
    expect(phase10RouteSource).toContain("postBalancedVoucherTx");
  });

  it("keeps the finalized-month freeze after the 50/50 monthly close", () => {
    expect(phase11RouteSource).toContain("Profit Pending Distribution");
    expect(phase11RouteSource).toContain("spProfitSplits");
  });

  it("keeps retired Phase 1 and Phase 5 mutation registrars off the production composition root", () => {
    expect(spIndexSource).not.toContain("registerSpGoldenCoastPhase1PostingRoutes(app)");
    expect(spIndexSource).not.toContain("registerSpGoldenCoastPhase5PosSaleRoutes(app)");
    expect(spIndexSource).toContain("registerSpGoldenCoastPhase6PosSaleRoutes(app)");
  });
});
