import type { Plugin } from "vite";

const SALES_REPORT_SUFFIX = "/client/src/pages/SalesReportLegacy.tsx";
const SALES_COMPARISON_SUFFIX = "/client/src/pages/SalesReportComparison.tsx";

function replaceExactly(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`[sales-report-bandwidth] Missing transform target: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[sales-report-bandwidth] Ambiguous transform target: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceBetween(source: string, start: string, end: string, replacement: string, label: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`[sales-report-bandwidth] Missing start target: ${label}`);
  if (source.indexOf(start, startIndex + start.length) >= 0) {
    throw new Error(`[sales-report-bandwidth] Ambiguous start target: ${label}`);
  }
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`[sales-report-bandwidth] Missing end target: ${label}`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

function transformSalesReport(source: string): string {
  let code = source;

  code = replaceExactly(
    code,
    `import { format, parseISO, startOfDay, startOfMonth, startOfYear, addDays } from "date-fns";`,
    `import { format, parseISO, addDays } from "date-fns";`,
    "remove browser-side grouping date helpers"
  );

  code = replaceExactly(
    code,
    `import type { DailySummary, GroupingType, ProfitFilter, SalesReportItem } from "./salesreportlegacy/types";`,
    `import type { DailySummary, GroupingType, ProfitFilter, SalesReportItem } from "./salesreportlegacy/types";\nimport {\n  EMPTY_SALES_REPORT_TOTALS,\n  fetchSalesReportRows,\n  fetchSalesReportSummary,\n  type SalesReportSummaryResponse,\n} from "@/lib/salesReportBandwidthClient";`,
    "sales report compact client import"
  );

  code = replaceExactly(
    code,
    `  const [searchTerm, setSearchTerm] = useState("");`,
    `  const [searchTerm, setSearchTerm] = useState("");\n  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");`,
    "sales report debounced search state"
  );

  code = replaceExactly(
    code,
    `  const { formatAmount } = useCurrencyContext();`,
    `  const { formatAmount } = useCurrencyContext();\n\n  useEffect(() => {\n    const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 350);\n    return () => window.clearTimeout(timer);\n  }, [searchTerm]);`,
    "sales report debounced search effect"
  );

  code = replaceExactly(
    code,
    `  // Fetch stock items (lightweight — only needs id/name/code for filter dropdown)\n  const { data: stockItems = [] } = useQuery<any[]>({\n    queryKey: ["/api/stock-items/light", selectedCompany?.id],\n    staleTime: 10 * 60 * 1000,\n    refetchOnWindowFocus: false,\n    refetchOnMount: false,\n    refetchOnReconnect: false,\n  });\n\n`,
    ``,
    "remove unused stock item list from summary screen"
  );

  code = replaceBetween(
    code,
    `  // Build query params for single-company mode (location/group filtered client-side)\n`,
    `  const handleClearFilters = () => {`,
    `  // Phase 3 bandwidth path: the list screen requests only server-aggregated rows.\n  // Raw sale lines remain available for drill-down and are fetched on demand for Excel.\n  const singleSummaryParams = new URLSearchParams();\n  if (periodFilter.fromDate) singleSummaryParams.set("startDate", periodFilter.fromDate);\n  if (periodFilter.toDate) singleSummaryParams.set("endDate", periodFilter.toDate);\n  singleSummaryParams.set("grouping", grouping);\n  singleSummaryParams.set("mergeView", String(mergeView));\n  singleSummaryParams.set("profitFilter", profitFilter);\n  if (debouncedSearchTerm) singleSummaryParams.set("search", debouncedSearchTerm);\n  if (selectedLocations.length > 0) singleSummaryParams.set("locationIds", selectedLocations.join(","));\n  if (selectedStockGroups.length > 0) singleSummaryParams.set("stockGroupIds", selectedStockGroups.join(","));\n  const singleSummaryUrl = \`/api/sales-report/summary?\${singleSummaryParams.toString()}\`;\n\n  const multiSummaryParams = new URLSearchParams();\n  if (periodFilter.fromDate) multiSummaryParams.set("startDate", periodFilter.fromDate);\n  if (periodFilter.toDate) multiSummaryParams.set("endDate", periodFilter.toDate);\n  multiSummaryParams.set("grouping", grouping);\n  multiSummaryParams.set("mergeView", String(mergeView));\n  multiSummaryParams.set("profitFilter", profitFilter);\n  if (debouncedSearchTerm) multiSummaryParams.set("search", debouncedSearchTerm);\n  if (selectedCompanies.length > 0) multiSummaryParams.set("companyFilter", selectedCompanies.join(","));\n  if (selectedStockGroupNames.length > 0) {\n    multiSummaryParams.set("stockGroupNames", JSON.stringify(selectedStockGroupNames));\n  }\n  const multiSummaryUrl = \`/api/dashboard/sales-report-all/summary?\${multiSummaryParams.toString()}\`;\n\n  const singleRawParams = new URLSearchParams();\n  if (periodFilter.fromDate) singleRawParams.set("startDate", periodFilter.fromDate);\n  if (periodFilter.toDate) singleRawParams.set("endDate", periodFilter.toDate);\n  const singleCompanyRawUrl = singleRawParams.toString()\n    ? \`/api/sales-report?\${singleRawParams.toString()}\`\n    : "/api/sales-report";\n\n  const multiRawParams = new URLSearchParams();\n  if (periodFilter.fromDate) multiRawParams.set("startDate", periodFilter.fromDate);\n  if (periodFilter.toDate) multiRawParams.set("endDate", periodFilter.toDate);\n  if (selectedCompanies.length > 0) multiRawParams.set("companyFilter", selectedCompanies.join(","));\n  if (selectedStockGroupNames.length > 0) multiRawParams.set("stockGroupName", selectedStockGroupNames[0]);\n  const multiCompanyRawUrl = multiRawParams.toString()\n    ? \`/api/dashboard/sales-report-all?\${multiRawParams.toString()}\`\n    : "/api/dashboard/sales-report-all";\n\n  const { data: singleCompanySummary, isLoading: isLoadingSingle } = useQuery<SalesReportSummaryResponse>({\n    queryKey: [singleSummaryUrl],\n    queryFn: () => fetchSalesReportSummary(singleSummaryUrl),\n    enabled: !isMultiCompanyMode,\n    staleTime: 60_000,\n    refetchOnWindowFocus: false,\n    refetchOnReconnect: false,\n    placeholderData: (previous) => previous,\n  });\n\n  const { data: allCompaniesSummary, isLoading: isLoadingMulti } = useQuery<SalesReportSummaryResponse>({\n    queryKey: [multiSummaryUrl],\n    queryFn: () => fetchSalesReportSummary(multiSummaryUrl),\n    enabled: isMultiCompanyMode,\n    staleTime: 60_000,\n    refetchOnWindowFocus: false,\n    refetchOnReconnect: false,\n    placeholderData: (previous) => previous,\n  });\n\n  const activeSummary = isMultiCompanyMode ? allCompaniesSummary : singleCompanySummary;\n  const isLoading = isMultiCompanyMode ? isLoadingMulti : isLoadingSingle;\n\n  const filteredGroupedData = useMemo<DailySummary[]>(\n    () =>\n      (activeSummary?.groups ?? []).map((group) => ({\n        ...group,\n        displayDate:\n          grouping === "daily"\n            ? formatDisplayDate(parseISO(group.dateKey))\n            : grouping === "monthly"\n              ? format(parseISO(\`\${group.dateKey}-01\`), "MMMM yyyy")\n              : group.dateKey,\n      })),\n    [activeSummary?.groups, grouping, formatDisplayDate]\n  );\n  const groupedData = filteredGroupedData;\n  const totals = activeSummary?.totals ?? EMPTY_SALES_REPORT_TOTALS;\n  const companyFilterOptions = useMemo<[string, string][]>(\n    () => (isMultiCompanyMode ? (allCompaniesSummary?.companies ?? []).map((company) => [company.code, company.name]) : []),\n    [isMultiCompanyMode, allCompaniesSummary?.companies]\n  );\n\n`,
    "replace raw sales list aggregation with server summary"
  );

  code = replaceExactly(
    code,
    `  const handleExportExcel = async () => {\n    const workbook = new ExcelJS.Workbook();`,
    `  const handleExportExcel = async () => {\n    let salesData: SalesReportItem[];\n    try {\n      salesData = await fetchSalesReportRows(isMultiCompanyMode ? multiCompanyRawUrl : singleCompanyRawUrl);\n    } catch (error: any) {\n      toast({\n        title: "Export failed",\n        description: error?.message || "The detailed sales rows could not be loaded.",\n        variant: "destructive",\n      });\n      return;\n    }\n\n    const workbook = new ExcelJS.Workbook();`,
    "sales report raw rows only on explicit export"
  );

  code = replaceExactly(
    code,
    `{formatNumber(localFilteredData.length, 0)}`,
    `{formatNumber(totals.itemCount, 0)}`,
    "sales report total item count"
  );

  return code;
}

function transformSalesComparison(source: string): string {
  return replaceExactly(
    source,
    `    queryKey: ["/api/dashboard/sales-report-all", queryString],\n    enabled,`,
    `    queryKey: [\n      queryString\n        ? \`/api/dashboard/sales-report-comparison?\${queryString}\`\n        : "/api/dashboard/sales-report-comparison",\n    ],\n    enabled,\n    staleTime: 60_000,\n    refetchOnWindowFocus: false,\n    refetchOnReconnect: false,`,
    "sales comparison aggregate endpoint"
  );
}

export function salesReportBandwidthPlugin(): Plugin {
  return {
    name: "erp-sales-report-bandwidth",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?")[0];
      if (normalizedId.endsWith(SALES_REPORT_SUFFIX)) {
        return { code: transformSalesReport(source), map: null };
      }
      if (normalizedId.endsWith(SALES_COMPARISON_SUFFIX)) {
        return { code: transformSalesComparison(source), map: null };
      }
      return null;
    },
  };
}
