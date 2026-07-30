import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("Phase 11 frontend performance boundaries", () => {
  it("loads only the active application shell", () => {
    const app = source("client/src/app/AuthenticatedApp.tsx");
    for (const shell of ["PosShell", "PropertiesShell", "FactoryShell", "ErpShell"]) {
      expect(app).toContain(`import("./${shell}")`);
      expect(app).not.toContain(`import { ${shell} } from "./${shell}"`);
    }
    expect(app).toContain("<Suspense fallback={<AppLoadingState />}");
  });

  it("does not fetch factory settings for unrelated ERP sessions", () => {
    const hook = source("client/src/app/useAuthenticatedAppData.ts");
    expect(hook).toContain("needsFactorySettings: boolean");
    expect(hook).toContain("enabled: userPresent && !isPOS && !!selectedCompanyId && needsFactorySettings");
    expect(hook).toContain("staleTime: 30000");
    expect(hook).toContain("retry: 2");
    expect(hook).toContain("staleTime: 60000");
  });

  it("loads Daybook audit and dialog code only when used", () => {
    const audit = source("client/src/components/performance/LazyAuditLog.tsx");
    const dialogs = source("client/src/components/performance/LazyDaybookDialogs.tsx");
    expect(audit).toContain('import("@/pages/settings/AuditLog")');
    expect(dialogs).toContain('import("@/pages/daybook/VoucherDetailsDialog")');
    expect(dialogs).toContain('import("@/pages/daybook/VoucherEditDialog")');
    expect(dialogs.match(/if \(!props\.open\) return null/g)?.length).toBe(2);
  });

  it("defers Excel runtimes and linearizes combined-stock summaries", () => {
    const plugin = source("build/viteLazyHeavyImportsPlugin.ts");
    const vite = source("vite.config.ts");
    expect(plugin).toContain('await import("@/lib/excelHelper")');
    expect(plugin).toContain("AGENTS_SUFFIX");
    expect(plugin).toContain("DAYBOOK_SUFFIX");
    expect(plugin).toContain("FACTORY_DAYBOOK_SUFFIX");
    expect(plugin).toContain("COMBINED_STOCK_VIEW_SUFFIX");
    expect(plugin).toContain("groupSummaries");
    expect(plugin).toContain("locationTotals");
    expect(plugin).toContain("tableSummary");
    expect(plugin).not.toContain("try:\\n");
    expect(vite.indexOf("heavyListPaginationPlugin()")).toBeLessThan(vite.indexOf("lazyHeavyImportsPlugin()"));
    expect(vite.indexOf("lazyHeavyImportsPlugin()")).toBeLessThan(vite.indexOf("react()"));
  });

  it("defers combined-stock text filtering while preserving all filters", () => {
    const hook = source("client/src/pages/location-inventory/useCombinedStockRows.ts");
    expect(hook).toContain("useDeferredValue");
    expect(hook).toContain("const matrixProfile = useMemo");
    expect(hook).toContain("searchText:");
    expect(hook).toContain("deferredSearchTerm,");
    expect(hook).toContain("allStockGroupFilter");
    expect(hook).toContain("allStockCategoryFilter");
    expect(hook).toContain("allStockLocationFilter");
  });
});
