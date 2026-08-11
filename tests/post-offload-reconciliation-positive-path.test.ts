import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  const release = vi.fn();

  const query = vi.fn(async (text: string, params?: unknown[]) => {
    queries.push({ text, params });
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact.includes("FROM factory_containers")) {
      return { rows: [{ id: 9, rate_per_kg_usd: "2.000000" }], rowCount: 1 };
    }
    if (compact.includes("FROM factory_offload_additional_charges")) {
      return {
        rows: [
          {
            id: 41,
            amount: "10",
            currency_code: "EUR",
            fx_rate_to_usd: "2",
            ledger_account_id: 55,
            supplier_id: null,
            voucher_id: 51,
            daybook_entry_id: 101,
            reversal_daybook_entry_id: null,
            deleted_at: null,
          },
          {
            id: 42,
            amount: "5",
            currency_code: "EUR",
            fx_rate_to_usd: "2",
            ledger_account_id: null,
            supplier_id: 66,
            voucher_id: 52,
            daybook_entry_id: 102,
            reversal_daybook_entry_id: 103,
            deleted_at: new Date("2026-08-10T00:00:00Z"),
          },
        ],
        rowCount: 2,
      };
    }
    if (compact.includes("FROM factory_daybook_entries")) {
      const id = Number(params?.[0]);
      const rows: Record<number, unknown> = {
        101: {
          id: 101,
          company_id: 4,
          tx_type: "OTHER_CHARGE",
          reference_id: 9,
          amount_currency: "10",
          fx_rate_to_usd: "2",
          amount_usd: "20",
          meta_json: JSON.stringify({ sourceType: "POST_OFFLOAD_ADDITIONAL", chargeId: 41 }),
        },
        102: {
          id: 102,
          company_id: 4,
          tx_type: "OTHER_CHARGE",
          reference_id: 9,
          amount_currency: "5",
          fx_rate_to_usd: "2",
          amount_usd: "10",
          meta_json: { sourceType: "POST_OFFLOAD_ADDITIONAL", chargeId: 42 },
        },
        103: {
          id: 103,
          company_id: 4,
          tx_type: "OTHER_CHARGE",
          reference_id: 9,
          amount_currency: "-5",
          fx_rate_to_usd: "2",
          amount_usd: "-10",
          meta_json: {
            sourceType: "POST_OFFLOAD_ADDITIONAL_REVERSAL",
            chargeId: 42,
            reversesDaybookEntryId: 102,
          },
        },
      };
      return { rows: rows[id] ? [rows[id]] : [], rowCount: rows[id] ? 1 : 0 };
    }
    if (compact.includes("SELECT deleted_at FROM vouchers")) {
      return { rows: [{ deleted_at: new Date("2026-08-10T00:00:00Z") }], rowCount: 1 };
    }
    if (compact.includes("FROM vouchers") && compact.includes("total_amount")) {
      return {
        rows: [
          {
            id: 51,
            company_id: 4,
            total_amount: "10",
            currency: "EUR",
            exchange_rate: "2",
            source_module: "FACTORY",
            deleted_at: null,
          },
        ],
        rowCount: 1,
      };
    }
    if (compact.includes("FROM voucher_entries")) {
      return {
        rows: [
          {
            id: 501,
            ledger_account_id: 77,
            factory_supplier_id: null,
            debit_amount: "20",
            credit_amount: "0",
            transaction_debit_amount: "10",
            transaction_credit_amount: "0",
          },
          {
            id: 502,
            ledger_account_id: 55,
            factory_supplier_id: null,
            debit_amount: "0",
            credit_amount: "20",
            transaction_debit_amount: "0",
            transaction_credit_amount: "10",
          },
        ],
        rowCount: 2,
      };
    }
    if (compact.startsWith("UPDATE voucher_entries")) {
      return { rows: [], rowCount: 1 };
    }
    if (compact.includes("FROM factory_raw_stock")) {
      return { rows: [{ id: 301, cost_per_kg_usd: "2" }], rowCount: 1 };
    }
    if (compact.includes("FROM audit_log") && compact.includes("fingerprint")) {
      return { rows: [{ fingerprint: "sha256:replay-41" }], rowCount: 1 };
    }
    if (compact.includes("FROM factory_recalc_undo_log")) {
      return { rows: [{ id: 701, undone_at: null }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  return { queries, query, release, connect: vi.fn(async () => ({ query, release })) };
});

vi.mock("../server/db", () => ({ pool: { connect: harness.connect } }));

import { reconcilePostOffloadMutation } from "../server/services/factory/postOffloadReconciliation";

describe("post-offload reconciliation positive path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.queries.splice(0);
  });

  it("reconciles active accounting, exact reversal, inventory costing, reports, and replay undo evidence", async () => {
    const result = await reconcilePostOffloadMutation({
      companyId: 4,
      containerId: 9,
      chargeId: 41,
      mutationAction: "EDIT",
      userId: "user-7",
      username: "accountant",
      historicalReplay: {
        status: "applied",
        reason: null,
      } as never,
    });

    expect(result).toMatchObject({
      status: "reconciled",
      companyId: 4,
      containerId: 9,
      chargeId: 41,
      accounting: {
        chargesChecked: 2,
        activeVouchersChecked: 2,
        voucherEntriesNormalized: 2,
        daybookEntriesChecked: 2,
        reversalsChecked: 1,
        issues: [],
      },
      inventory: {
        rawStockRowsChecked: 1,
        containerCostPerKgUsd: "2.000000",
        issues: [],
      },
      undo: {
        required: true,
        available: true,
        undoLogId: 701,
        fingerprint: "sha256:replay-41",
        alreadyUndone: false,
        issues: [],
      },
      issues: [],
    });
    expect(result.reports.queryKeys).toEqual(
      expect.arrayContaining([
        "/api/factory/containers",
        "/api/factory/raw-stock",
        "/api/factory/daybook",
        "/api/vouchers",
      ])
    );
    expect(harness.queries.filter(({ text }) => text.includes("UPDATE voucher_entries"))).toHaveLength(2);
    expect(harness.queries.some(({ text }) => text === "COMMIT")).toBe(true);
    expect(harness.release).toHaveBeenCalledOnce();
  });

  it("rolls back and returns auditable failure details when the scoped container is missing", async () => {
    const release = vi.fn();
    const query = vi.fn(async (text: string) => ({ rows: [], rowCount: text === "ROLLBACK" ? null : 0 }));
    harness.connect.mockResolvedValueOnce({ query, release });

    const result = await reconcilePostOffloadMutation({
      companyId: 99,
      containerId: 999,
      mutationAction: "CREATE",
      userId: "user-7",
    });

    expect(result.status).toBe("failed");
    expect(result.issues.join(" ")).toContain("container was not found");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
