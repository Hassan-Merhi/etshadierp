import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectBackupFormat,
  inspectBackup,
} from "../scripts/verify-database-backup.mjs";

const tempDirs: string[] = [];

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "erp-backup-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("database backup verification", () => {
  it("recognizes PostgreSQL custom and plain-SQL dump headers", () => {
    expect(detectBackupFormat(Buffer.from("PGDMP\u0001\u000e"))).toBe("postgres-custom");
    expect(detectBackupFormat(Buffer.from("-- PostgreSQL database dump\nSET statement_timeout = 0;"))).toBe(
      "postgres-plain-sql",
    );
    expect(detectBackupFormat(Buffer.from("not a database backup"))).toBe("unknown");
  });

  it("returns a checksum and accepts a fresh custom-format backup", async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, "backup.dump");
    await writeFile(filePath, Buffer.concat([Buffer.from("PGDMP"), Buffer.alloc(2048, 1)]));

    const result = await inspectBackup(filePath, { maxAgeHours: 24 });

    expect(result.ok).toBe(true);
    expect(result.format).toBe("postgres-custom");
    expect(result.sizeBytes).toBeGreaterThan(1024);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.errors).toEqual([]);
  });

  it("rejects stale or unrecognized files without changing them", async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, "invalid.dump");
    await writeFile(filePath, Buffer.alloc(2048, 7));
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(filePath, old, old);

    const result = await inspectBackup(filePath, { maxAgeHours: 24 });

    expect(result.ok).toBe(false);
    expect(result.format).toBe("unknown");
    expect(result.errors.join(" ")).toMatch(/does not look like a PostgreSQL/i);
    expect(result.errors.join(" ")).toMatch(/maximum allowed age/i);
  });
});
