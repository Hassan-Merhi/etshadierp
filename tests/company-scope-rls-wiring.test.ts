import { afterAll, beforeAll, describe, expect, it } from "vitest";

const installKey = Symbol.for("erp.company-scope-rls-readiness.applied");
let originalInstallState: unknown;
let ensureCompanyScopeRlsReadiness: () => Promise<void>;

beforeAll(async () => {
  originalInstallState = globalThis[installKey as keyof typeof globalThis];
  (globalThis as Record<PropertyKey, unknown>)[installKey] = true;
  ({ ensureCompanyScopeRlsReadiness } = await import("../server/companyScopeRlsBridge.mjs"));
});

afterAll(() => {
  if (originalInstallState === undefined) {
    delete (globalThis as Record<PropertyKey, unknown>)[installKey];
  } else {
    (globalThis as Record<PropertyKey, unknown>)[installKey] = originalInstallState;
  }
});

describe("company-scope RLS startup wiring", () => {
  it("fails closed when no PostgreSQL configuration is available", async () => {
    const previous = {
      DATABASE_URL: process.env.DATABASE_URL,
      PGHOST: process.env.PGHOST,
      PGUSER: process.env.PGUSER,
      PGPASSWORD: process.env.PGPASSWORD,
      PGDATABASE: process.env.PGDATABASE,
    };

    delete process.env.DATABASE_URL;
    delete process.env.PGHOST;
    delete process.env.PGUSER;
    delete process.env.PGPASSWORD;
    delete process.env.PGDATABASE;

    await expect(ensureCompanyScopeRlsReadiness()).rejects.toThrow(
      "Company-scope RLS migration could not start because no PostgreSQL configuration is available."
    );

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("applies and verifies the company-scope migration against the configured database", async () => {
    expect(process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE)).toBeTruthy();
    await expect(ensureCompanyScopeRlsReadiness()).resolves.toBeUndefined();
  });

  it("is idempotent when startup readiness is checked repeatedly", async () => {
    await expect(ensureCompanyScopeRlsReadiness()).resolves.toBeUndefined();
    await expect(ensureCompanyScopeRlsReadiness()).resolves.toBeUndefined();
  });
});
