import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Phase 8 deleted-voucher accounting consistency", () => {
  it("excludes deleted vouchers from Accounts balances", () => {
    const source = read("server/routes/accountRoutes.ts");
    expect(source).toContain("isNull(vouchers.deletedAt)");
    expect(source).toContain("companyLedgerConditions");
    expect(source).toContain("eq(vouchers.companyId, companyId)");
  });

  it("excludes deleted vouchers from Net Position", () => {
    const source = read("server/routes/stats/statsNetPositionRoutes.ts");
    expect(source).toContain("v.deleted_at IS NULL");
    expect(source).toContain("COALESCE(ve.base_debit_amount,  ve.debit_amount)");
    expect(source).toContain("COALESCE(ve.base_credit_amount, ve.credit_amount)");
  });

  it("excludes deleted vouchers from Daybook", () => {
    const source = read("server/routes/daybookPaginationRoutes.ts");
    expect(source).toContain('"v.deleted_at IS NULL"');
    expect(source).toContain('"v.company_id = $1"');
  });

  it("soft-deletes active payment and receipt vouchers only after reversing denormalized employee and property effects", () => {
    const source = read("server/routes/vouchers/centralPaymentReceiptDeleteRoute.ts");
    expect(source).toContain('direction: "reverse"');
    expect(source).toContain("paid_amount = GREATEST(0, paid_amount -");
    expect(source).toContain("set({ deletedAt: new Date() })");
    expect(source).toContain("eq(vouchers.companyId, companyId)");
  });
});
