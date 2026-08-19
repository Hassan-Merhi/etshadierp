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
  it("removes all reviewed infrastructure writers from the no-identity backlog", () => {
    const measured = auditWriteEvidence() as { voucherWritesWithoutRequestIdentity: string[] };
    const backlog = new Set(measured.voucherWritesWithoutRequestIdentity);

    expect(infrastructureWriters.filter((file) => backlog.has(file))).toEqual([]);
  });

  it("builds deterministic identity from stable business identifiers", () => {
    const first = infrastructurePostingIdentity("pos-sale", "client-42", "sales-voucher");
    const retry = infrastructurePostingIdentity("pos-sale", "client-42", "sales-voucher");
    const otherPhase = infrastructurePostingIdentity("pos-sale", "client-42", "reversal");

    expect(first).toEqual({
      sourceType: "pos-sale",
      sourceId: "client-42:sales-voucher",
      idempotencyKey: "infra:pos-sale:client-42:sales-voucher",
    });
    expect(retry).toEqual(first);
    expect(otherPhase.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("normalizes numeric source ids without changing retry identity", () => {
    expect(infrastructurePostingIdentity("purchase-order", 123, "offload")).toEqual(
      infrastructurePostingIdentity("purchase-order", "123", "offload")
    );
  });

  it("fails closed when any posting-source identity field is empty", () => {
    expect(() => assertPostingSourceIdentity({ sourceType: "", sourceId: "1", idempotencyKey: "key" })).toThrow(
      "sourceType is required"
    );
    expect(() => assertPostingSourceIdentity({ sourceType: "sale", sourceId: "", idempotencyKey: "key" })).toThrow(
      "sourceId is required"
    );
    expect(() => assertPostingSourceIdentity({ sourceType: "sale", sourceId: "1", idempotencyKey: "" })).toThrow(
      "idempotencyKey is required"
    );
  });
});
