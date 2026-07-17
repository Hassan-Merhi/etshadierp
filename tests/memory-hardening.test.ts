import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getHeavyReadCache,
  getHeavyReadCacheSnapshot,
  invalidateHeavyReadCache,
  storeHeavyReadCache,
} from "../server/lib/heavyReadCache";
import {
  cleanupFileBackedExport,
  createFileBackedExport,
  isFileBackedExport,
  readExportBuffer,
} from "../server/lib/fileBackedExport";
import { getRuntimeDiagnosticsSnapshot } from "../server/lib/runtimeDiagnostics";

function requestFor(userId: string, companyId = 12) {
  return {
    method: "GET",
    path: "/api/factory/net-position",
    originalUrl: "/api/factory/net-position?asOf=2026-07-17",
    session: {
      userId,
      currentRole: "Admin",
      currentCompanyId: companyId,
      factoryCompanyId: companyId,
    },
  } as any;
}

afterEach(() => {
  invalidateHeavyReadCache();
});

describe("heavy read cache isolation", () => {
  it("never shares cached company data between users", () => {
    const firstUser = requestFor("user-a");
    const secondUser = requestFor("user-b");
    const body = { total: 123.45 };

    expect(storeHeavyReadCache(firstUser, body, 64)).toBe(true);
    expect(getHeavyReadCache(firstUser)?.body).toEqual(body);
    expect(getHeavyReadCache(secondUser)).toBeNull();
  });

  it("invalidates only the affected company scope", () => {
    const company12 = requestFor("user-a", 12);
    const company8 = requestFor("user-a", 8);

    expect(storeHeavyReadCache(company12, { company: 12 }, 64)).toBe(true);
    expect(storeHeavyReadCache(company8, { company: 8 }, 64)).toBe(true);

    invalidateHeavyReadCache(company12);

    expect(getHeavyReadCache(company12)).toBeNull();
    expect(getHeavyReadCache(company8)?.body).toEqual({ company: 8 });
  });

  it("rejects entries above the per-entry memory budget", () => {
    const req = requestFor("user-a");
    const tooLarge = 5 * 1024 * 1024;

    expect(storeHeavyReadCache(req, { large: true }, tooLarge)).toBe(false);
    expect(getHeavyReadCacheSnapshot().entries).toBe(0);
  });
});

describe("disk-backed export artifacts", () => {
  it("reads within the boundary limit and removes its temporary directory", async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "erp-export-test-"));
    const filePath = path.join(tempDir, "sample.zip");
    const content = Buffer.from("test-export-content");
    await fs.promises.writeFile(filePath, content);

    const artifact = createFileBackedExport(filePath, tempDir, content.length);
    expect(isFileBackedExport(artifact)).toBe(true);
    await expect(readExportBuffer(artifact, 1024)).resolves.toEqual(content);
    await expect(readExportBuffer(artifact, 4)).rejects.toThrow(/too large to buffer safely/i);

    await cleanupFileBackedExport(artifact);
    expect(fs.existsSync(tempDir)).toBe(false);
  });
});

describe("runtime diagnostics", () => {
  it("reports process, event-loop, child and high-water metrics", () => {
    const snapshot = getRuntimeDiagnosticsSnapshot();

    expect(snapshot.memory.rssMb).toBeGreaterThan(0);
    expect(snapshot.memory.heapLimitMb).toBeGreaterThan(0);
    expect(snapshot.eventLoop.p99Ms).toBeGreaterThanOrEqual(0);
    expect(snapshot.children.rssMb).toBeGreaterThanOrEqual(0);
    expect(snapshot.highWater.rssMb).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.recentSamples)).toBe(true);
  });
});
