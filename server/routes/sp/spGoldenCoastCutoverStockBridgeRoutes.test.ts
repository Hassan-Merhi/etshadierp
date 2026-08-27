import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridgeSource = readFileSync(new URL("./spGoldenCoastCutoverStockBridgeRoutes.ts", import.meta.url), "utf8");
const dateGuardSource = readFileSync(new URL("./spGoldenCoastCutoverDateGuard.ts", import.meta.url), "utf8");
const spIndexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const legacyGuardSource = readFileSync(new URL("../goldenCoastLegacyPostingGuard.ts", import.meta.url), "utf8");
const applicationRoutesSource = readFileSync(new URL("../applicationRoutes.ts", import.meta.url), "utf8");

describe("Golden Coast cutover hardening and opening FIFO bridge", () => {
  it("registers the bridge inside authenticated Supplier Partner routes", () => {
    expect(bridgeSource).toContain('"/api/sp/golden-coast/cutover-stock-bridge/status"');
    expect(bridgeSource).toContain('"/api/sp/golden-coast/cutover-stock-bridge"');
    expect(bridgeSource).toContain('requireRole("Admin")');
    expect(bridgeSource).toContain("requireSpCompany(req, res)");
    expect(spIndexSource).toContain("registerSpGoldenCoastCutoverStockBridgeRoutes(app);");
  });

  it("mirrors ERP inventory into SP FIFO without mutating ERP inventory or posting another opening voucher", () => {
    expect(bridgeSource).toContain(".from(inventory)");
    expect(bridgeSource).toContain("eq(inventory.companyId, companyId)");
    expect(bridgeSource).toContain("tx.insert(spStockMovements)");
    expect(bridgeSource).not.toContain("adjustSpInventoryAtomic");
    expect(bridgeSource).not.toContain("tx.insert(vouchers)");
    expect(bridgeSource).not.toContain("tx.insert(voucherEntries)");
  });

  it("requires the Phase 3 Stock in Hand opening and reconciles FIFO value before insertion", () => {
    expect(bridgeSource).toContain("goldenCoastPhase3VoucherNumber(companyId)");
    expect(bridgeSource).toContain('eq(ledgerAccounts.subType, "sp_stock")');
    expect(bridgeSource).toContain("assertGoldenCoastStockValueReconciles");
    expect(bridgeSource).toContain("stockAccounts.length !== 1");
  });

  it("is replay-safe after legitimate FIFO consumption and serializes concurrent creation", () => {
    expect(bridgeSource).toContain("planFromExistingLots(existingLots)");
    expect(bridgeSource).toContain("qtyRemaining.gt(qtyIn)");
    expect(bridgeSource).toContain("pg_advisory_xact_lock");
    expect(bridgeSource).toContain("if (state.bridged) return { ...state, replayed: true }");
  });

  it("marks a reconciled zero-stock opening complete without manufacturing a placeholder lot", () => {
    expect(bridgeSource).toContain("zeroStockOpening");
    expect(bridgeSource).toContain("plan.lots.length === 0");
    expect(bridgeSource).toContain("bridged: zeroStockOpening");
  });

  it("activates the pre-cutover read-only guard only after this company posts its Golden Coast cutover", () => {
    expect(dateGuardSource).toContain("hasPostedGoldenCoastCutover(companyId)");
    expect(dateGuardSource).toContain("goldenCoastPhase3VoucherNumber(companyId)");
    expect(dateGuardSource).toContain("GC_PRE_CUTOVER_READ_ONLY");
    expect(dateGuardSource).toContain("value < GOLDEN_COAST_PHASE3_CUTOVER_DATE");
    expect(spIndexSource).toContain("registerSpGoldenCoastCutoverDateGuard(app);");
  });

  it("retires manual SP opening stock after cutover so opening inventory cannot be doubled", () => {
    expect(dateGuardSource).toContain('req.path === "/opening-stock"');
    expect(dateGuardSource).toContain("GC_LEGACY_OPENING_STOCK_RETIRED");
  });

  it("makes the superseded Golden Coast Phase 1 posting mutation unreachable", () => {
    expect(legacyGuardSource).toContain('"/api/golden-coast/accounting/phase1/post"');
    expect(legacyGuardSource).toContain("GC_PHASE1_POSTING_RETIRED");
    expect(legacyGuardSource).toContain("res.status(410)");
    expect(applicationRoutesSource.indexOf("registerGoldenCoastLegacyPostingGuard(app);")).toBeLessThan(
      applicationRoutesSource.indexOf("registerGoldenCoastAccountingRoutes(app);")
    );
  });
});
