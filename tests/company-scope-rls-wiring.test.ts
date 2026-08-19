import { describe, expect, it } from "vitest";

describe("company-scope RLS startup wiring", () => {
  it("applies and verifies the company-scope RLS readiness migration against PostgreSQL", async () => {
    const { ensureCompanyScopeRlsReadiness } = await import("../server/companyScopeRlsBridge.mjs");

    await expect(ensureCompanyScopeRlsReadiness()).resolves.toBeUndefined();
  });
});
