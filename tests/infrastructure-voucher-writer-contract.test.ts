import { describe, expect, it } from "vitest";

import { auditWriteEvidence } from "../scripts/audit-write-evidence.mjs";
import {
  assertPostingSourceIdentity,
  infrastructurePostingIdentity,
} from "../server/services/accounting/infrastructureVoucherIdentity";

const infrastructureWriters = [
  "server/routes/payroll/_payrollAccountingHelper.ts",
  "server/services/accounting/voucherPostingService.ts",
  "server/services/containers/offload-lifecycle/charge-vouchers.ts",
  "server/services/containers/offload-lifecycle/sp-journals.ts",
  "server/services/factory/post-offload-charge/apply.ts",
  "server/services/pos/createSaleVoucher.ts",
  "server/services/rental/rentalPaymentPostingService.ts",
  "server/storage/accounting/fiscal-periods.ts",
  "server/storage/accounting/vouchers.ts",
  "server/storage/containers-store/offload.ts",
  "server/storage/containers-store/purchase-orders.ts",
] as const;

describe("Phase 3 infrastructure voucher writer contract", () => {
  it("keeps every reviewed infrastructure writer behind a request-identity boundary", () => {
    const measured = auditWriteEvidence() as {
      voucherWritesWithoutRequestIdentity: string[];
      unapprovedDirectVoucherCreation: string[];
    };
    const identityBacklog = new Set(measured.voucherWritesWithoutRequestIdentity);
    const unapprovedCreators = new Set(measured.unapprovedDirectVoucherCreation);

    expect(infrastructureWriters.filter((file) => identityBacklog.has(file))).toEqual([]);
    expect(infrastructureWriters.filter((file) => unapprovedCreators.has(file))).toEqual([]);
  });

  it("builds deterministic infrastructure identities from stable business inputs", () => {
    const first = infrastructurePostingIdentity("pos-sale", "sale-42", "sales-voucher");
    const retry = infrastructurePostingIdentity("pos-sale", "sale-42", "sales-voucher");
    const differentSale = infrastructurePostingIdentity("pos-sale", "sale-43", "sales-voucher");

    expect(retry).toEqual(first);
    expect(differentSale).not.toEqual(first);
    expect(first).toEqual({
      sourceType: "pos-sale",
      sourceId: "sale-42:sales-voucher",
      idempotencyKey: "infra:pos-sale:sale-42:sales-voucher",
    });
  });

  it("rejects incomplete posting identities before persistence", () => {
    expect(() =>
      assertPostingSourceIdentity({ sourceType: "pos-sale", sourceId: "", idempotencyKey: "infra:pos-sale" })
    ).toThrow("sourceId is required");
  });
});
