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


def regex_once(source: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count == 0:
        raise RuntimeError(f"Could not find {label}")
    return updated


# ---------------------------------------------------------------------------
# Phase 7: finish membership scoping on supplier and offload-related reads.
# ---------------------------------------------------------------------------
path = "server/routes/vouchers/voucherQueryRoutes.ts"
source = read(path)
source = replace_once(
    source,
    'import { assertActiveCompanyAccess, sendCompanyAccessError } from "../../security/companyAccessBoundary";\n',
    '''import {
  assertActiveCompanyAccess,
  getAccessibleCompanyIds,
  isPrivilegedRole,
  resolveAuthorizedCompanyId,
  sendCompanyAccessError,
} from "../../security/companyAccessBoundary";
''',
    "expanded company boundary import",
)
source = replace_once(
    source,
    '''  app.get("/api/suppliers/:supplierId/unified-ledger", requireAuth, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.supplierId);''',
    '''  app.get("/api/suppliers/:supplierId/unified-ledger", requireAuth, async (req, res) => {
    try {
      const access = await assertActiveCompanyAccess(req);
      const supplierId = parseInt(req.params.supplierId);''',
    "unified ledger active company",
)
old_unified_scope = '''      const { companyId, startDate, endDate } = req.query;
      const filterCompanyId = companyId ? parseInt(companyId as string) : undefined;

      // Get voucher entries (filtered by company if specified)
      const voucherEntries = await storage.getVoucherEntriesBySupplier(
        supplierId,
        filterCompanyId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      // Get all companies to map IDs to names
      const companies = await storage.getAllCompanies();
      const companyMap = new Map(companies.map((c) => [c.id, c]));'''
new_unified_scope = '''      const { companyId, startDate, endDate } = req.query;
      const companyIds = companyId
        ? [await resolveAuthorizedCompanyId(req, companyId)]
        : isPrivilegedRole(access.role)
          ? [...(await getAccessibleCompanyIds(access.userId))].sort((left, right) => left - right)
          : [access.activeCompanyId];

      const voucherEntryGroups = await Promise.all(
        companyIds.map((allowedCompanyId) =>
          storage.getVoucherEntriesBySupplier(
            supplierId,
            allowedCompanyId,
            startDate as string | undefined,
            endDate as string | undefined,
          ),
        ),
      );
      const voucherEntries = voucherEntryGroups.flat();

      const companyRows = await Promise.all(companyIds.map((allowedCompanyId) => storage.getCompanyById(allowedCompanyId)));
      const companyMap = new Map(companyRows.filter(Boolean).map((company) => [company!.id, company!]));'''
source = replace_once(source, old_unified_scope, new_unified_scope, "unified ledger membership scope")
source = replace_once(
    source,
    '''      const sessionCompanyId = (req.session as any).currentCompanyId;
      const effectiveCompanyId = filterCompanyId ?? sessionCompanyId ?? null;
      const isParentContext = await isParentCompanyContext(effectiveCompanyId);''',
    '''      const effectiveCompanyId = companyIds.length === 1 ? companyIds[0] : access.activeCompanyId;
      const isParentContext = await isParentCompanyContext(effectiveCompanyId);''',
    "unified ledger opening company",
)
source = replace_once(
    source,
    '''          .from(containers)
          .where(inArray(containers.containerNumber, Array.from(containerNumberSet)));''',
    '''          .from(containers)
          .where(
            and(
              inArray(containers.companyId, companyIds),
              inArray(containers.containerNumber, Array.from(containerNumberSet)),
            ),
          );''',
    "unified ledger container isolation",
)
source = replace_once(
    source,
    '''    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Get purchase orders for a specific supplier filtered by company''',
    '''    } catch (error: unknown) {
      return sendCompanyAccessError(res, error);
    }
  });

  // Get purchase orders for a specific supplier filtered by company''',
    "unified ledger error boundary",
)
source = replace_once(
    source,
    '''  app.get("/api/suppliers/:supplierId/purchase-orders", requireAuth, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.supplierId);''',
    '''  app.get("/api/suppliers/:supplierId/purchase-orders", requireAuth, async (req, res) => {
    try {
      const access = await assertActiveCompanyAccess(req);
      const supplierId = parseInt(req.params.supplierId);''',
    "supplier purchase order active company",
)
source = regex_once(
    source,
    r'''      const \{ companyId \} = req\.query;.*?      res\.json\(posWithCompanyName\);''',
    '''      const { companyId } = req.query;
      const companyIds = companyId
        ? [await resolveAuthorizedCompanyId(req, companyId)]
        : isPrivilegedRole(access.role)
          ? [...(await getAccessibleCompanyIds(access.userId))].sort((left, right) => left - right)
          : [access.activeCompanyId];

      const companyRows = await Promise.all(companyIds.map((allowedCompanyId) => storage.getCompanyById(allowedCompanyId)));
      const companyNameMap = new Map(
        companyRows.filter(Boolean).map((company) => [company!.id, company!.name]),
      );
      const purchaseOrderGroups = await Promise.all(
        companyIds.map(async (allowedCompanyId) => {
          const purchaseOrders = await storage.getPurchaseOrdersBySupplier(supplierId, allowedCompanyId);
          return purchaseOrders.map((purchaseOrder) => ({
            ...purchaseOrder,
            companyName: companyNameMap.get(allowedCompanyId) ?? `Company ${allowedCompanyId}`,
          }));
        }),
      );

      return res.json(purchaseOrderGroups.flat());''',
    "supplier purchase order membership scope",
)
source = replace_once(
    source,
    '''    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Create a new voucher''',
    '''    } catch (error: unknown) {
      return sendCompanyAccessError(res, error);
    }
  });

  // Create a new voucher''',
    "supplier purchase order error boundary",
)
source = replace_once(
    source,
    '''  app.get("/api/vouchers/optional", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });''',
    '''  app.get("/api/vouchers/optional", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const access = await assertActiveCompanyAccess(req);
      const companyId = access.activeCompanyId;''',
    "optional voucher active company",
)
source = replace_once(
    source,
    '''    } catch (error: unknown) {
      logger.error("Optional vouchers error:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });''',
    '''    } catch (error: unknown) {
      logger.error("Optional vouchers error:", { error });
      return sendCompanyAccessError(res, error);
    }
  });''',
    "optional voucher error boundary",
)
write(path, source)

path = "server/routes/offloadRoutes.ts"
source = read(path)
source = source.replace('import { getErrorMessage } from "../lib/httpHandlers";\n', "")
source = replace_once(
    source,
    '''        .from(vouchers)
        .where(
          or(
            like(vouchers.voucherNumber, `DUTY-${cn}-%`),''',
    '''        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, offload.companyId),
            or(
              like(vouchers.voucherNumber, `DUTY-${cn}-%`),''',
    "offload detail voucher company condition start",
)
source = replace_once(
    source,
    '''            like(vouchers.voucherNumber, `CHG-${cn}-%`)
          )
        )
        .execute();''',
    '''              like(vouchers.voucherNumber, `CHG-${cn}-%`)
            ),
          ),
        )
        .execute();''',
    "offload detail voucher company condition end",
)
source = replace_once(
    source,
    '''            .from(vouchers)
            .where(
              or(
                like(vouchers.voucherNumber, `DUTY-${cn}-%`),''',
    '''            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, offload.companyId),
                or(
                  like(vouchers.voucherNumber, `DUTY-${cn}-%`),''',
    "offload toggle voucher company condition start",
)
source = replace_once(
    source,
    '''                like(vouchers.voucherNumber, `CHG-${cn}-%`)
              )
            )
            .execute();''',
    '''                  like(vouchers.voucherNumber, `CHG-${cn}-%`)
                ),
              ),
            )
            .execute();''',
    "offload toggle voucher company condition end",
)
write(path, source)

path = "server/routes/git/gitReportRoutes.ts"
source = read(path)
source = source.replace(
    'const role: string = (req.user as any).role;',
    'const role = String((req.session as any)?.currentRole ?? (req.user as any).role ?? "");',
)
source = source.replace("Admin / Developer  → any company, any query mode", "Admin / Owner / Developer → explicitly assigned companies only")
source = source.replace("companyId=<n>       single company (Admin/Dev: any; Owner: must have access)", "companyId=<n>       single explicitly assigned company")
source = source.replace("Access: Admin / Developer (any company) | Owner (their companies only)", "Access: Admin / Owner / Developer, restricted to explicit company memberships")
write(path, source)

# ---------------------------------------------------------------------------
# Phase 8: finish company-scoped Daybook and tracking cache identities.
# ---------------------------------------------------------------------------
path = "client/src/pages/Daybook.tsx"
source = read(path)
source = replace_once(
    source,
    '''  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"], enabled: !!selectedCompany });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", selectedCompany?.id],
    enabled: !!selectedCompany,
  });
  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({
    queryKey: ["/api/fixed-assets", selectedCompany?.id],
    enabled: !!selectedCompany,
  });''',
    '''  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: companyDataKey("/api/ledger-accounts", selectedCompany?.id),
    enabled: !!selectedCompany,
    ...frontendQueryPolicies.reference,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: companyDataKey("/api/bank-accounts", selectedCompany?.id),
    enabled: !!selectedCompany,
    ...frontendQueryPolicies.reference,
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: companyDataKey("/api/suppliers", selectedCompany?.id),
    enabled: !!selectedCompany,
    ...frontendQueryPolicies.reference,
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: companyDataKey("/api/employees", selectedCompany?.id),
    enabled: !!selectedCompany,
    ...frontendQueryPolicies.reference,
  });
  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({
    queryKey: companyDataKey("/api/fixed-assets", selectedCompany?.id),
    enabled: !!selectedCompany,
    ...frontendQueryPolicies.reference,
  });''',
    "Daybook reference query identities",
)
source = replace_once(
    source,
    '''  const { data: viewVoucherEntriesRaw, isLoading: viewEntriesLoading } = useQuery<any>({
    queryKey: selectedVoucher ? [`/api/vouchers/${selectedVoucher.id}/view-entries`] : [],
    enabled: !!selectedVoucher && viewDialogOpen,
    staleTime: 0,
  });''',
    '''  const viewEntriesUrl = selectedVoucher ? `/api/vouchers/${selectedVoucher.id}/view-entries` : "";
  const { data: viewVoucherEntriesRaw, isLoading: viewEntriesLoading } = useQuery<any>({
    queryKey: selectedVoucher
      ? companyDataKey(viewEntriesUrl, selectedCompany?.id, "daybook-view-entries")
      : [],
    enabled: !!selectedVoucher && viewDialogOpen,
    ...frontendQueryPolicies.live,
  });''',
    "Daybook detail query identity",
)
source = replace_once(
    source,
    '''  const { data: expandedEntriesRaw, isLoading: expandedLoading } = useQuery<any>({
    queryKey: expandedVoucherId ? [`/api/vouchers/${expandedVoucherId}/view-entries`] : [],
    enabled: !!expandedVoucherId,
    staleTime: 0,
  });''',
    '''  const expandedEntriesUrl = expandedVoucherId ? `/api/vouchers/${expandedVoucherId}/view-entries` : "";
  const { data: expandedEntriesRaw, isLoading: expandedLoading } = useQuery<any>({
    queryKey: expandedVoucherId
      ? companyDataKey(expandedEntriesUrl, selectedCompany?.id, "daybook-expanded-entries")
      : [],
    enabled: !!expandedVoucherId,
    ...frontendQueryPolicies.live,
  });''',
    "Daybook expanded query identity",
)
source = replace_once(
    source,
    '''    queryKey:
      selectedVoucher && isStockTransferVoucher && viewDialogOpen
        ? [`/api/stock-transfers/by-voucher/${selectedVoucher.id}/revisions`]
        : [],''',
    '''    queryKey:
      selectedVoucher && isStockTransferVoucher && viewDialogOpen
        ? companyDataKey(
            `/api/stock-transfers/by-voucher/${selectedVoucher.id}/revisions`,
            selectedCompany?.id,
            "daybook-transfer-revisions",
          )
        : [],''',
    "Daybook revision query identity",
)
source = replace_once(
    source,
    '''  const { data: voucherEntries = [], isLoading: entriesLoading } = useQuery<VoucherEntry[]>({
    queryKey: voucherToEdit ? [`/api/vouchers/${voucherToEdit.id}/entries`] : [],
    enabled: !!voucherToEdit && editDialogOpen,
  });''',
    '''  const { data: voucherEntries = [], isLoading: entriesLoading } = useQuery<VoucherEntry[]>({
    queryKey: voucherToEdit
      ? companyDataKey(`/api/vouchers/${voucherToEdit.id}/entries`, selectedCompany?.id, "daybook-edit-entries")
      : [],
    enabled: !!voucherToEdit && editDialogOpen,
    ...frontendQueryPolicies.operational,
  });''',
    "Daybook edit query identity",
)
company_reset = '''
  useEffect(() => {
    setSelectedVoucher(null);
    setVoucherToEdit(null);
    setExpandedVoucherId(null);
    setViewDialogOpen(false);
    setEditDialogOpen(false);
    setVoucherPage(1);
  }, [selectedCompany?.id]);
'''
marker = '  const [purchaseOrderData, setPurchaseOrderData] = useState<any>(null);'
if company_reset.strip() not in source:
    if marker not in source:
        raise RuntimeError("Could not find Daybook company reset marker")
    source = source.replace(marker, company_reset + "\n" + marker, 1)
write(path, source)

path = "client/src/pages/git-containers/ContainerDrawer.tsx"
source = read(path)
source = replace_once(
    source,
    'import { invalidateApiFamily } from "@/lib/frontendDataArchitecture";\n',
    '''import {
  companyDataKey,
  frontendQueryPolicies,
  invalidateApiFamily,
} from "@/lib/frontendDataArchitecture";
''',
    "tracking drawer data architecture import",
)
source = replace_once(
    source,
    '''  const { data: events, isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: [eventsQueryKey],
    enabled: showEvents && !!eventsQueryKey,
    staleTime: 30_000,
  });''',
    '''  const trackingCompanyIdentity = sessionCompanyId ?? container?.companyId ?? "no-company";
  const { data: events, isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: eventsQueryKey
      ? companyDataKey(eventsQueryKey, trackingCompanyIdentity, "container-tracking-events")
      : [],
    enabled: showEvents && !!eventsQueryKey,
    ...frontendQueryPolicies.operational,
  });''',
    "tracking event company identity",
)
write(path, source)

print("Bandwidth Phases 7 and 8 completion patch applied.")
