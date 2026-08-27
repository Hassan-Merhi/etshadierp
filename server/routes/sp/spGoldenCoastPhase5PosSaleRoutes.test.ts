import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(new URL("./spGoldenCoastPhase5PosSaleRoutes.ts", import.meta.url), "utf8");
const spIndexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const accessControlSource = readFileSync(new URL("./spAccessControl.ts", import.meta.url), "utf8");
const phase4RouteSource = readFileSync(new URL("./spGoldenCoastPhase4CutoverFifoRoutes.ts", import.meta.url), "utf8");
const legacySalesSource = readFileSync(new URL("./spSalesRoutes.ts", import.meta.url), "utf8");
const voucherPathPolicySource = readFileSync(
  new URL("../../../shared/voucherPathIdentityPolicy.ts", import.meta.url),
  "utf8"
);
const saleServiceSource = readFileSync(
  new URL("../../services/accounting/goldenCoastPhase5PosSale.ts", import.meta.url),
  "utf8"
);

describe("Golden Coast Phase 5 POS sale route surface", () => {
  it("registers after the Phase 4 cutover guard and before the legacy sale routes", () => {
    const phase4Index = spIndexSource.indexOf("registerSpGoldenCoastPhase4CutoverFifoRoutes(app);");
    const phase5Index = spIndexSource.indexOf("registerSpGoldenCoastPhase5PosSaleRoutes(app);");
    const legacySalesIndex = spIndexSource.indexOf("registerSpSalesRoutes(app);");

    expect(phase5Index).toBeGreaterThan(-1);
    expect(phase5Index).toBeGreaterThan(phase4Index);
    expect(phase5Index).toBeLessThan(legacySalesIndex);
  });

  it("keeps the mutation authenticated, rate limited and request-budgeted", () => {
    expect(routeSource).toContain(
      'app.post(\n    "/api/sp/golden-coast/phase5/pos-sale",\n    privilegedMutationRateLimit'
    );
    expect(routeSource).toContain("phase5RequestBudget");
    expect(routeSource).toContain("requireAuth");
    expect(routeSource).toContain("privilegedReadRateLimit");
  });

  it("is classified as an sp_sales_create write by the Supplier Partner access-control middleware", () => {
    // `/golden-coast/phase5/pos-sale` contains "sale" and is a POST, so the
    // shared classifier maps it to the existing Supplier Partner sale
    // permission instead of falling through to read-only `sp_view`.
    expect(accessControlSource).toContain('if ((path.includes("sales") || path.includes("sale")) && method !== "GET")');
    expect(accessControlSource).toContain('return "sp_sales_create";');
    expect(spIndexSource.indexOf("registerSpAccessControl(app);")).toBeLessThan(
      spIndexSource.indexOf("registerSpGoldenCoastPhase5PosSaleRoutes(app);")
    );
  });

  it("scopes every read and write to the selected Golden Coast company", () => {
    expect(routeSource).toContain("requireSpCompany");
    expect(routeSource).toContain("isGoldenCoastCompany");
    expect(routeSource).toContain("GC_PHASE5_NOT_CONFIGURED");
    expect(routeSource).toContain("eq(spStockMovements.companyId, companyId)");
    expect(routeSource).toContain("eq(locations.companyId, companyId)");
    expect(routeSource).toContain("eq(ledgerAccounts.companyId, companyId)");
    expect(routeSource).toContain("eq(bankAccounts.companyId, companyId)");
  });

  it("reuses the Phase 4 Golden Coast guard rather than re-deriving it", () => {
    expect(phase4RouteSource).toContain("export async function isGoldenCoastCompany");
    expect(routeSource).toContain('from "./spGoldenCoastPhase4CutoverFifoRoutes"');
    expect(routeSource).toContain("GOLDEN_COAST_CUTOVER_FIFO_SOURCE");
  });

  it("posts through the central posting engine instead of a parallel voucher writer", () => {
    expect(routeSource).toContain("postBalancedVoucherTx");
    expect(routeSource).toContain("createDatabasePostingDependencies()");
    expect(routeSource).not.toContain("tx.insert(vouchers)");
    expect(routeSource).not.toContain("tx.insert(voucherEntries)");
  });

  it("consumes FIFO and posts accounting inside one transaction with a per-request advisory lock", () => {
    expect(routeSource).toContain("db.transaction(async (tx) =>");
    expect(routeSource).toContain("pg_advisory_xact_lock");
    expect(routeSource).toContain("golden-coast-phase5-sale:${selectedCompany}:${sale.clientRequestId}");
    expect(routeSource).toContain('.for("update")');
    expect(routeSource).toContain("adjustSpInventoryAtomic");
    expect(routeSource).toContain("UPDATE sp_stock_movements");
  });

  it("guards the FIFO decrement so a concurrent sale cannot oversell a lot", () => {
    expect(routeSource).toContain("CAST(qty_remaining AS numeric) >= CAST(${allocation.qty} AS numeric)");
    expect(routeSource).toContain("GC_PHASE5_FIFO_CONFLICT");
  });

  it("inherits the repository-wide voucher-path request identity boundary", () => {
    // Every `/api/sp/` write is claimed by the Phase 5→6 voucher-path boundary,
    // which keys on `clientRequestId`. This route therefore requires the same
    // identifier the boundary reads, so transport retries replay rather than
    // re-post, and a reused id with different data conflicts.
    expect(voucherPathPolicySource).toContain('path.startsWith("/api/sp/")');
    expect(saleServiceSource).toContain("clientRequestId");
    expect(routeSource).toContain("sale.clientRequestId");
  });

  it("fails closed on inconsistent idempotency state instead of double posting", () => {
    expect(routeSource).toContain("GC_PHASE5_IDEMPOTENCY_INCONSISTENT");
    expect(routeSource).toContain("findReplayedSale");
    expect(routeSource).toContain("accountingPostingRequests");
  });

  it("requires the Phase 3/Phase 4 cutover state before any Golden Coast sale posts", () => {
    expect(routeSource).toContain("assertPhase4BridgePosted");
    expect(routeSource).toContain("GC_PHASE5_NOT_READY");
    expect(routeSource).toContain("GOLDEN_COAST_CUTOVER_DATE");
  });

  it("does not reactivate or shadow the retired legacy Supplier Partner sale path", () => {
    expect(routeSource).not.toContain('app.post("/api/sp/sales"');
    expect(routeSource).not.toContain("spSales");
    expect(routeSource).not.toContain("spSaleLines");
    expect(routeSource).not.toContain("goldenCoastPhase1Posting");
    expect(routeSource).not.toContain("buildGoldenCoastPhase1PostingBatch");
    // The legacy handler itself is untouched, so non-Golden-Coast Supplier
    // Partner companies keep their existing payable-only sale behaviour.
    expect(legacySalesSource).toContain('app.post("/api/sp/sales"');
    expect(legacySalesSource).toContain("sp_payable");
  });

  it("does not re-run or mutate the Phase 4 opening FIFO bridge", () => {
    expect(routeSource).not.toContain("buildGoldenCoastCutoverFifoPlan");
    expect(routeSource).not.toContain("tx.insert(spStockMovements)");
  });
});
