import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const loadingModels = [
  "client/src/pages/containerloadingscan/useContainerLoadingScanModel.ts",
  "client/src/pages/factory/factorycontainerloadingscan/useFactoryContainerLoadingScanModel.ts",
];

describe("Bandwidth Phase 1 page request policy", () => {
  it.each(loadingModels)("removes fixed full-order polling and canonicalizes proforma keys in %s", (file) => {
    const source = read(file);
    expect(source).not.toContain("refetchInterval: 15000");
    expect(source).not.toContain("customerId=${customerId}`, customerId]");
    expect(source).toContain("staleTime: 5 * 60_000");
    expect(source).toContain("staleTime: 15_000");
    expect(source).toContain("setQueryData<OrderDetail>");
  });

  it("does not load the bale-removal history before its dialog opens", () => {
    const source = read("client/src/pages/factory/factorycontainerloadingscan/useFactoryContainerLoadingScanModel.ts");
    expect(source).toContain("enabled: !!orderId && showRemovalLog");
  });

  it("throttles shipping syncs across tabs and cancels delayed tracking refreshes on unmount", () => {
    const source = read("client/src/pages/factory/FactoryShippingContainers.tsx");
    expect(source).toContain("factory-shipping-containers:last-sync");
    expect(source).toContain("5 * 60_000");
    expect(source).toContain("trackingRefreshTimerRef");
    expect(source).toContain('document.visibilityState !== "visible"');
    expect(source).toContain("clearTimeout(trackingRefreshTimerRef.current)");
  });
});
