/**
 * Unit tests for the daybookSourceIntegrity registry.
 *
 * Covers:
 *   - AUTO_FILL_REF_TABLE canonical values
 *   - isRowIntegrityValid logic (live / orphaned / null-referenceId / non-registry)
 *   - buildPaginationIntegrityConditions output shape
 *   - SOURCE_GROUPS coverage sanity
 */

import { describe, it, expect } from "vitest";
import {
  AUTO_FILL_REF_TABLE,
  SOURCE_GROUPS,
  buildPaginationIntegrityConditions,
  isRowIntegrityValid,
} from "../server/services/factory/daybookSourceIntegrity";

// ── AUTO_FILL_REF_TABLE ────────────────────────────────────────────────────

describe("AUTO_FILL_REF_TABLE", () => {
  it("maps SUPPLIER_FX_TRANSFER to factory_supplier_fx_transfers", () => {
    expect(AUTO_FILL_REF_TABLE["SUPPLIER_FX_TRANSFER"]).toBe("factory_supplier_fx_transfers");
  });
  it("maps SUPPLIER_PAYMENT to factory_supplier_payments", () => {
    expect(AUTO_FILL_REF_TABLE["SUPPLIER_PAYMENT"]).toBe("factory_supplier_payments");
  });
  it("maps PAYROLL_PAYMENT to factory_payrolls", () => {
    expect(AUTO_FILL_REF_TABLE["PAYROLL_PAYMENT"]).toBe("factory_payrolls");
  });
  it("maps OFFLOAD_RAW_STOCK to factory_raw_stock", () => {
    expect(AUTO_FILL_REF_TABLE["OFFLOAD_RAW_STOCK"]).toBe("factory_raw_stock");
  });
  it("maps COMMISSION to factory_container_commissions", () => {
    expect(AUTO_FILL_REF_TABLE["COMMISSION"]).toBe("factory_container_commissions");
  });
  it("maps FREIGHT to factory_containers", () => {
    expect(AUTO_FILL_REF_TABLE["FREIGHT"]).toBe("factory_containers");
  });
  it("maps OTHER_CHARGE to factory_containers", () => {
    expect(AUTO_FILL_REF_TABLE["OTHER_CHARGE"]).toBe("factory_containers");
  });
});

// ── isRowIntegrityValid ────────────────────────────────────────────────────

