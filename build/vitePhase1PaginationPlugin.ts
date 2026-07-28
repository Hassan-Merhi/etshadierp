import type { Plugin } from "vite";

const MAIN_SUFFIX = "/client/src/main.tsx";
const DAYBOOK_SUFFIX = "/client/src/pages/Daybook.tsx";
const ACCOUNTS_SUFFIX = "/client/src/pages/AccountsLegacy.tsx";
const ACCOUNT_STATEMENT_SUFFIX = "/client/src/pages/accounts/AccountStatementView.tsx";
const ACCOUNT_TYPES_SUFFIX = "/client/src/pages/accounts/accountTypes.ts";

function replaceExactly(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`[phase1-pagination] Missing transform target: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[phase1-pagination] Ambiguous transform target: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRange(source: string, start: string, end: string, replacement: string, label: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`[phase1-pagination] Missing start target: ${label}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`[phase1-pagination] Missing end target: ${label}`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

function replaceAllChecked(source: string, before: string, after: string, minimum: number, label: string): string {
  const count = source.split(before).length - 1;
  if (count < minimum) throw new Error(`[phase1-pagination] Expected at least ${minimum} targets for ${label}, found ${count}`);
  return source.split(before).join(after);
}

function transformMain(source: string): string {
  return replaceExactly(
    source,
    `import "./lib/v5AllocationPaginationClient";`,
    `import "./lib/v5AllocationPaginationClient";\nimport "./lib/accountStatementPaginationClient";`,
    "pagination bootstrap import"
  );
}

function transformDaybook(source: string): string {
  let code = source;
  code = replaceExactly(
    code,
    `import { apiRequest, queryClient } from "@/lib/queryClient";`,
    `import { apiRequest, queryClient } from "@/lib/queryClient";\nimport { fetchAllErpDaybookRows, fetchErpDaybookPage, type ErpDaybookPage } from "@/lib/erpDaybookPaginationClient";`,
    "Daybook pagination helper import"
  );
  code = replaceExactly(
    code,
    `  const DAYBOOK_PAGE_SIZE = 200;\n  const [daybookRowLimit, setDaybookRowLimit] = useState(DAYBOOK_PAGE_SIZE);`,
    `  const DAYBOOK_PAGE_SIZE = 100;\n  const [daybookPage, setDaybookPage] = useState(1);\n  const [daybookPageSize, setDaybookPageSize] = useState(DAYBOOK_PAGE_SIZE);`,
    "Daybook page state"
  );

  const queryReplacement = `  const [accountNameCache] = useState<Record<number, string>>({});\n\n  const daybookQueryParams = useMemo(() => {\n    const params = new URLSearchParams();\n    if (periodFilter.fromDate) params.set("startDate", periodFilter.fromDate);\n    if (periodFilter.toDate) params.set("endDate", periodFilter.toDate);\n    if (filters.voucherType !== "all") params.set("voucherType", filters.voucherType);\n    if (filters.searchQuery.trim()) params.set("search", filters.searchQuery.trim());\n    if (filters.minAmount.trim()) params.set("minAmount", filters.minAmount.trim());\n    if (filters.maxAmount.trim()) params.set("maxAmount", filters.maxAmount.trim());\n    if (filters.statusFilter !== "all") params.set("statusFilter", filters.statusFilter);\n    params.set("sortOrder", filters.sortOrder);\n    return params;\n  }, [\n    periodFilter.fromDate,\n    periodFilter.toDate,\n    filters.voucherType,\n    filters.searchQuery,\n    filters.minAmount,\n    filters.maxAmount,\n    filters.statusFilter,\n    filters.sortOrder,\n  ]);\n\n  useEffect(() => {\n    setDaybookPage(1);\n  }, [selectedCompany?.id, daybookQueryParams.toString(), daybookPageSize]);\n\n  const { data: daybookResponse, isLoading } = useQuery<ErpDaybookPage>({\n    queryKey: [\n      "/api/daybook",\n      selectedCompany?.id,\n      daybookQueryParams.toString(),\n      daybookPage,\n      daybookPageSize,\n    ],\n    queryFn: () => fetchErpDaybookPage(daybookQueryParams, daybookPage, daybookPageSize),\n    enabled: !!selectedCompany,\n    placeholderData: (previous) => previous,\n    staleTime: 30 * 1000,\n    refetchOnWindowFocus: false,\n  });\n\n  const allRows: DaybookRow[] = (daybookResponse?.items ?? []) as DaybookRow[];\n\n`;
  code = replaceRange(
    code,
    `  const [accountNameCache] = useState<Record<number, string>>({});`,
    `  const visibleRows = useMemo(`,
    queryReplacement,
    "Daybook unified query block"
  );
  code = replaceExactly(
    code,
    `  const displayedRows = useMemo(() => visibleRows.slice(0, daybookRowLimit), [visibleRows, daybookRowLimit]);`,
    `  const displayedRows = visibleRows;`,
    "Daybook page rows"
  );
  code = replaceExactly(
    code,
    `  const handleExportToExcel = async () => {\n    const data = filteredVouchers.map((v) => ({`,
    `  const handleExportToExcel = async () => {\n    let exportRows: DaybookRow[];\n    try {\n      exportRows = (await fetchAllErpDaybookRows(daybookQueryParams)) as DaybookRow[];\n    } catch (error: any) {\n      toast({\n        title: "Export failed",\n        description: error?.message || "The complete filtered Daybook could not be loaded.",\n        variant: "destructive",\n      });\n      return;\n    }\n    const exportVouchers = exportRows\n      .filter((row): row is Extract<DaybookRow, { _type: "voucher" }> => row._type === "voucher")\n      .map((row) => row.data);\n    const data = exportVouchers.map((v) => ({`,
    "Daybook complete export"
  );
  code = replaceAllChecked(
    code,
    `      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });`,
    `      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });\n      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });`,
    2,
    "Daybook mutation invalidation"
  );
  code = replaceExactly(
    code,
    `            daybookRowLimit={daybookRowLimit}\n            setDaybookRowLimit={setDaybookRowLimit}\n            DAYBOOK_PAGE_SIZE={DAYBOOK_PAGE_SIZE}\n            navigate={navigate}\n          />`,
    `            daybookRowLimit={visibleRows.length}\n            setDaybookRowLimit={() => undefined}\n            DAYBOOK_PAGE_SIZE={DAYBOOK_PAGE_SIZE}\n            navigate={navigate}\n          />\n          {daybookResponse && (\n            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm" data-testid="erp-daybook-pagination">\n              <Button\n                variant="outline"\n                size="sm"\n                disabled={daybookPage <= 1 || isLoading}\n                onClick={() => setDaybookPage((page) => Math.max(1, page - 1))}\n                data-testid="erp-daybook-page-previous"\n              >\n                Previous\n              </Button>\n              <span className="text-muted-foreground tabular-nums" data-testid="erp-daybook-page-label">\n                {daybookResponse.total === 0 ? 0 : (daybookPage - 1) * daybookPageSize + 1}-\n                {Math.min(daybookPage * daybookPageSize, daybookResponse.total)} of {daybookResponse.total}\n                {" · "}Page {daybookPage} of {Math.max(daybookResponse.totalPages, 1)}\n              </span>\n              <Button\n                variant="outline"\n                size="sm"\n                disabled={!daybookResponse.hasNextPage || isLoading}\n                onClick={() => setDaybookPage((page) => page + 1)}\n                data-testid="erp-daybook-page-next"\n              >\n                Next\n              </Button>\n              <label className="flex items-center gap-1 text-muted-foreground">\n                Rows\n                <select\n                  className="h-8 rounded-md border bg-background px-2 text-foreground"\n                  value={daybookPageSize}\n                  onChange={(event) => {\n                    setDaybookPageSize(Number(event.target.value) || DAYBOOK_PAGE_SIZE);\n                    setDaybookPage(1);\n                  }}\n                  data-testid="erp-daybook-page-size"\n                >\n                  {[50, 100, 250].map((size) => (\n                    <option key={size} value={size}>{size}</option>\n                  ))}\n                </select>\n              </label>\n            </div>\n          )}`,
    "Daybook pagination controls"
  );
  return code;
}

function transformAccounts(source: string): string {
  let code = source;
  code = replaceExactly(
    code,
    `  const closingBalance = useMemo(() => {\n    if (vouchersWithBalance.length > 0) {\n      return vouchersWithBalance[vouchersWithBalance.length - 1].runningBalance;\n    }\n    return broughtForwardBalance;\n  }, [vouchersWithBalance, broughtForwardBalance]);`,
    `  const closingBalance = useMemo(() => {\n    const rawOB = parseFloat(String(selectedAccount?.openingBalance ?? 0)) || 0;\n    const obSide = (selectedAccount as any)?.openingBalanceSide || "Dr";\n    const storedOB = obSide === "Cr" ? -rawOB : rawOB;\n    if (rawTransactionData && !Array.isArray(rawTransactionData)) {\n      const serverClosing = Number(rawTransactionData.closingNetBalance);\n      if (Number.isFinite(serverClosing)) return storedOB + serverClosing;\n    }\n    if (vouchersWithBalance.length > 0) {\n      return vouchersWithBalance[vouchersWithBalance.length - 1].runningBalance;\n    }\n    return broughtForwardBalance;\n  }, [rawTransactionData, selectedAccount, vouchersWithBalance, broughtForwardBalance]);`,
    "full-period statement closing balance"
  );
  code = replaceExactly(
    code,
    `               transactionError={(transactionsQueryError as Error | null)?.message ?? null}\n               selectedVoucherIds={selectedVoucherIds}`,
    `               transactionError={(transactionsQueryError as Error | null)?.message ?? null}\n               transactionTotal={!Array.isArray(rawTransactionData) ? rawTransactionData?.total : undefined}\n               periodDebitTotal={!Array.isArray(rawTransactionData) ? rawTransactionData?.periodDebitTotal : undefined}\n               periodCreditTotal={!Array.isArray(rawTransactionData) ? rawTransactionData?.periodCreditTotal : undefined}\n               statementPage={!Array.isArray(rawTransactionData) ? rawTransactionData?.page : undefined}\n               statementLimit={!Array.isArray(rawTransactionData) ? rawTransactionData?.limit : undefined}\n               statementTotalPages={!Array.isArray(rawTransactionData) ? rawTransactionData?.totalPages : undefined}\n               selectedVoucherIds={selectedVoucherIds}`,
    "statement pagination metadata props"
  );
  return code;
}

function transformAccountStatement(source: string): string {
  let code = source;
  code = replaceExactly(
    code,
    `  transactionError,\n}: AccountStatementViewProps) {`,
    `  transactionError,\n  transactionTotal,\n  periodDebitTotal,\n  periodCreditTotal,\n  statementPage,\n  statementLimit,\n  statementTotalPages,\n}: AccountStatementViewProps) {`,
    "statement pagination prop destructuring"
  );
  code = replaceExactly(
    code,
    `  const totalDebit = useMemo(\n    () => vouchersWithBalance.reduce((s, v) => s + (v.totalDebit || 0), 0),\n    [vouchersWithBalance]\n  );\n  const totalCredit = useMemo(\n    () => vouchersWithBalance.reduce((s, v) => s + (v.totalCredit || 0), 0),\n    [vouchersWithBalance]\n  );`,
    `  const totalDebit = useMemo(\n    () => periodDebitTotal ?? vouchersWithBalance.reduce((s, v) => s + (v.totalDebit || 0), 0),\n    [periodDebitTotal, vouchersWithBalance]\n  );\n  const totalCredit = useMemo(\n    () => periodCreditTotal ?? vouchersWithBalance.reduce((s, v) => s + (v.totalCredit || 0), 0),\n    [periodCreditTotal, vouchersWithBalance]\n  );`,
    "full-period statement totals"
  );
  code = replaceExactly(
    code,
    `<p className="text-base font-semibold leading-none tabular-nums">{vouchersWithBalance.length}</p>`,
    `<p className="text-base font-semibold leading-none tabular-nums">{transactionTotal ?? vouchersWithBalance.length}</p>`,
    "full-period transaction count"
  );
  code = replaceExactly(
    code,
    `      {/* Table */}`,
    `      {statementTotalPages !== undefined && statementTotalPages > 0 && (\n        <p className="text-xs text-muted-foreground text-center" data-testid="account-statement-page-summary">\n          Showing page {statementPage ?? 1} of {Math.max(statementTotalPages, 1)}\n          {statementLimit ? \` · up to \${statementLimit} transactions per page\` : ""}\n        </p>\n      )}\n\n      {/* Table */}`,
    "statement page summary"
  );
  return code;
}

function transformAccountTypes(source: string): string {
  return replaceExactly(
    source,
    `  transactionError?: string | null;\n  selectedVoucherIds: Set<number>;`,
    `  transactionError?: string | null;\n  transactionTotal?: number;\n  periodDebitTotal?: number;\n  periodCreditTotal?: number;\n  statementPage?: number;\n  statementLimit?: number;\n  statementTotalPages?: number;\n  selectedVoucherIds: Set<number>;`,
    "statement metadata types"
  );
}

function scopeAllows(scope: string, group: "main" | "daybook" | "accounts"): boolean {
  return scope === "all" || scope === group;
}

export function phase1PaginationPlugin(): Plugin {
  return {
    name: "erp-phase1-pagination",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?")[0];
      const scope = process.env.PHASE1_TRANSFORM_SCOPE || "all";
      if (scopeAllows(scope, "main") && normalizedId.endsWith(MAIN_SUFFIX)) {
        return { code: transformMain(source), map: null };
      }
      if (scopeAllows(scope, "daybook") && normalizedId.endsWith(DAYBOOK_SUFFIX)) {
        return { code: transformDaybook(source), map: null };
      }
      if (scopeAllows(scope, "accounts") && normalizedId.endsWith(ACCOUNTS_SUFFIX)) {
        return { code: transformAccounts(source), map: null };
      }
      if (scopeAllows(scope, "accounts") && normalizedId.endsWith(ACCOUNT_STATEMENT_SUFFIX)) {
        return { code: transformAccountStatement(source), map: null };
      }
      if (scopeAllows(scope, "accounts") && normalizedId.endsWith(ACCOUNT_TYPES_SUFFIX)) {
        return { code: transformAccountTypes(source), map: null };
      }
      return null;
    },
  };
}
