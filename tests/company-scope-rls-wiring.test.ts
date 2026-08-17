import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function source(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("company-scope RLS startup wiring", () => {
  it("is anchored in the bundled database bootstrap", async () => {
    const dbSource = await source("server/db.ts");
    expect(dbSource).toContain('import "./companyScopeRlsBridge.mjs";');
  });

  it("also runs through the production preload path", async () => {
    const preloadSource = await source("server/supplierCompanyScopeBridge.mjs");
    expect(preloadSource).toContain('import "./companyScopeRlsBridge.mjs";');
  });

  it("applies the reviewed 0016 migration transactionally and fails startup on error", async () => {
    const bridgeSource = await source("server/companyScopeRlsBridge.mjs");
    expect(bridgeSource).toContain("0016_company_scope_rls_readiness.sql");
    expect(bridgeSource).toContain('await client.query("BEGIN")');
    expect(bridgeSource).toContain('await client.query("COMMIT")');
    expect(bridgeSource).toContain('await client.query("ROLLBACK")');
    expect(bridgeSource).toContain("pg_advisory_xact_lock");
    expect(bridgeSource).toContain("throw error");
  });

  it("keeps the migration registered in the Drizzle journal", async () => {
    const journal = JSON.parse(await source("migrations/meta/_journal.json"));
    expect(journal.entries.some((entry: { tag?: string }) => entry.tag === "0016_company_scope_rls_readiness")).toBe(
      true
    );
  });
});
