import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Imported for its type only; the runtime module is the untyped `.mjs`.
import type { resolveDatabaseSsl as ResolveDatabaseSsl } from "./databaseSsl.mjs";

// The module keeps a one-time "verification disabled" warning flag in module
// scope, so each test re-imports it fresh to get a clean flag and a clean env.
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
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

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
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps TLS enabled for Render's external Postgres hostname", async () => {
    const resolve = await loadResolver({ RENDER: "true" });
    expect(resolve("postgresql://user:pass@dpg-cabc1234-a.oregon-postgres.render.com:5432/erp")).toEqual({
      rejectUnauthorized: false,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("honors an explicit SSL mode on a Render private hostname", async () => {
    const resolve = await loadResolver({ RENDER: "true", PGSSLMODE: "require" });
    expect(resolve("postgresql://user:pass@dpg-cabc1234-a:5432/erp")).toEqual({ rejectUnauthorized: false });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("defaults to unverified TLS and warns exactly once", async () => {
    const resolve = await loadResolver({});
    expect(resolve(REMOTE)).toEqual({ rejectUnauthorized: false });
    // Second call must not warn again.
    expect(resolve(REMOTE)).toEqual({ rejectUnauthorized: false });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("verification");
  });

  it("verifies against the system trust store when PGSSL_REJECT_UNAUTHORIZED is truthy", async () => {
    for (const flag of ["true", "1", "yes", "on", "TRUE"]) {
      const resolve = await loadResolver({ PGSSL_REJECT_UNAUTHORIZED: flag });
      expect(resolve(REMOTE)).toEqual({ rejectUnauthorized: true });
    }
  });

  it("treats a falsy PGSSL_REJECT_UNAUTHORIZED as unverified", async () => {
    const resolve = await loadResolver({ PGSSL_REJECT_UNAUTHORIZED: "false" });
    expect(resolve(REMOTE)).toEqual({ rejectUnauthorized: false });
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
    expect(warnSpy).not.toHaveBeenCalled();
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
