import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { purgeUnsafeFactoryLoadingScans } from "../client/src/lib/factoryOfflineQueueSafety";

const repoRoot = path.resolve(import.meta.dirname, "..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("factory container document/freight access regression", () => {
  it("checks ownership against factory_containers and keeps company scoping", () => {
    const source = readSource("server/routes/factory/factoryContainerReadAccessRoutes.ts");

    expect(source).toContain(".from(factoryContainers)");
    expect(source).toContain("eq(factoryContainers.id, containerId)");
    expect(source).toContain("eq(factoryContainers.companyId, companyId)");
    expect(source).toContain("eq(containerDocuments.companyId, companyId)");
    expect(source).toContain("eq(containerFreight.companyId, companyId)");
  });

  it("registers corrected reads before the legacy docs routes", () => {
    const source = readSource("server/routes/factoryRoutes.ts");
    const corrected = source.indexOf("registerFactoryContainerReadAccessRoutes(app)");
    const legacy = source.indexOf("registerFactoryDocsUsersRoutes(app)");

    expect(corrected).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(-1);
    expect(corrected).toBeLessThan(legacy);
  });
});

describe("unsafe offline loading scan cleanup", () => {
  const originalWindow = (globalThis as any).window;
  const originalCustomEvent = (globalThis as any).CustomEvent;

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;

    if (originalCustomEvent === undefined) delete (globalThis as any).CustomEvent;
    else (globalThis as any).CustomEvent = originalCustomEvent;
  });

  it("removes deferred bale-allocation POSTs but preserves unrelated actions", () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    (globalThis as any).CustomEvent = class {
      constructor(
        public type: string,
        public init?: unknown
      ) {}
    };
    (globalThis as any).window = {
      localStorage,
      dispatchEvent: () => true,
    };

    localStorage.setItem(
      "erp_offline_queue",
      JSON.stringify([
        {
          id: "unsafe",
          method: "POST",
          url: "/api/factory/customer-orders/123/bales",
          body: "{}",
          status: "pending",
        },
        {
          id: "safe-delete",
          method: "DELETE",
          url: "/api/factory/customer-orders/123/bales/456",
          body: "",
          status: "pending",
        },
        {
          id: "safe-voucher",
          method: "POST",
          url: "/api/factory/vouchers",
          body: "{}",
          status: "pending",
        },
      ])
    );

    expect(purgeUnsafeFactoryLoadingScans()).toBe(1);

    const remaining = JSON.parse(localStorage.getItem("erp_offline_queue") || "[]");
    expect(remaining.map((item: any) => item.id)).toEqual(["safe-delete", "safe-voucher"]);
  });
});
