import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/**
 * Reads a page together with its co-located module folder.
 *
 * These are request-policy guards: what matters is that the page's data layer
 * still carries the caching rules, not which file the query literal happens to
 * live in. Pages split during the god-file programme keep their modules in a
 * sibling directory named after the page (FactoryContainerLoadingScan.tsx →
 * factorycontainerloadingscan/), so the assertions read both.
 */
function readPageSources(file: string): string {
  const parsed = path.parse(file);
  const moduleDir = path.join(root, parsed.dir, parsed.name.toLowerCase());
  let combined = read(file);
  if (fs.existsSync(moduleDir)) {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(entryPath);
        else combined += `\n${fs.readFileSync(entryPath, "utf8")}`;
      }
    };
    walk(moduleDir);
  }
  return combined;
}

const loadingPages = [
  "client/src/pages/ContainerLoadingScan.tsx",
  "client/src/pages/factory/FactoryContainerLoadingScan.tsx",
];

describe("Bandwidth Phase 1 page request policy", () => {
  it.each(loadingPages)("removes fixed full-order polling and canonicalizes proforma keys in %s", (file) => {
    const source = readPageSources(file);
    expect(source).not.toContain("refetchInterval: 15000");
    expect(source).not.toContain("customerId=${customerId}`, customerId]");
    expect(source).toContain("staleTime: 5 * 60_000");
    expect(source).toContain("staleTime: 15_000");
    expect(source).toContain("setQueryData<OrderDetail>");
  });

  it("does not load the bale-removal history before its dialog opens", () => {
    const source = readPageSources("client/src/pages/factory/FactoryContainerLoadingScan.tsx");
    expect(source).toContain("enabled: !!orderId && showRemovalLog");
  });

  it("throttles shipping syncs across tabs and cancels delayed tracking refreshes on unmount", () => {
    const source = readPageSources("client/src/pages/factory/FactoryShippingContainers.tsx");
    expect(source).toContain("factory-shipping-containers:last-sync");
    expect(source).toContain("5 * 60_000");
    expect(source).toContain("trackingRefreshTimerRef");
    expect(source).toContain('document.visibilityState !== "visible"');
    expect(source).toContain("clearTimeout(trackingRefreshTimerRef.current)");
  });
});
