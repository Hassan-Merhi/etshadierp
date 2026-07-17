import type { Plugin } from "vite";

const STOCK_ENTRY_SUFFIX = "/client/src/pages/StockEntryHistory.tsx";

function replaceExactly(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`[heavy-list-pagination] Missing transform target: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[heavy-list-pagination] Ambiguous transform target: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function heavyListPaginationPlugin(): Plugin {
  return {
    name: "erp-heavy-list-pagination",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?")[0];
      if (!normalizedId.endsWith(STOCK_ENTRY_SUFFIX)) return null;

      let code = source;
      code = replaceExactly(
        code,
        `  async function exportExcel() {\n    const wb = XLSX.utils.book_new();\n\n    const summaryRows = filteredGroups.map((g) => ({`,
        `  async function exportExcel() {\n    const wb = XLSX.utils.book_new();\n\n    // The screen is paged in condensed mode, so exports must resolve the complete\n    // filtered result before building any sheet, including the summary sheet.\n    const groupsWithBales = await fetchGroupsWithBales();\n\n    const summaryRows = groupsWithBales.map((g) => ({`,
        "stock-entry export summary source"
      );

      code = replaceExactly(
        code,
        `\n    // In lite mode, we need to fetch full bale data for the detail and matrix sheets.\n    const groupsWithBales = await fetchGroupsWithBales();\n\n    const detailRows = groupsWithBales.flatMap((g) =>`,
        `\n    const detailRows = groupsWithBales.flatMap((g) =>`,
        "stock-entry duplicate full-data fetch"
      );

      return { code, map: null };
    },
  };
}
