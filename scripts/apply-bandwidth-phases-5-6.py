#!/usr/bin/env python3
from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, source: str) -> None:
    Path(path).write_text(source)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    if old not in source:
        raise RuntimeError(f"Could not find {label}")
    return source.replace(old, new, 1)


def regex_replace_once(source: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count == 0:
        if replacement in source:
            return source
        raise RuntimeError(f"Could not find {label}")
    return updated


# ---------------------------------------------------------------------------
# Phase 5: paginate/compact the GIT container table and load full detail on open.
# ---------------------------------------------------------------------------
path = "server/lib/gitHelpers.ts"
source = read(path)
source = replace_once(
    source,
    '  opts: { includeOffloaded?: boolean } = {}\n',
    '  opts: { includeOffloaded?: boolean; containerId?: number } = {}\n',
    "git helper options",
)
source = replace_once(
    source,
    '''  return db
    .select({''',
    '''  const conditions = [
    inArray(containers.companyId, companyIds),
    inArray(containers.status, statusFilter),
  ];
  if (opts.containerId) conditions.push(eq(containers.id, opts.containerId));

  return db
    .select({''',
    "git helper conditions",
)
source = replace_once(
    source,
    '''    .where(and(inArray(containers.companyId, companyIds), inArray(containers.status, statusFilter)))
    .orderBy(containers.containerNumber);''',
    '''    .where(and(...conditions))
    .orderBy(containers.containerNumber);''',
    "git helper bounded where",
)
write(path, source)

path = "server/routes/git/gitReportRoutes.ts"
source = read(path)
source = replace_once(
    source,
    'import type { GitFilterQuery, EnrichedContainer } from "../../lib/gitHelpers";\n',
    '''import type { GitFilterQuery, EnrichedContainer } from "../../lib/gitHelpers";
import {
  applyGitTableFilters,
  buildGitFacets,
  buildGitTableSummary,
  parseGitPagination,
  sortGitRows,
  toGitCompactRow,
  type GitListingQuery,
} from "./gitListingProfiles";
''',
    "GIT listing profile import",
)
old_listing = '''      let enriched = enrichContainers(raw, nameMap);

      // Route-level pre-filter (e.g. at-port, truck-location)
      if (preFilter) enriched = preFilter(enriched);

      // User-supplied query filters
      const filtered = applyGitFilters(enriched, req.query as GitFilterQuery);

      const asOf = new Date().toISOString();

      if (scope.mode === "all") {
        res.json({ asOf, mode: "all", total: filtered.length, containers: filtered });
      } else {
        const companyName = nameMap[scope.companyId] ?? `Company ${scope.companyId}`;
        res.json({
          asOf,
          mode: "single",
          companyId: scope.companyId,
          companyName,
          total: filtered.length,
          containers: filtered,
        });
      }'''
new_listing = '''      let enriched = enrichContainers(raw, nameMap);

      // Route-level pre-filter (e.g. at-port, truck-location)
      if (preFilter) enriched = preFilter(enriched);

      const listingQuery = req.query as GitListingQuery;
      const facets = buildGitFacets(enriched);
      const filtered = sortGitRows(applyGitTableFilters(enriched, listingQuery), listingQuery.sort);
      const summary = buildGitTableSummary(filtered);
      const explicitFull = listingQuery.all === "true" || listingQuery.profile === "full";
      const { page, pageSize, offset } = parseGitPagination(listingQuery);
      const totalPages = filtered.length === 0 ? 0 : Math.ceil(filtered.length / pageSize);
      const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
      const safeOffset = (safePage - 1) * pageSize;
      const selectedRows = explicitFull ? filtered : filtered.slice(safeOffset, safeOffset + pageSize);
      const containers = explicitFull ? selectedRows : selectedRows.map(toGitCompactRow);
      const asOf = new Date().toISOString();
      const pageMeta = explicitFull
        ? { page: 1, pageSize: filtered.length, totalPages: filtered.length > 0 ? 1 : 0, hasMore: false }
        : { page: safePage, pageSize, totalPages, hasMore: safePage < totalPages };

      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=30");
      if (scope.mode === "all") {
        res.json({
          asOf,
          mode: "all",
          total: filtered.length,
          containers,
          facets,
          summary,
          ...pageMeta,
        });
      } else {
        const companyName = nameMap[scope.companyId] ?? `Company ${scope.companyId}`;
        res.json({
          asOf,
          mode: "single",
          companyId: scope.companyId,
          companyName,
          total: filtered.length,
          containers,
          facets,
          summary,
          ...pageMeta,
        });
      }'''
source = replace_once(source, old_listing, new_listing, "paginated GIT listing")
detail_route = '''

  app.get("/api/git/containers/:id", requireAuth, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const containerId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(containerId) || containerId <= 0) {
        return res.status(400).json({ message: "Invalid container ID" });
      }
      const userId: string = (req.user as any).id;
      const role: string = (req.user as any).role;
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;
      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | undefined>,
        sessionCompanyId
      );
      if ("error" in scope) return res.status(scope.status).json({ message: scope.error });
      const companyIds = scope.mode === "all" ? scope.companyIds : [scope.companyId];
      const [rows, nameMap] = await Promise.all([
        fetchActiveContainers(companyIds, { includeOffloaded: true, containerId }),
        loadCompanyNames(companyIds),
      ]);
      const container = enrichContainers(rows, nameMap)[0];
      if (!container) return res.status(404).json({ message: "Container not found" });
      res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=15");
      return res.json(container);
    } catch (err) {
      logger.error("[gitRoutes] container detail error:", { error: err });
      return res.status(500).json({ message: "Internal server error" });
    }
  });
'''
anchor = '  app.get("/api/git/containers", requireAuth, requireRole("Admin", "Owner"), (req, res) => handleGitListing(req, res));\n'
if detail_route.strip() not in source:
    if anchor not in source:
        raise RuntimeError("Could not find GIT containers route anchor")
    source = source.replace(anchor, anchor + detail_route, 1)
write(path, source)

path = "client/src/pages/git-containers/gitContainerTypes.ts"
source = read(path)
for field in [
    "trackingProvider", "trackingEnabled", "trackingAutoUpdate", "trackingCarrierHint",
    "trackingLastCheckedAt", "trackingLastStatus", "trackingLastLocation", "trackingLastEventDate",
    "trackingLastDescription", "trackingError", "trackingChangedAt", "trackingDetectedCarrier",
    "trackingFallbackUsed", "trackingFallbackReason", "trackingNextCheckAt", "trackingLastSkipReason",
    "trackingLink",
]:
    source = re.sub(rf"^(  {field})(:)", rf"\1?\2", source, flags=re.M)
old_response = '''export interface GitContainersResponse {
  containers: EnrichedContainerRow[];
  mode: "single" | "all";
  companyId?: number;
  companyName?: string;
  total: number;
}'''
new_response = '''export interface GitContainersResponse {
  containers: EnrichedContainerRow[];
  mode: "single" | "all";
  companyId?: number;
  companyName?: string;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  summary?: {
    total: number;
    atSea: number;
    atPort: number;
    leftDar: number;
    inTransit: number;
    arrived: number;
    delayed: number;
    overdue: number;
    totalCost: number;
    totalTransportDuty: number;
  };
  facets?: {
    companies: string[];
    containerNumbers: string[];
    suppliers: string[];
    transporters: string[];
    agents: string[];
    trucks: string[];
    locations: string[];
    etaDates: string[];
    hasContainersWithNoEta: boolean;
  };
}'''
source = replace_once(source, old_response, new_response, "GIT response type")
write(path, source)

path = "client/src/pages/git-containers/useGITContainersData.ts"
source = read(path)
source = source.replace(
    'queryClient.invalidateQueries({ queryKey: [queryUrl] });',
    'queryClient.invalidateQueries({ queryKey: ["/api/git/containers"] });',
)
write(path, source)

path = "client/src/pages/GITContainers.tsx"
source = read(path)
source = replace_once(
    source,
    'import { PageHeader } from "@/components/PageHeader";\n',
    'import { PageHeader } from "@/components/PageHeader";\nimport { PaginationBar } from "@/components/PaginationBar";\n',
    "container pagination import",
)
source = replace_once(
    source,
    '  BulkProgress,\n  type EtaFilterValue,\n',
    '  BulkProgress,\n  fmt,\n  type EtaFilterValue,\n',
    "container formatter import",
)
source = source.replace('import { useContainerFilters } from "./git-containers/useContainerFilters";\n', '')
source = replace_once(
    source,
    'import { useGITContainersData } from "./git-containers/useGITContainersData";\n',
    'import { useGITContainersData } from "./git-containers/useGITContainersData";\nimport { usePaginatedGITContainers } from "./git-containers/usePaginatedGITContainers";\n',
    "paginated container hook import",
)
source = replace_once(
    source,
    '  const [waSending, setWaSending] = useState(false);\n',
    '  const [waSending, setWaSending] = useState(false);\n  const CONTAINER_PAGE_SIZE = 50;\n  const [page, setPage] = useState(1);\n',
    "container page state",
)
old_query = '''  const queryUrl = allCompanies ? "/api/git/containers?allCompanies=true" : "/api/git/containers";

  const { data, isLoading, isError, error, refetch } = useQuery<GitContainersResponse>({
    queryKey: [queryUrl],
    staleTime: 60_000,
    enabled: !!isAllowed,
  });'''
new_query = '''  const { data, isLoading, isError, error, refetch, queryUrl, loadContainerDetail } =
    usePaginatedGITContainers({
      allCompanies,
      page,
      pageSize: CONTAINER_PAGE_SIZE,
      companyFilter,
      containerFilters,
      supplierFilters,
      transporterFilters,
      agentFilters,
      truckFilters,
      locationFilters,
      docsFilter,
      delayedFilter,
      freightFilter,
      etaFilter,
      notesFilter,
      sortOrder,
      search,
      enabled: !!isAllowed,
    });'''
source = replace_once(source, old_query, new_query, "container paginated query")
old_filter = '''  const filteredContainers = useContainerFilters({
    allContainers,
    companyFilter,
    containerFilters,
    supplierFilters,
    transporterFilters,
    agentFilters,
    truckFilters,
    locationFilters,
    docsFilter,
    delayedFilter,
    freightFilter,
    etaFilter,
    notesFilter,
    search,
    sortOrder,
  });'''
source = replace_once(source, old_filter, '  const filteredContainers = allContainers;\n', "server container filters")
old_summary = '''  const { atSea, atPort, leftDar, inTransit, arrived, delayed, offloadOverdue, totalCost, totalTransportDuty } =
    useContainerSummaryStats({ filteredContainers });

  const companies = [...new Set(allContainers.map((c) => c.companyName))].sort();
  const containerNumbers = [...new Set(allContainers.map((c) => c.containerNumber))].sort();
  const suppliers = [...new Set(allContainers.map((c) => c.supplierCode).filter(Boolean))].sort() as string[];
  const transporters = [...new Set(allContainers.map((c) => c.transporter).filter(Boolean))].sort() as string[];
  const agents = [...new Set(allContainers.map((c) => c.agent).filter(Boolean))].sort() as string[];
  const trucks = [...new Set(allContainers.map((c) => c.numberPlate).filter(Boolean))].sort() as string[];
  const locations = [...new Set(allContainers.map((c) => c.trackingLocation).filter(Boolean))].sort() as string[];
  const allEtaDates = useMemo(
    () => [...new Set(allContainers.map((c) => c.eta).filter(Boolean))].sort() as string[],
    [allContainers]
  );
  const hasContainersWithNoEta = useMemo(() => allContainers.some((c) => !c.eta), [allContainers]);'''
new_summary = '''  const localSummary = useContainerSummaryStats({ filteredContainers });
  const atSea = data?.summary?.atSea ?? localSummary.atSea;
  const atPort = data?.summary?.atPort ?? localSummary.atPort;
  const leftDar = data?.summary?.leftDar ?? localSummary.leftDar;
  const inTransit = data?.summary?.inTransit ?? localSummary.inTransit;
  const arrived = data?.summary?.arrived ?? localSummary.arrived;
  const delayed = data?.summary?.delayed ?? localSummary.delayed;
  const offloadOverdue = data?.summary?.overdue ?? localSummary.offloadOverdue;
  const totalCost = data?.summary ? `$${fmt(data.summary.totalCost)}` : localSummary.totalCost;
  const totalTransportDuty = data?.summary
    ? `$${fmt(data.summary.totalTransportDuty)}`
    : localSummary.totalTransportDuty;

  const companies = data?.facets?.companies ?? [...new Set(allContainers.map((c) => c.companyName))].sort();
  const containerNumbers = data?.facets?.containerNumbers ?? [...new Set(allContainers.map((c) => c.containerNumber))].sort();
  const suppliers = data?.facets?.suppliers ?? ([...new Set(allContainers.map((c) => c.supplierCode).filter(Boolean))].sort() as string[]);
  const transporters = data?.facets?.transporters ?? ([...new Set(allContainers.map((c) => c.transporter).filter(Boolean))].sort() as string[]);
  const agents = data?.facets?.agents ?? ([...new Set(allContainers.map((c) => c.agent).filter(Boolean))].sort() as string[]);
  const trucks = data?.facets?.trucks ?? ([...new Set(allContainers.map((c) => c.numberPlate).filter(Boolean))].sort() as string[]);
  const locations = data?.facets?.locations ?? ([...new Set(allContainers.map((c) => c.trackingLocation).filter(Boolean))].sort() as string[]);
  const allEtaDates = data?.facets?.etaDates ?? ([...new Set(allContainers.map((c) => c.eta).filter(Boolean))].sort() as string[]);
  const hasContainersWithNoEta = data?.facets?.hasContainersWithNoEta ?? allContainers.some((c) => !c.eta);'''
source = replace_once(source, old_summary, new_summary, "container summary/facets")
old_drawer = '''  function openDrawer(c: EnrichedContainerRow) {
    setDrawerContainer(c);
    setDrawerOpen(true);
  }'''
new_drawer = '''  async function openDrawer(c: EnrichedContainerRow) {
    setDrawerContainer(c);
    setDrawerOpen(true);
    try {
      const detail = await loadContainerDetail(c.id);
      setDrawerContainer((current) => (current?.id === c.id ? detail : current));
    } catch (detailError: any) {
      toast({ title: "Failed to load container details", description: detailError.message, variant: "destructive" });
    }
  }'''
source = replace_once(source, old_drawer, new_drawer, "lazy container drawer")
reset_effect = '''
  useEffect(() => {
    setPage(1);
  }, [
    allCompanies,
    companyFilter,
    containerFilters.join(","),
    supplierFilters.join(","),
    transporterFilters.join(","),
    agentFilters.join(","),
    truckFilters.join(","),
    locationFilters.join(","),
    docsFilter,
    delayedFilter,
    freightFilter,
    etaFilter === "ALL" ? "ALL" : JSON.stringify(etaFilter),
    notesFilter,
    sortOrder,
    search,
  ]);
'''
marker = '  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {'
if reset_effect.strip() not in source:
    if marker not in source:
        raise RuntimeError("Could not find container page reset marker")
    source = source.replace(marker, reset_effect + '\n' + marker, 1)
old_table = '''        <div className="flex-1 min-h-0">
          <ContainerTable
            containers={filteredContainers}
            colVis={colVis}
            sessionCompanyId={sessionCompanyId}
            onOpenDrawer={openDrawer}
            printRef={printRef}
          />
        </div>'''
new_table = '''        <div className="flex-1 min-h-0">
          <ContainerTable
            containers={filteredContainers}
            colVis={colVis}
            sessionCompanyId={sessionCompanyId}
            onOpenDrawer={openDrawer}
            printRef={printRef}
          />
        </div>
        <PaginationBar
          page={data?.page ?? page}
          totalPages={data?.totalPages ?? 0}
          total={data?.total ?? 0}
          pageSize={data?.pageSize ?? CONTAINER_PAGE_SIZE}
          onPageChange={setPage}
          noun="containers"
        />'''
source = replace_once(source, old_table, new_table, "container pagination controls")
write(path, source)

# ---------------------------------------------------------------------------
# Phase 5: strict, paginated lightweight voucher rows for Daybook.
# ---------------------------------------------------------------------------
path = "server/routes/vouchers/voucherQueryRoutes.ts"
source = read(path)
source = replace_once(
    source,
    'import { isParentCompanyContext } from "../helpers/supplierBalanceHelpers";\n',
    '''import { isParentCompanyContext } from "../helpers/supplierBalanceHelpers";
import { buildVoucherPage, filterAndSortVouchers, parseVoucherListQuery } from "./voucherListPaging";
import { loadVoucherRelatedData } from "./voucherDetailBatching";
''',
    "voucher paging/batching imports",
)
source = replace_once(
    source,
    '      const { startDate, endDate } = req.query;\n',
    '''      const parsedListQuery = parseVoucherListQuery(req.query as Record<string, unknown>);
      if (!parsedListQuery.ok) return res.status(400).json({ message: parsedListQuery.message });
      const listQuery = parsedListQuery.query;
      const { startDate, endDate } = listQuery;
''',
    "strict voucher dates",
)
source = replace_once(
    source,
    '      res.json(sanitizedVouchers);\n',
    '''      const filteredVouchers = filterAndSortVouchers(sanitizedVouchers as any[], listQuery);
      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=30");
      if (!listQuery.paginated) return res.json(filteredVouchers);
      return res.json(buildVoucherPage(filteredVouchers, listQuery.page, listQuery.pageSize));
''',
    "paginated voucher response",
)
pattern = r'''      const entries = await storage\.getVoucherEntriesByVoucher\(id\);\n.*?      // For credit sales, resolve customer name from the voucher entries\.'''
replacement = '''      const [entries, relatedData] = await Promise.all([
        storage.getVoucherEntriesByVoucher(id),
        loadVoucherRelatedData(voucher),
      ]);
      const { purchaseOrder, salesItems: salesItemsList, adjustmentData, transferData } = relatedData;

      // For credit sales, resolve customer name from the voucher entries.'''
source = regex_replace_once(source, pattern, replacement, "batched voucher detail block")
write(path, source)

path = "client/src/pages/Daybook.tsx"
source = read(path)
source = replace_once(
    source,
    'import { PageHeader } from "@/components/PageHeader";\n',
    'import { PageHeader } from "@/components/PageHeader";\nimport { PaginationBar } from "@/components/PaginationBar";\n',
    "Daybook pagination import",
)
source = replace_once(
    source,
    'import { VoucherEditDialog } from "./daybook/VoucherEditDialog";\n',
    'import { VoucherEditDialog } from "./daybook/VoucherEditDialog";\nimport { usePaginatedDaybookVouchers } from "./daybook/usePaginatedDaybookVouchers";\n',
    "Daybook query hook import",
)
source = replace_once(
    source,
    '  const DAYBOOK_PAGE_SIZE = 200;\n  const [daybookRowLimit, setDaybookRowLimit] = useState(DAYBOOK_PAGE_SIZE);\n',
    '''  const DAYBOOK_PAGE_SIZE = 200;
  const VOUCHER_PAGE_SIZE = 100;
  const [voucherPage, setVoucherPage] = useState(1);
  const [daybookRowLimit, setDaybookRowLimit] = useState(DAYBOOK_PAGE_SIZE);
''',
    "Daybook page state",
)
old_voucher_query = '''  const [accountNameCache] = useState<Record<number, string>>({});
  const { data: vouchers = [], isLoading } = useQuery<Voucher[]>({
    queryKey: ["/api/vouchers", selectedCompany?.id, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (periodFilter.fromDate) p.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) p.append("endDate", periodFilter.toDate);
      const res = await fetch(`/api/vouchers${p.toString() ? `?${p.toString()}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedCompany,
  });'''
new_voucher_query = '''  const [accountNameCache] = useState<Record<number, string>>({});
  const { response: voucherPageResponse, vouchers, isLoading } = usePaginatedDaybookVouchers({
    companyId: selectedCompany?.id,
    fromDate: periodFilter.fromDate,
    toDate: periodFilter.toDate,
    filters,
    page: voucherPage,
    pageSize: VOUCHER_PAGE_SIZE,
  });

  useEffect(() => {
    setVoucherPage(1);
    setDaybookRowLimit(DAYBOOK_PAGE_SIZE);
  }, [
    selectedCompany?.id,
    periodFilter.fromDate,
    periodFilter.toDate,
    filters.voucherType,
    filters.searchQuery,
    filters.sortOrder,
    filters.minAmount,
    filters.maxAmount,
    filters.statusFilter,
  ]);'''
source = replace_once(source, old_voucher_query, new_voucher_query, "Daybook paginated query")
source = replace_once(
    source,
    '      ...offloads.map((o) => ({ _type: "offload" as const, data: o })),\n',
    '      ...(voucherPage === 1 ? offloads.map((o) => ({ _type: "offload" as const, data: o })) : []),\n',
    "Daybook offload page boundary",
)
old_daybook_table = '''          <DaybookTable
            displayedRows={displayedRows}
            visibleRows={visibleRows}
            viewMode={viewMode}
            selectedRowId={selectedRowId}
            setSelectedRowId={setSelectedRowId}
            hiddenRowIds={hiddenRowIds}
            setHiddenRowIds={setHiddenRowIds}
            showHidden={showHidden}
            expandedVoucherId={expandedVoucherId}
            setExpandedVoucherId={setExpandedVoucherId}
            expandedCondensedGroups={expandedCondensedGroups}
            setExpandedCondensedGroups={setExpandedCondensedGroups}
            hideAmounts={hideAmounts}
            accountNameCache={accountNameCache}
            expandedLoading={expandedLoading}
            expandedEntries={expandedEntries}
            formatAmount={formatAmount}
            formatDisplayDate={formatDisplayDate}
            formatDisplayTime={formatDisplayTime}
            handleView={handleView}
            handleEdit={handleEdit}
            handleDelete={(v) => {
              setVoucherToDelete(v);
              setDeleteDialogOpen(true);
            }}
            canEdit={canEdit}
            canDelete={canDelete}
            daybookRowLimit={daybookRowLimit}
            setDaybookRowLimit={setDaybookRowLimit}
            DAYBOOK_PAGE_SIZE={DAYBOOK_PAGE_SIZE}
            navigate={navigate}
          />'''
new_daybook_table = old_daybook_table + '''
          <PaginationBar
            page={voucherPageResponse?.page ?? voucherPage}
            totalPages={voucherPageResponse?.totalPages ?? 0}
            total={voucherPageResponse?.total ?? 0}
            pageSize={voucherPageResponse?.pageSize ?? VOUCHER_PAGE_SIZE}
            onPageChange={(nextPage) => {
              setVoucherPage(nextPage);
              setDaybookRowLimit(DAYBOOK_PAGE_SIZE);
            }}
            noun="vouchers"
          />'''
source = replace_once(source, old_daybook_table, new_daybook_table, "Daybook pagination controls")
write(path, source)

print("Bandwidth Phases 5 and 6 source implementation applied.")
