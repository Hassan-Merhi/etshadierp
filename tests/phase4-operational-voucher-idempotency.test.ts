import { afterEach, describe, expect, it } from "vitest";

import {
  attachAccountingRequestIdentity,
  isProtectedAccountingRequest,
  releaseAccountingRequestIdentity,
} from "../client/src/lib/accountingRequestIdentity";
import voucherReview from "../config/voucher-write-evidence-review.json";
import writeEvidenceBaseline from "../config/write-evidence-baseline.json";
import { auditWriteEvidence } from "../scripts/audit-write-evidence.mjs";
import {
  isPhase4OperationalVoucherRequest,
  resolvePhase4OperationalVoucherCompanyId,
} from "../server/services/accounting/operationalVoucherRequestBoundary";

const PHASE4_WRITERS = [
  "server/routes/employees/salaryAdvanceRoutes.ts",
  "server/routes/erp-payroll/bonuses.ts",
  "server/routes/erp-payroll/bulk-adjustments.ts",
  "server/routes/erp-payroll/employee-deposits.ts",
  "server/routes/erp-payroll/runs.ts",
  "server/routes/erp-payroll/withdrawals.ts",
  "server/routes/erp-payroll/worker-payments.ts",
  "server/routes/factory/employee-pos/employee-crud/bulk-payroll.ts",
  "server/routes/factory/employee-pos/employee-crud/bulk-withdraw.ts",
  "server/routes/factory/employee-pos/employee-crud/cash.ts",
  "server/routes/factory/employee-pos/employeeAdvancesBonusRoutes.ts",
  "server/routes/factory/employee-pos/pos-financial/sale-write.ts",
  "server/routes/factory/suppliers/crud/payments.ts",
  "server/routes/payroll/advance-accounting/bulk-repay.ts",
  "server/routes/payroll/advance-accounting/cash.ts",
  "server/routes/payroll/advance-accounting/repay-by-month.ts",
  "server/routes/payroll/advance-accounting/repayment-audit.ts",
  "server/routes/payroll/advance-accounting/repayments.ts",
  "server/routes/payroll/core/mark-paid.ts",
  "server/routes/vouchers/voucherCreateRoutes.ts",
  "server/routes/vouchers/voucherJournalRoutes.ts",
  "server/routes/vouchers/voucherPaymentRoutes.ts",
] as const;

type RouteCase = {
  method: "POST" | "PATCH";
  url: string;
  data: Record<string, unknown>;
};

