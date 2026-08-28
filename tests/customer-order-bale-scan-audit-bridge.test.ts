/**
 * Behavioural coverage for the customer-order bale scan-audit startup bridge.
 *
 * The bridge adds `scanned_at` to the live and archive bale tables and installs
 * the two triggers that fill it. Four properties are load-bearing:
 *
 *   - **No backfill.** Rows scanned before the feature existed have no
 *     trustworthy scan time. The bridge must never write one.
 *   - **First-upgrade safety.** The archive table may not exist yet when this
 *     preload runs, so the bridge must create the canonical shape itself.
 *   - **Idempotence.** It runs on every boot and must not recreate installed
 *     columns or triggers.
 *   - **Fail closed.** A failure aborts startup with the transaction rolled
 *     back instead of leaving a half-installed audit trail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  ssl: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Client: class MockClient {
      connect = harness.connect;
      query = harness.query;
      end = harness.end;
    },
  },
}));

vi.mock("../server/lib/databaseSsl.mjs", () => ({
  resolveDatabaseSsl: harness.ssl,
}));

// @ts-expect-error - plain ESM startup bridge shared with the server boot path.
import { ensureCustomerOrderBaleScanAudit as ensureSchema } from "../server/customerOrderBaleScanAuditBridge.mjs";

function ensureCustomerOrderBaleScanAudit() {
  return ensureSchema({ connectionString: "postgresql://scan-audit-test/db" }) as Promise<void>;
}

interface DatabaseState {
  liveTable: boolean;
  historyTable: boolean;
  liveColumn: boolean;
  historyColumn: boolean;
  liveTrigger: boolean;
  historyTrigger: boolean;
}

function fakeDatabase(state: Partial<DatabaseState> = {}) {
  const db: DatabaseState = {
    liveTable: true,
    historyTable: true,
    liveColumn: false,
    historyColumn: false,
    liveTrigger: false,
    historyTrigger: false,
    ...state,
  };

  return async (statement: unknown) => {
    const sql = String(statement);
    const present = (yes: boolean) => (yes ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 });

    if (/CREATE TABLE IF NOT EXISTS public\.customer_order_bales_history/i.test(sql)) {
      db.historyTable = true;
      db.historyColumn = true;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("to_regclass('public.customer_order_bales_history')")) {
      return { rows: [{ table_name: db.historyTable ? "customer_order_bales_history" : null }], rowCount: 1 };
    }
    if (sql.includes("to_regclass('public.customer_order_bales')")) {
      return { rows: [{ table_name: db.liveTable ? "customer_order_bales" : null }], rowCount: 1 };
    }
    if (sql.includes("information_schema.columns")) {
      return present(sql.includes("customer_order_bales_history") ? db.historyColumn : db.liveColumn);
    }
    if (sql.includes("pg_trigger")) {
      return present(sql.includes("customer_order_bales_history") ? db.historyTrigger : db.liveTrigger);
    }
    return { rows: [], rowCount: 0 };
  };
}

function issued() {
  return harness.query.mock.calls.map(([statement]) => String(statement));
}

function issuedMatching(pattern: RegExp) {
  return issued().filter((statement) => pattern.test(statement));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  harness.connect.mockResolvedValue(undefined);
  harness.end.mockResolvedValue(undefined);
  harness.ssl.mockReturnValue(false);
  harness.query.mockImplementation(fakeDatabase());
});

describe("customer order bale scan audit bridge", () => {
  it("adds the audit columns and triggers on a database that has neither", async () => {
    await ensureCustomerOrderBaleScanAudit();

    expect(issuedMatching(/ALTER TABLE public\.customer_order_bales ADD COLUMN scanned_at/)).toHaveLength(1);
    expect(issuedMatching(/ALTER TABLE public\.customer_order_bales_history ADD COLUMN scanned_at/)).toHaveLength(1);
    expect(issuedMatching(/CREATE TRIGGER customer_order_bales_set_scanned_at/)).toHaveLength(1);
    expect(issuedMatching(/CREATE TRIGGER customer_order_bales_history_copy_scanned_at/)).toHaveLength(1);
    expect(issued().at(-1)).toBe("COMMIT");
  });

  it("never backfills a scan time onto rows that predate the feature", async () => {
    await ensureCustomerOrderBaleScanAudit();

    expect(issuedMatching(/UPDATE\s+(public\.)?customer_order_bales/i)).toEqual([]);
    expect(issuedMatching(/scanned_at\s*=/i)).toEqual([]);
  });

  it("timestamps only authenticated scan/import rows and preserves unknown recovery rows", async () => {
    await ensureCustomerOrderBaleScanAudit();

    const triggerFunction = issued().find((statement) => statement.includes("set_customer_order_bale_scanned_at"));
    expect(triggerFunction).toContain("NEW.scanned_by IS NOT NULL");
    expect(triggerFunction).toContain("btrim(NEW.scanned_by) <> ''");
    expect(triggerFunction).toContain("NEW.scanned_at := CURRENT_TIMESTAMP");
    expect(triggerFunction).toContain("history_has_scanned_at");
  });

  it("takes no locks when the columns and triggers are already installed", async () => {
    harness.query.mockImplementation(
      fakeDatabase({ liveColumn: true, historyColumn: true, liveTrigger: true, historyTrigger: true })
    );

    await ensureCustomerOrderBaleScanAudit();

    expect(issuedMatching(/ALTER TABLE/)).toEqual([]);
    expect(issuedMatching(/CREATE TRIGGER/)).toEqual([]);
    expect(issuedMatching(/CREATE TABLE IF NOT EXISTS public\.customer_order_bales_history/)).toEqual([]);
    expect(issued().at(-1)).toBe("COMMIT");
  });

  it("creates the canonical history table when preload runs before startup migrations", async () => {
    harness.query.mockImplementation(fakeDatabase({ historyTable: false }));

    await ensureCustomerOrderBaleScanAudit();

    const createHistory = issuedMatching(/CREATE TABLE IF NOT EXISTS public\.customer_order_bales_history/);
    expect(createHistory).toHaveLength(1);
    expect(createHistory[0]).toContain("scanned_at timestamptz");
    expect(issuedMatching(/CREATE TRIGGER customer_order_bales_set_scanned_at/)).toHaveLength(1);
    expect(issuedMatching(/CREATE TRIGGER customer_order_bales_history_copy_scanned_at/)).toHaveLength(1);
  });

  it("does nothing when the bale table itself is absent", async () => {
    harness.query.mockImplementation(fakeDatabase({ liveTable: false }));

    await ensureCustomerOrderBaleScanAudit();

    expect(issuedMatching(/ALTER TABLE|CREATE TRIGGER|CREATE OR REPLACE FUNCTION|CREATE TABLE/)).toEqual([]);
    expect(issued().at(-1)).toBe("COMMIT");
  });

  it("rolls back and aborts startup when the schema change fails", async () => {
    const database = fakeDatabase();
    harness.query.mockImplementation(async (statement: unknown) => {
      if (String(statement).includes("ADD COLUMN scanned_at")) throw new Error("lock timeout");
      return database(statement);
    });

    await expect(ensureCustomerOrderBaleScanAudit()).rejects.toThrow("lock timeout");

    expect(issued()).toContain("ROLLBACK");
    expect(issued()).not.toContain("COMMIT");
    expect(harness.end).toHaveBeenCalledTimes(1);
  });
});
