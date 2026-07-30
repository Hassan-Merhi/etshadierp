import type { Plugin } from "vite";

const STOCK_IN_SALES_REPORT_SUFFIX = "/client/src/pages/StockInSalesReport.tsx";
const STOCK_IN_SALES_DETAIL_SUFFIX = "/client/src/pages/StockInSalesReportDetail.tsx";
const AGENTS_SUFFIX = "/client/src/pages/Agents.tsx";
const DAYBOOK_SUFFIX = "/client/src/pages/Daybook.tsx";
const FACTORY_DAYBOOK_SUFFIX = "/client/src/pages/factory/FactoryDaybook.tsx";
const COMBINED_STOCK_VIEW_SUFFIX = "/client/src/pages/location-inventory/CombinedStockView.tsx";

const EXCEL_HELPER_IMPORT = `import { ExcelJS, writeFile } from "@/lib/excelHelper";`;
const EXCEL_UTILS_IMPORT = `import { utils, writeFile } from "@/lib/excelHelper";`;
const EXPORT_START = `    try:\n      const workbook = new ExcelJS.Workbook();`;
const LAZY_EXPORT_START = `    try:\n      const { ExcelJS, writeFile } = await import("@/lib/excelHelper");\n      const workbook = new ExcelJS.Workbook();`;

