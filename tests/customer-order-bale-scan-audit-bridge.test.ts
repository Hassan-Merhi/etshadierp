/**
 * Behavioural coverage for the customer-order bale scan-audit startup bridge.
 *
 * The bridge adds `scanned_at` to the live and archive bale tables and installs
 * the two triggers that fill it. Three properties are load-bearing and none of
 * them is visible from the schema alone:
 *
 *   - **No backfill.** Rows scanned before the feature existed have no
 *     trustworthy scan time. The bridge must never write one, because an
 *     invented timestamp is indistinguishable from a recorded one afterwards.
 *   - **Idempotence.** It runs on every boot. A column or trigger that is
 *     already present must not be recreated, or a redeploy takes a table lock
 *     it does not need.
 *   - **Fail closed.** A failure aborts startup with the transaction rolled
 *     back, rather than leaving the server up with a half-installed audit trail.
 *
 * The bridge is driven against a stubbed pg client so the statements it issues
 * are observable without a database.
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

/** The real DATABASE_URL is left alone; pg is stubbed, so any target will do. */
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

/** Every statement the bridge issued, in order. */
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

    // An UPDATE here would stamp historical bales with a fabricated time that
    // nothing downstream could tell apart from a real one.
    expect(issuedMatching(/UPDATE\s+(public\.)?customer_order_bales/i)).toEqual([]);
    expect(issuedMatching(/scanned_at\s*=/i)).toEqual([]);
  });

  it("takes no locks when the columns and triggers are already installed", async () => {
    harness.query.mockImplementation(
      fakeDatabase({ liveColumn: true, historyColumn: true, liveTrigger: true, historyTrigger: true })
    );

    await ensureCustomerOrderBaleScanAudit();

    expect(issuedMatching(/ALTER TABLE/)).toEqual([]);
    expect(issuedMatching(/CREATE TRIGGER/)).toEqual([]);
    expect(issued().at(-1)).toBe("COMMIT");
  });

  it("installs only the live-table half when no history table exists", async () => {
    harness.query.mockImplementation(fakeDatabase({ historyTable: false }));

    await ensureCustomerOrderBaleScanAudit();

    expect(issuedMatching(/CREATE TRIGGER customer_order_bales_set_scanned_at/)).toHaveLength(1);
    // The live trigger function still probes for the archive table at runtime;
    // what must not happen is any attempt to alter or trigger on one.
    expect(issuedMatching(/(ALTER TABLE|CREATE TRIGGER)[\s\S]*customer_order_bales_history/)).toEqual([]);
  });

  it("does nothing when the bale table itself is absent", async () => {
    harness.query.mockImplementation(fakeDatabase({ liveTable: false }));

    await ensureCustomerOrderBaleScanAudit();

    expect(issuedMatching(/ALTER TABLE|CREATE TRIGGER|CREATE OR REPLACE FUNCTION/)).toEqual([]);
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
