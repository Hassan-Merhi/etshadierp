import type { Plugin } from "vite";

const STOCK_ENTRY_SUFFIX = "/client/src/pages/StockEntryHistory.tsx";
const V5_ALLOCATION_SUFFIX = "/client/src/pages/factory/FactoryStockAllocationV5.tsx";
const FACTORY_DAYBOOK_SUFFIX = "/client/src/pages/factory/FactoryDaybook.tsx";

function replaceExactly(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`[heavy-list-pagination] Missing transform target: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[heavy-list-pagination] Ambiguous transform target: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function transformStockEntry(source: string): string {
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
  return code;
}

function transformV5Allocation(source: string): string {
  let code = source;

  code = replaceExactly(
    code,
    `import { apiRequest, queryClient } from "@/lib/queryClient";`,
    `import { apiRequest, queryClient } from "@/lib/queryClient";\nimport { fetchAllV5AllocationData } from "@/lib/v5AllocationPaginationClient";`,
    "V5 full-data helper import"
  );

  code = replaceExactly(
    code,
    `  const [exportDialogOpen, setExportDialogOpen] = useState(false);\n  const [exportIncludePositive, setExportIncludePositive] = useState(true);\n  const [exportIncludeNegative, setExportIncludeNegative] = useState(true);\n  const [exportIncludeZero, setExportIncludeZero] = useState(false);`,
    `  const [exportDialogOpen, setExportDialogOpen] = useState(false);\n  const [exportIncludePositive, setExportIncludePositive] = useState(true);\n  const [exportIncludeNegative, setExportIncludeNegative] = useState(true);\n  const [exportIncludeZero, setExportIncludeZero] = useState(false);\n  const [actionRows, setActionRows] = useState<V5Row[] | null>(null);\n  const [isLoadingActionRows, setIsLoadingActionRows] = useState(false);\n\n  const loadAllActionRows = useCallback(async (): Promise<V5Row[]> => {\n    if (actionRows) return actionRows;\n    setIsLoadingActionRows(true);\n    try {\n      // Drawers must receive the complete catalog, independent of the table's\n      // hide-zero/search/page state, so users can add or edit any article.\n      const data = await fetchAllV5AllocationData(new URLSearchParams());\n      const completeRows = data.rows as V5Row[];\n      setActionRows(completeRows);\n      return completeRows;\n    } catch (error: any) {\n      toast({\n        title: "Unable to load all products",\n        description: error?.message || "The complete stock allocation list could not be loaded.",\n        variant: "destructive",\n      });\n      return [];\n    } finally {\n      setIsLoadingActionRows(false);\n    }\n  }, [actionRows, toast]);\n\n  const openCreateDrawerWithAllRows = useCallback(async () => {\n    const completeRows = await loadAllActionRows();\n    if (completeRows.length > 0) setCreateDrawerOpen(true);\n  }, [loadAllActionRows]);\n\n  const openEditDrawerWithAllRows = useCallback(\n    async (proformaId: number) => {\n      const completeRows = await loadAllActionRows();\n      if (completeRows.length > 0) setEditDrawerProformaId(proformaId);\n    },\n    [loadAllActionRows]\n  );`,
    "V5 full-data action state"
  );

  code = replaceExactly(
    code,
    `  function openEditDraft(proformaId: number, proformaName: string, currentRows: V5Row[]) {\n    const articles: EditDraftArticle[] = [];`,
    `  async function openEditDraft(proformaId: number, proformaName: string, _currentRows: V5Row[]) {\n    const currentRows = actionRows ?? (await loadAllActionRows());\n    if (currentRows.length === 0) return;\n    const articles: EditDraftArticle[] = [];`,
    "V5 draft quantity full rows"
  );

  code = replaceExactly(
    code,
    `    editOpenedRef.current = true;\n    setEditDrawerProformaId(focusProformaId);`,
    `    editOpenedRef.current = true;\n    void openEditDrawerWithAllRows(focusProformaId);`,
    "V5 focused proforma edit drawer"
  );

  code = replaceExactly(
    code,
    `    const filtered = rows.filter((r) => {`,
    `    const exportParams = new URLSearchParams();\n    if (hideZero) exportParams.set("hideZero", "true");\n    if (debouncedSearch.trim()) exportParams.set("search", debouncedSearch.trim());\n\n    let exportRows: V5Row[];\n    try {\n      const complete = await fetchAllV5AllocationData(exportParams);\n      exportRows = complete.rows as V5Row[];\n    } catch (error: any) {\n      toast({\n        title: "Export failed",\n        description: error?.message || "The complete filtered allocation could not be loaded.",\n        variant: "destructive",\n      });\n      return;\n    }\n\n    if (!showGarbageWipers) exportRows = exportRows.filter((row) => !isGarbageOrWipers(row));\n    if (showNegativeOnly) exportRows = exportRows.filter((row) => row.freeToPromise < 0);\n\n    const filtered = exportRows.filter((r) => {`,
    "V5 complete Excel export rows"
  );

  code = replaceExactly(
    code,
    `  const drawerRows = useMemo(\n    () =>\n      allRows.map((r) => ({`,
    `  const drawerRows = useMemo(\n    () =>\n      (actionRows ?? allRows).map((r) => ({`,
    "V5 drawer full row source"
  );

  code = replaceExactly(
    code,
    `    [allRows]\n  );`,
    `    [actionRows, allRows]\n  );`,
    "V5 drawer row dependencies"
  );

  code = replaceExactly(
    code,
    `          <Button size="sm" onClick={() => setCreateDrawerOpen(true)} data-testid="button-v5-open-create-proforma">`,
    `          <Button\n            size="sm"\n            onClick={() => void openCreateDrawerWithAllRows()}\n            disabled={isLoadingActionRows}\n            data-testid="button-v5-open-create-proforma"\n          >`,
    "V5 create drawer full-data opener"
  );

  code = replaceExactly(
    code,
    `                                    onClick={() => setEditDrawerProformaId(proforma.proformaId)}`,
    `                                    onClick={() => void openEditDrawerWithAllRows(proforma.proformaId)}`,
    "V5 edit drawer full-data opener"
  );

  code = replaceExactly(
    code,
    `        onClose={() => setCreateDrawerOpen(false)}\n        articleRows={drawerRows}\n        onSuccess={() => query.refetch()}`,
    `        onClose={() => {\n          setCreateDrawerOpen(false);\n          setActionRows(null);\n        }}\n        articleRows={drawerRows}\n        onSuccess={() => {\n          setActionRows(null);\n          query.refetch();\n        }}`,
    "V5 create drawer cleanup"
  );

  code = replaceExactly(
    code,
    `          onClose={() => setEditDrawerProformaId(null)}\n          proformaId={editDrawerProformaId}\n          articleRows={drawerRows}\n          onSuccess={() => query.refetch()}`,
    `          onClose={() => {\n            setEditDrawerProformaId(null);\n            setActionRows(null);\n          }}\n          proformaId={editDrawerProformaId}\n          articleRows={drawerRows}\n          onSuccess={() => {\n            setActionRows(null);\n            query.refetch();\n          }}`,
    "V5 edit drawer cleanup"
  );

  return code;
}

function transformFactoryDaybook(source: string): string {
  let code = source;

  code = replaceExactly(
    code,
    `import { queryClient } from "@/lib/queryClient";`,
    `import { queryClient } from "@/lib/queryClient";\nimport { fetchAllDaybookEntries } from "@/lib/daybookPaginationClient";`,
    "Factory Daybook full-data helper import"
  );

  code = replaceExactly(
    code,
    `  if (txTypeFilter !== "ALL") queryParams.set("txType", txTypeFilter);\n  if (currencyFilter !== "ALL") queryParams.set("currencyCode", currencyFilter);`,
    `  if (txTypeFilter !== "ALL") queryParams.set("txType", txTypeFilter);\n  if (currencyFilter !== "ALL") queryParams.set("currencyCode", currencyFilter);\n  if (statusFilter !== "all") queryParams.set("optionalStatus", statusFilter);\n  if (debouncedSearchQuery.trim()) queryParams.set("search", debouncedSearchQuery.trim());\n  if (minAmount.trim()) queryParams.set("minAmount", minAmount.trim());\n  if (maxAmount.trim()) queryParams.set("maxAmount", maxAmount.trim());\n  queryParams.set("sortOrder", sortOrder);`,
    "Factory Daybook server filter parameters"
  );

  code = replaceExactly(
    code,
    `    queryKey: ["/api/factory/daybook", startDate, endDate, txTypeFilter, currencyFilter],`,
    `    queryKey: [\n      "/api/factory/daybook",\n      startDate,\n      endDate,\n      txTypeFilter,\n      currencyFilter,\n      statusFilter,\n      debouncedSearchQuery,\n      minAmount,\n      maxAmount,\n      sortOrder,\n    ],`,
    "Factory Daybook paged query key"
  );

  code = replaceExactly(
    code,
    `  const handleExportToExcel = async () => {\n    if (filteredEntries.length === 0) {\n      toast({\n        title: "No data to export",\n        description: "No entries found for the current filters.",\n        variant: "destructive",\n      });\n      return;\n    }\n    const exportData = filteredEntries.map((e) => ({`,
    `  const handleExportToExcel = async () => {\n    let exportEntries: DaybookEntry[];\n    try {\n      exportEntries = (await fetchAllDaybookEntries(new URLSearchParams(queryParams))).filter(\n        (entry) => entry.txType !== "WORKER_EDITED"\n      ) as DaybookEntry[];\n    } catch (error: any) {\n      toast({\n        title: "Export failed",\n        description: error?.message || "The complete filtered daybook could not be loaded.",\n        variant: "destructive",\n      });\n      return;\n    }\n    if (exportEntries.length === 0) {\n      toast({\n        title: "No data to export",\n        description: "No entries found for the current filters.",\n        variant: "destructive",\n      });\n      return;\n    }\n    const exportData = exportEntries.map((e) => ({`,
    "Factory Daybook complete summary export"
  );

  code = replaceExactly(
    code,
    `      description: \`Downloaded \${fileName} with \${filteredEntries.length} entries.\`,`,
    `      description: \`Downloaded \${fileName} with \${exportEntries.length} entries.\`,`,
    "Factory Daybook summary export count"
  );

  code = replaceExactly(
    code,
    `  const handleExportDetailedToExcel = async () => {\n    if (filteredEntries.length === 0) {\n      toast({\n        title: "No data to export",\n        description: "No entries found for the current filters.",\n        variant: "destructive",\n      });\n      return;\n    }\n    setIsExportingDetailed(true);\n    try {\n      type DetailRow = {`,
    `  const handleExportDetailedToExcel = async () => {\n    setIsExportingDetailed(true);\n    try {\n      const exportEntries = (await fetchAllDaybookEntries(new URLSearchParams(queryParams))).filter(\n        (entry) => entry.txType !== "WORKER_EDITED"\n      ) as DaybookEntry[];\n      if (exportEntries.length === 0) {\n        toast({\n          title: "No data to export",\n          description: "No entries found for the current filters.",\n          variant: "destructive",\n        });\n        return;\n      }\n      type DetailRow = {`,
    "Factory Daybook complete detailed export"
  );

  code = replaceExactly(
    code,
    `      for (const entry of filteredEntries) {`,
    `      for (const entry of exportEntries) {`,
    "Factory Daybook detailed export iteration"
  );

  return code;
}

export function heavyListPaginationPlugin(): Plugin {
  return {
    name: "erp-heavy-list-pagination",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?")[0];
      if (normalizedId.endsWith(STOCK_ENTRY_SUFFIX)) {
        return { code: transformStockEntry(source), map: null };
      }
      if (normalizedId.endsWith(V5_ALLOCATION_SUFFIX)) {
        return { code: transformV5Allocation(source), map: null };
      }
      if (normalizedId.endsWith(FACTORY_DAYBOOK_SUFFIX)) {
        return { code: transformFactoryDaybook(source), map: null };
      }
      return null;
    },
  };
}