function replaceExactly(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`[lazy-heavy-imports] Missing transform target: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[lazy-heavy-imports] Ambiguous transform target: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceAllExactly(source: string, before: string, after: string, expectedCount: number, label: string): string {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== expectedCount) {
    throw new Error(`[lazy-heavy-imports] Expected ${expectedCount} ${label} target(s), found ${occurrences}`);
  }
  return source.split(before).join(after);
}

function deferExcelHelper(source: string): string {
  let code = replaceExactly(source, `${EXCEL_HELPER_IMPORT}\n`, "", "Excel helper static import");
  code = replaceExactly(code, EXPORT_START, LAZY_EXPORT_START, "Excel export dynamic import");
  return code;
}

function deferExcelUtils(source: string, handlerHeaders: string[], label: string): string {
  let code = replaceExactly(source, `${EXCEL_UTILS_IMPORT}\n`, "", `${label} Excel helper static import`);
  for (const header of handlerHeaders) {
    code = replaceExactly(
      code,
      header,
      `${header}    const { utils, writeFile } = await import("@/lib/excelHelper");\n`,
      `${label} ${header.trim()} dynamic import`,
    );
  }
  return code;
}

function transformDaybook(source: string): string {
  let code = replaceExactly(
    source,
    `import { AuditLog } from "@/pages/settings/AuditLog";`,
    `import { AuditLog } from "@/components/performance/LazyAuditLog";`,
    "Daybook lazy audit log import",
  );
  code = replaceExactly(
    code,
    `import { VoucherDetailsDialog } from "./daybook/VoucherDetailsDialog";\nimport { VoucherEditDialog } from "./daybook/VoucherEditDialog";`,
    `import { VoucherDetailsDialog, VoucherEditDialog } from "@/components/performance/LazyDaybookDialogs";`,
    "Daybook lazy dialog imports",
  );
  return deferExcelUtils(code, [`  const handleExportToExcel = async () => {\n`], "Daybook");
}

function transformFactoryDaybook(source: string): string {
  let code = replaceExactly(
    source,
    `import { AuditLog } from "@/pages/settings/AuditLog";`,
    `import { AuditLog } from "@/components/performance/LazyAuditLog";`,
    "Factory Daybook lazy audit log import",
  );
  code = deferExcelUtils(
    code,
    [
      `  const handleExportToExcel = async () => {\n`,
      `  const handleExportDetailedToExcel = async () => {\n`,
    ],
    "Factory Daybook",
  );
  return code;
}

function transformCombinedStockView(source: string): string {
  let code = replaceExactly(
    source,
    `import { Package, Warehouse, Search, ChevronDown } from "lucide-react";`,
    `import { useMemo } from "react";\nimport { Package, Warehouse, Search, ChevronDown } from "lucide-react";`,
    "Combined stock useMemo import",
  );

  code = replaceExactly(
    code,
    `  // Table columns: locations that actually have stock (derived from inventory data)\n  const uniqueLocationNames = Array.from(new Map(allInventoryLocations.map((l) => [l.name, l])).values());\n\n  // Dropdown options: full location list so empty locations are still selectable.\n  // Falls back to inventory-derived list if allLocations wasn't passed.\n  const dropdownLocations = allLocations && allLocations.length > 0\n    ? [...allLocations].sort((a, b) => (a.name || "").localeCompare(b.name || ""))\n    : uniqueLocationNames;\n  // Deduplicate categories by id (guard against any API-level duplicates)\n  const uniqueCategories = Array.from(new Map(categoriesList.map((c) => [c.id, c])).values());\n\n  // Columns are always deduplicated by name so same-name locations never produce duplicate headers\n  const visibleLocations = allStockLocationFilter\n    ? uniqueLocationNames.filter((l) => l.name === allStockLocationFilter)\n    : uniqueLocationNames;`,
    `  // Reference lists are stable across filter keystrokes and no longer allocate on every render.\n  const uniqueLocationNames = useMemo(\n    () => Array.from(new Map(allInventoryLocations.map((location) => [location.name, location])).values()),\n    [allInventoryLocations],\n  );\n  const dropdownLocations = useMemo(\n    () =>\n      allLocations && allLocations.length > 0\n        ? [...allLocations].sort((a, b) => (a.name || "").localeCompare(b.name || ""))\n        : uniqueLocationNames,\n    [allLocations, uniqueLocationNames],\n  );\n  const uniqueCategories = useMemo(\n    () => Array.from(new Map(categoriesList.map((category) => [category.id, category])).values()),\n    [categoriesList],\n  );\n  const visibleLocations = useMemo(\n    () =>\n      allStockLocationFilter\n        ? uniqueLocationNames.filter((location) => location.name === allStockLocationFilter)\n        : uniqueLocationNames,\n    [allStockLocationFilter, uniqueLocationNames],\n  );\n\n  // One linear pass replaces per-group filters and repeated footer reductions.\n  const tableSummary = useMemo(() => {\n    const groupSummaries = new Map<string, { itemCount: number; totalQty: number; totalValue: number }>();\n    const locationTotals = new Map<string, number>();\n    let totalQty = 0;\n    let totalValue = 0;\n\n    for (const row of filteredCombinedRows) {\n      const group = groupSummaries.get(row.stockGroupName) ?? { itemCount: 0, totalQty: 0, totalValue: 0 };\n      group.itemCount += 1;\n      group.totalQty += row.totalQty;\n      group.totalValue += row.totalValue;\n      groupSummaries.set(row.stockGroupName, group);\n      totalQty += row.totalQty;\n      totalValue += row.totalValue;\n      for (const location of visibleLocations) {\n        locationTotals.set(\n          location.name,\n          (locationTotals.get(location.name) ?? 0) + (row.qtyByLocationName[location.name] || 0),\n        );\n      }\n    }\n\n    return { groupSummaries, locationTotals, totalQty, totalValue };\n  }, [filteredCombinedRows, visibleLocations]);`,
    "Combined stock memoized table model",
  );

  code = replaceExactly(
    code,
    `                      const groupRows = filteredCombinedRows.filter((r) => r.stockGroupName === row.stockGroupName);\n                      const groupTotal = groupRows.reduce((s, r) => s + r.totalQty, 0);\n                      const groupValue = groupRows.reduce((s, r) => s + r.totalValue, 0);`,
    `                      const groupSummary = tableSummary.groupSummaries.get(row.stockGroupName)!;`,
    "Combined stock group summary lookup",
  );
  code = replaceAllExactly(code, "groupRows.length", "groupSummary.itemCount", 2, "group item count");
  code = replaceAllExactly(code, "groupTotal", "groupSummary.totalQty", 1, "group total quantity");
  code = replaceAllExactly(code, "groupValue", "groupSummary.totalValue", 2, "group total value");
  code = replaceExactly(
    code,
    `                    const locTotal = filteredCombinedRows.reduce((s, r) => s + (r.qtyByLocationName[loc.name] || 0), 0);`,
    `                    const locTotal = tableSummary.locationTotals.get(loc.name) ?? 0;`,
    "Combined stock location total",
  );
  code = replaceExactly(
    code,
    `                    {filteredCombinedRows\n                      .reduce((s, r) => s + r.totalQty, 0)\n                      .toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
    `                    {tableSummary.totalQty.toLocaleString(undefined, {\n                      minimumFractionDigits: 0,\n                      maximumFractionDigits: 2,\n                    })}`,
    "Combined stock grand quantity",
  );
  code = replaceAllExactly(
    code,
    `formatAmount(filteredCombinedRows.reduce((s, r) => s + r.totalValue, 0))`,
    `formatAmount(tableSummary.totalValue)`,
    2,
    "Combined stock total value",
  );

  return code;
}

export function lazyHeavyImportsPlugin(): Plugin {
  return {
    name: "erp-lazy-heavy-imports",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?")[0];
      if (
        normalizedId.endsWith(STOCK_IN_SALES_REPORT_SUFFIX) ||
        normalizedId.endsWith(STOCK_IN_SALES_DETAIL_SUFFIX)
      ) {
        return { code: deferExcelHelper(source), map: null };
      }
      if (normalizedId.endsWith(AGENTS_SUFFIX)) {
        return {
          code: deferExcelUtils(source, [`  const handleExportExcel = async () => {\n`], "Agents"),
          map: null,
        };
      }
      if (normalizedId.endsWith(DAYBOOK_SUFFIX)) {
        return { code: transformDaybook(source), map: null };
      }
      if (normalizedId.endsWith(FACTORY_DAYBOOK_SUFFIX)) {
        return { code: transformFactoryDaybook(source), map: null };
      }
      if (normalizedId.endsWith(COMBINED_STOCK_VIEW_SUFFIX)) {
        return { code: transformCombinedStockView(source), map: null };
      }
      return null;
    },
  };
}