describe("isRowIntegrityValid", () => {
  const emptyMap = new Map<string, Set<number>>();

  // 1. Non-registry type passes through unconditionally
  it("passes through BALE_STOCK_ENTRY (non-registry type)", () => {
    expect(isRowIntegrityValid({ txType: "BALE_STOCK_ENTRY", referenceId: 55, referenceTable: null }, emptyMap)).toBe(true);
  });

  // 2. Audit/activity entries pass through
  it("passes through PAYROLL_DELETED (audit entry, non-registry)", () => {
    expect(isRowIntegrityValid({ txType: "PAYROLL_DELETED", referenceId: 1, referenceTable: "factory_payrolls" }, emptyMap)).toBe(true);
  });

  // 3. SUPPLIER_FX_TRANSFER with live referenceId
  it("SUPPLIER_FX_TRANSFER with live referenceId → valid", () => {
    const map = new Map([["factory_supplier_fx_transfers", new Set([42])]]);
    expect(isRowIntegrityValid({ txType: "SUPPLIER_FX_TRANSFER", referenceId: 42, referenceTable: null }, map)).toBe(true);
  });

  // 4. SUPPLIER_FX_TRANSFER with orphaned referenceId
  it("SUPPLIER_FX_TRANSFER with orphaned referenceId → invalid", () => {
    const map = new Map([["factory_supplier_fx_transfers", new Set([42])]]);
    expect(isRowIntegrityValid({ txType: "SUPPLIER_FX_TRANSFER", referenceId: 99, referenceTable: null }, map)).toBe(false);
  });

  // 5. SUPPLIER_FX_TRANSFER with null referenceId (requireReferenceId: true)
  it("SUPPLIER_FX_TRANSFER with null referenceId → invalid", () => {
    expect(isRowIntegrityValid({ txType: "SUPPLIER_FX_TRANSFER", referenceId: null, referenceTable: null }, emptyMap)).toBe(false);
  });

  // 6. PAYROLL_GENERATED with null referenceId (requireReferenceId: false)
  it("PAYROLL_GENERATED with null referenceId → valid (legacy entry)", () => {
    expect(isRowIntegrityValid({ txType: "PAYROLL_GENERATED", referenceId: null, referenceTable: null }, emptyMap)).toBe(true);
  });

  // 7. PAYROLL_GENERATED with orphaned referenceId (requireReferenceId: false, but source missing)
  it("PAYROLL_GENERATED with orphaned referenceId → invalid", () => {
    const map = new Map([["factory_payrolls", new Set([5])]]);
    expect(isRowIntegrityValid({ txType: "PAYROLL_GENERATED", referenceId: 99, referenceTable: null }, map)).toBe(false);
  });

  // 8. ADVANCE_GIVEN with null referenceId
  it("ADVANCE_GIVEN with null referenceId → invalid", () => {
    expect(isRowIntegrityValid({ txType: "ADVANCE_GIVEN", referenceId: null, referenceTable: null }, emptyMap)).toBe(false);
  });

  // 9. CONTAINER_IMPORT with live container id
  it("CONTAINER_IMPORT with live referenceId → valid", () => {
    const map = new Map([["factory_containers", new Set([7])]]);
    expect(isRowIntegrityValid({ txType: "CONTAINER_IMPORT", referenceId: 7, referenceTable: "factory_containers" }, map)).toBe(true);
  });

  // 10. MIX_BATCH_CREATED with source fetched for different table (edge case)
  it("MIX_BATCH_CREATED orphaned when factory_mix_batches row missing", () => {
    // Map has containers but not mix_batches
    const map = new Map([["factory_containers", new Set([7])]]);
    expect(isRowIntegrityValid({ txType: "MIX_BATCH_CREATED", referenceId: 7, referenceTable: null }, map)).toBe(false);
  });
});

// ── buildPaginationIntegrityConditions ────────────────────────────────────

describe("buildPaginationIntegrityConditions", () => {
  it("returns one condition per SOURCE_GROUP", () => {
    const conds = buildPaginationIntegrityConditions("$1");
    expect(conds.length).toBe(SOURCE_GROUPS.length);
  });

  it("every condition is a non-empty SQL string starting with NOT", () => {
    const conds = buildPaginationIntegrityConditions("$1");
    for (const c of conds) {
      expect(typeof c).toBe("string");
      expect(c.startsWith("NOT (")).toBe(true);
    }
  });

  it("every condition references f.reference_id and EXISTS", () => {
    const conds = buildPaginationIntegrityConditions("$1");
    for (const c of conds) {
      expect(c).toContain("f.reference_id");
      expect(c).toContain("EXISTS");
    }
  });

  it("payrolls condition uses IS NOT NULL (requireReferenceId: false)", () => {
    const conds = buildPaginationIntegrityConditions("$1");
    const payrollCond = conds.find((c) => c.includes("factory_payrolls"));
    expect(payrollCond).toBeDefined();
    expect(payrollCond).toContain("IS NOT NULL");
    expect(payrollCond).not.toContain("IS NULL");
  });

  it("advances condition uses (IS NULL OR NOT EXISTS) (requireReferenceId: true)", () => {
    const conds = buildPaginationIntegrityConditions("$1");
    const advanceCond = conds.find((c) => c.includes("factory_worker_advances"));
    expect(advanceCond).toBeDefined();
    expect(advanceCond).toContain("IS NULL");
  });

  it("containers condition checks deleted_at IS NULL", () => {
    const conds = buildPaginationIntegrityConditions("$1");
    const containerCond = conds.find((c) => c.includes("factory_containers"));
    expect(containerCond).toBeDefined();
    expect(containerCond).toContain("deleted_at IS NULL");
  });

  it("uses provided companyParam in EXISTS clause", () => {
    const conds = buildPaginationIntegrityConditions("$3");
    expect(conds.some((c) => c.includes("= $3"))).toBe(true);
  });
});