const PHASE4_VOUCHER_CREATION_ROUTES: RouteCase[] = [
  { method: "POST", url: "/api/vouchers", data: { voucherType: "Journal" } },
  {
    method: "POST",
    url: "/api/vouchers/with-entries",
    data: { voucher: { optional: false }, entries: [{ debitAmount: "1", creditAmount: "1" }] },
  },
  { method: "POST", url: "/api/vouchers/journal", data: { optional: false } },
  { method: "POST", url: "/api/vouchers/journal-entries", data: { optional: false } },
  { method: "POST", url: "/api/vouchers/payment-receipt", data: { voucherType: "Payment", optional: false } },
  { method: "POST", url: "/api/salary-advances", data: { amount: "10.00" } },
  { method: "POST", url: "/api/payroll/bonus-employee", data: { amount: "10.00" } },
  { method: "POST", url: "/api/payroll/bulk-bonus-employees", data: { amount: "10.00" } },
  { method: "POST", url: "/api/payroll/bulk-withdraw-employees", data: { amount: "10.00" } },
  { method: "POST", url: "/api/payroll/deposit-employee", data: { amount: "10.00" } },
  { method: "POST", url: "/api/payroll/bulk-deposit-employees", data: { amount: "10.00" } },
  { method: "PATCH", url: "/api/payroll/runs/42", data: { action: "pay", paymentAccountId: 9 } },
  { method: "POST", url: "/api/payroll/withdraw-employee", data: { amount: "10.00" } },
  { method: "POST", url: "/api/payroll/pay-worker", data: { amount: "10.00" } },
  { method: "POST", url: "/api/payroll/bulk-pay-workers", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/employees/bulk-payroll", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/employees/bulk-withdraw", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/employees/42/deposit", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/employees/42/withdraw", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/employee-bonuses", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/worker-bonuses/42/pay", data: { cashAccountId: 9 } },
  { method: "POST", url: "/api/factory/pos/sale", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/supplier-payments", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/workers/42/bulk-repay-advances", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/advances/cash-adjustment", data: { amount: "10.00" } },
  { method: "POST", url: "/api/factory/advances/repay-by-month", data: { month: "2026-08" } },
  { method: "POST", url: "/api/factory/advances/post-repayment-vouchers", data: { cashAccountId: 9 } },
  { method: "POST", url: "/api/factory/advances/42/repayments", data: { amount: "10.00" } },
  { method: "PATCH", url: "/api/factory/payrolls/42/mark-paid", data: { cashAccountId: 9 } },
  { method: "PATCH", url: "/api/factory/payrolls/42/fix-accounting", data: { cashAccountId: 9 } },
  { method: "POST", url: "/api/factory/payrolls/mark-paid-bulk", data: { cashAccountId: 9 } },
];

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("Phase 4 operational voucher retry boundary", () => {
  it("pins exactly the 22 reviewed high-risk writers as completed", () => {
    expect(voucherReview.summary.phase4OperationalCompleted).toBe(22);
    expect(voucherReview.summary.operationalWithoutRequestIdentity).toBe(22);
    expect(voucherReview.unreviewed).toEqual([]);
    expect(voucherReview.completed["phase-4-operational-writers"].files).toEqual(PHASE4_WRITERS);
    expect(voucherReview.reviewed["operational-without-request-identity"].files).toHaveLength(22);
  });

  it("re-pins the measured voucher identity backlog from 70 to 48", () => {
    const voucherBaseline = writeEvidenceBaseline.voucherWritesWithoutRequestIdentity;
    const measured = auditWriteEvidence();

    expect(voucherBaseline.ceiling).toBe(48);
    expect(voucherBaseline.files).toHaveLength(48);
    expect(voucherBaseline.reviewSummary.activeReviewed).toBe(48);
    expect(voucherBaseline.reviewSummary.phase4OperationalCompleted).toBe(22);
    expect(measured.voucherWritesWithoutRequestIdentity.sort()).toEqual([...voucherBaseline.files].sort());

    const remaining = new Set(voucherBaseline.files);
    for (const file of PHASE4_WRITERS) {
      expect(remaining.has(file)).toBe(false);
    }
  });

  it("protects every voucher-creation route in the 22 completed files on the server", () => {
    expect(PHASE4_VOUCHER_CREATION_ROUTES).toHaveLength(31);
    for (const route of PHASE4_VOUCHER_CREATION_ROUTES) {
      expect(
        isPhase4OperationalVoucherRequest(route.method, route.url, route.data),
        `${route.method} ${route.url}`
      ).toBe(true);
    }
  });

  it("protects the same exact route matrix at the browser request boundary", () => {
    for (const route of PHASE4_VOUCHER_CREATION_ROUTES) {
      expect(
        isProtectedAccountingRequest(route.method, route.url, route.data),
        `${route.method} ${route.url}`
      ).toBe(true);
    }
  });

  it("does not widen Phase 4 onto non-voucher operations in the same route files", () => {
    const nonVoucherCases = [
      { method: "GET", url: "/api/vouchers", data: {} },
      { method: "POST", url: "/api/credit-notes", data: {} },
      { method: "POST", url: "/api/payroll/auto-calculate-bonuses", data: {} },
      { method: "POST", url: "/api/payroll/runs", data: {} },
      { method: "PATCH", url: "/api/payroll/runs/42", data: { action: "update" } },
      { method: "POST", url: "/api/factory/employee-advances", data: {} },
      { method: "PUT", url: "/api/factory/pos/sales/42", data: {} },
      { method: "PATCH", url: "/api/vouchers/42/journal", data: {} },
    ] as const;

    for (const route of nonVoucherCases) {
      expect(
        isPhase4OperationalVoucherRequest(route.method, route.url, route.data),
        `${route.method} ${route.url}`
      ).toBe(false);
      expect(isProtectedAccountingRequest(route.method, route.url, route.data), `${route.method} ${route.url}`).toBe(
        false
      );
    }
  });

  it("uses validated server-owned session context before route-local requireAuth hydrates req.user", () => {
    const erpRequest = {
      path: "/api/payroll/pay-worker",
      session: { userId: 7, currentCompanyId: 12 },
    } as unknown as Parameters<typeof resolvePhase4OperationalVoucherCompanyId>[0];
    expect(resolvePhase4OperationalVoucherCompanyId(erpRequest)).toBe(12);

    const factoryRequest = {
      path: "/api/factory/payrolls/mark-paid-bulk",
      session: { userId: 7, currentCompanyId: 12, factoryCompanyId: 34 },
    } as unknown as Parameters<typeof resolvePhase4OperationalVoucherCompanyId>[0];
    expect(resolvePhase4OperationalVoucherCompanyId(factoryRequest)).toBe(34);

    const unauthenticatedRequest = {
      path: "/api/payroll/pay-worker",
      session: { currentCompanyId: 12 },
    } as unknown as Parameters<typeof resolvePhase4OperationalVoucherCompanyId>[0];
    expect(resolvePhase4OperationalVoucherCompanyId(unauthenticatedRequest)).toBeNull();
  });

  it("persists and reuses the first browser identity until a definite outcome releases it", () => {
    const values = new Map<string, string>();
    const localStorage: Storage = {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key) {
        return values.get(key) ?? null;
      },
      key(index) {
        return [...values.keys()][index] ?? null;
      },
      removeItem(key) {
        values.delete(key);
      },
      setItem(key, value) {
        values.set(key, value);
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorage,
    });

    const payload = { amount: "37.25", accountId: 9 };
    const first = attachAccountingRequestIdentity("POST", "/api/salary-advances", payload) as {
      clientRequestId: string;
    };
    const retry = attachAccountingRequestIdentity("POST", "/api/salary-advances", payload) as {
      clientRequestId: string;
    };

    expect(first.clientRequestId).toBe(retry.clientRequestId);
    expect(values.size).toBe(1);

    releaseAccountingRequestIdentity("POST", "/api/salary-advances", retry);
    expect(values.size).toBe(1);

    const next = attachAccountingRequestIdentity("POST", "/api/salary-advances", payload) as {
      clientRequestId: string;
    };
    expect(next.clientRequestId === first.clientRequestId).toBe(false);
  });

  it("keeps optional manual vouchers outside the active posting boundary", () => {
    expect(
      isProtectedAccountingRequest("POST", "/api/vouchers", {
        optional: true,
      })
    ).toBe(false);
    expect(
      isProtectedAccountingRequest("POST", "/api/vouchers/with-entries", {
        voucher: { optional: true },
        entries: [{ debitAmount: "1", creditAmount: "1" }],
      })
    ).toBe(false);
  });
});
