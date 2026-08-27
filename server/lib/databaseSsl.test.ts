import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Imported for its type only; the runtime module is the untyped `.mjs`.
import type { resolveDatabaseSsl as ResolveDatabaseSsl } from "./databaseSsl.mjs";

async function loadResolver(env: Record<string, string | undefined>): Promise<typeof ResolveDatabaseSsl> {
  vi.resetModules();
  for (const key of ["PGHOST", "PGSSLMODE", "PGSSLROOTCERT", "PGSSL_REJECT_UNAUTHORIZED", "RENDER"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  const mod = await import("./databaseSsl.mjs");
  return mod.resolveDatabaseSsl;
}

describe("resolveDatabaseSsl", () => {
  const REMOTE = "postgresql://user:pass@db.example.com:5432/erp";

  it("disables TLS entirely when PGSSLMODE=disable", async () => {
    const resolve = await loadResolver({ PGSSLMODE: "disable" });
    expect(resolve(REMOTE)).toBe(false);
  });

  it("disables TLS for the local Replit database (PGHOST=helium)", async () => {
    const resolve = await loadResolver({ PGHOST: "helium" });
    expect(resolve("")).toBe(false);
  });

  it("disables TLS when the connection string points at helium", async () => {
    const resolve = await loadResolver({});
    expect(resolve("postgresql://user:pass@helium:5432/erp")).toBe(false);
  });

  it("disables TLS for Render's private same-region Postgres hostname", async () => {
    const resolve = await loadResolver({ RENDER: "true" });
    expect(resolve("postgresql://user:pass@dpg-cabc1234-a:5432/erp")).toBe(false);
  });

  it("verifies TLS for Render's external Postgres hostname", async () => {
    const resolve = await loadResolver({ RENDER: "true" });
    expect(resolve("postgresql://user:pass@dpg-cabc1234-a.oregon-postgres.render.com:5432/erp")).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("honors an explicit SSL mode on a Render private hostname", async () => {
    const resolve = await loadResolver({ RENDER: "true", PGSSLMODE: "require" });
    expect(resolve("postgresql://user:pass@dpg-cabc1234-a:5432/erp")).toEqual({ rejectUnauthorized: true });
  });

  it("defaults to verified TLS using the system trust store", async () => {
    const resolve = await loadResolver({});
    expect(resolve(REMOTE)).toEqual({ rejectUnauthorized: true });
  });

  it("keeps verification enabled when PGSSL_REJECT_UNAUTHORIZED is truthy", async () => {
    for (const flag of ["true", "1", "yes", "on", "TRUE"]) {
      const resolve = await loadResolver({ PGSSL_REJECT_UNAUTHORIZED: flag });
      expect(resolve(REMOTE)).toEqual({ rejectUnauthorized: true });
    }
  });

  it("does not allow a falsy PGSSL_REJECT_UNAUTHORIZED to disable verification", async () => {
    const resolve = await loadResolver({ PGSSL_REJECT_UNAUTHORIZED: "false" });
    expect(resolve(REMOTE)).toEqual({ rejectUnauthorized: true });
  });

  it("verifies against the CA bundle at PGSSLROOTCERT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dbssl-"));
    const caPath = join(dir, "ca.pem");
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n");
    const resolve = await loadResolver({ PGSSLROOTCERT: caPath });
    expect(resolve(REMOTE)).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
      rejectUnauthorized: true,
    });
  });

  it("prefers PGSSLROOTCERT over PGSSL_REJECT_UNAUTHORIZED", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dbssl-"));
    const caPath = join(dir, "ca.pem");
    writeFileSync(caPath, "CA");
    const resolve = await loadResolver({
      PGSSLROOTCERT: caPath,
      PGSSL_REJECT_UNAUTHORIZED: "false",
    });
    expect(resolve(REMOTE)).toEqual({ ca: "CA", rejectUnauthorized: true });
  });

  it("fails fast when PGSSLROOTCERT points at an unreadable file", async () => {
    const resolve = await loadResolver({ PGSSLROOTCERT: "/nonexistent/path/ca.pem" });
    expect(() => resolve(REMOTE)).toThrow();
  });
});
