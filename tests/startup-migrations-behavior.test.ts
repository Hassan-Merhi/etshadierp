import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  poolQuery: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  markComplete: vi.fn(),
  recordFailures: vi.fn(),
  ssl: vi.fn(),
}));

vi.mock("pg", () => ({
  Client: class MockClient {
    connect = harness.connect;
    query = harness.query;
    end = harness.end;
  },
}));

vi.mock("../server/db", () => ({
  pool: { query: harness.poolQuery },
}));

vi.mock("../server/lib/logger", () => ({
  logger: {
    info: harness.info,
    warn: harness.warn,
    error: harness.error,
  },
}));

vi.mock("../server/lib/databaseSsl.mjs", () => ({
  resolveDatabaseSsl: harness.ssl,
}));

vi.mock("../server/startupMigrationReport", () => ({
  markStartupMigrationsComplete: harness.markComplete,
  recordStartupMigrationFailures: harness.recordFailures,
}));

import { runStartupMigrations, warmupDb } from "../server/startup/runServerStartupMigrations";

function emptyResult() {
  return { rows: [], rowCount: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.connect.mockResolvedValue(undefined);
  harness.end.mockResolvedValue(undefined);
  harness.query.mockResolvedValue(emptyResult());
  harness.poolQuery.mockResolvedValue(emptyResult());
  harness.ssl.mockReturnValue(false);
});

describe("startup migration execution", () => {
  it("runs a clean startup sweep, publishes success, and always completes", async () => {
    const onComplete = vi.fn();

    await runStartupMigrations([], onComplete);

    expect(harness.connect).toHaveBeenCalledTimes(1);
    expect(harness.query).toHaveBeenCalledWith("SET lock_timeout = '30s'");
    expect(harness.query).toHaveBeenCalledWith("SET statement_timeout = '120s'");
    expect(harness.recordFailures).toHaveBeenCalledWith([]);
    expect(harness.info).toHaveBeenCalledWith("✓ Database tables and columns verified/migrated");
    expect(harness.end).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(harness.markComplete).toHaveBeenCalledTimes(1);
  });

  it("rewrites ADD COLUMN IF NOT EXISTS to a lock-avoiding DO block", async () => {
    await runStartupMigrations(["ALTER TABLE demo ADD COLUMN IF NOT EXISTS code TEXT"], vi.fn());

    const sql = harness.query.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => statement.includes("DO $mig$ BEGIN"))).toBe(true);
    expect(sql.some((statement) => statement.includes("information_schema.columns"))).toBe(true);
    expect(sql.some((statement) => statement.includes("ALTER TABLE demo ADD COLUMN code TEXT"))).toBe(true);
  });

  it("records ordinary migration failures without aborting the startup sweep", async () => {
    harness.query.mockImplementation(async (statement: unknown) => {
      if (String(statement) === "BROKEN MIGRATION") {
        const error = new Error("syntax error at BROKEN");
        Object.assign(error, { code: "42601" });
        throw error;
      }
      return emptyResult();
    });

    const onComplete = vi.fn();
    await runStartupMigrations(["BROKEN MIGRATION"], onComplete);

    expect(harness.recordFailures).toHaveBeenCalledWith([
      expect.objectContaining({ sql: "BROKEN MIGRATION", error: expect.stringContaining("syntax error") }),
    ]);
    expect(harness.error).toHaveBeenCalledWith("✗ 1 migration(s) failed at startup:");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(harness.markComplete).toHaveBeenCalledTimes(1);
  });
});

describe("database warmup", () => {
  it("returns immediately after the first successful pool query", async () => {
    await warmupDb();

    expect(harness.poolQuery).toHaveBeenCalledTimes(1);
    expect(harness.poolQuery).toHaveBeenCalledWith("SELECT 1");
    expect(harness.info).toHaveBeenCalledWith("✓ DB connection pool warmed up (attempt 1)");
  });

  it("retries transient failures and succeeds on a later attempt", async () => {
    vi.useFakeTimers();
    harness.poolQuery.mockRejectedValueOnce(new Error("cold start")).mockResolvedValueOnce(emptyResult());

    const run = warmupDb();
    await vi.advanceTimersByTimeAsync(3000);
    await run;

    expect(harness.poolQuery).toHaveBeenCalledTimes(2);
    expect(harness.warn).toHaveBeenCalledWith(expect.stringContaining("DB warmup attempt 1 failed"));
    expect(harness.info).toHaveBeenCalledWith("✓ DB connection pool warmed up (attempt 2)");
    vi.useRealTimers();
  });

  it("logs a final error after three failed attempts", async () => {
    vi.useFakeTimers();
    harness.poolQuery.mockRejectedValue(new Error("database unavailable"));

    const run = warmupDb();
    await vi.advanceTimersByTimeAsync(6000);
    await run;

    expect(harness.poolQuery).toHaveBeenCalledTimes(3);
    expect(harness.error).toHaveBeenCalledWith("✗ DB warmup failed after 3 attempts — queries will connect lazily");
    vi.useRealTimers();
  });
});
