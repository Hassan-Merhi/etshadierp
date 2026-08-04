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
# Phase 7: GIT routes use explicit company memberships, never role-only scope.
# ---------------------------------------------------------------------------
path = "server/lib/gitHelpers.ts"
source = read(path)
source = replace_once(
    source,
    'import { containers, companies, userCompanyRoles, suppliers } from "../../shared/schema";\n',
    'import { containers, companies, suppliers } from "../../shared/schema";\n',
    "GIT schema imports",
)
source = replace_once(
    source,
    'import { and, eq, inArray, sql } from "drizzle-orm";\n',
    '''import { and, eq, inArray, sql } from "drizzle-orm";
import {
  CompanyAccessError,
  getAccessibleCompanyIds as getMembershipCompanyIds,
  isPrivilegedRole,
  parsePositiveCompanyId,
} from "../security/companyAccessBoundary";
''',
    "GIT company boundary import",
)
source = regex_once(
    source,
    r'''/\*\*\n \* Returns company IDs the user may access\..*?\n\}\n\n(?=/\*\*\n \* Resolves company scope)''',
    "",
    "legacy role-only GIT company lookup",
)
new_scope = '''export type GitCompanyScope =
  | { mode: "all"; companyIds: number[] }
  | { mode: "single"; companyId: number }
  | { error: string; status: number; code: string };

function gitScopeError(error: unknown): Extract<GitCompanyScope, { error: string }> {
  if (error instanceof CompanyAccessError) {
    return { error: error.message, status: error.status, code: error.code };
  }
  return { error: "Unable to resolve company access", status: 500, code: "COMPANY_CONTEXT_FAILED" };
}

export async function resolveGitCompanyScope(
  userId: string,
  role: string,
  query: Record<string, string | string[] | undefined>,
  sessionCompanyId: number | undefined
): Promise<GitCompanyScope> {
  try {
    const wantsAll = query.allCompanies === "true";
    const rawId = typeof query.companyId === "string" ? query.companyId.trim() : "";
    const activeCompanyId = parsePositiveCompanyId(sessionCompanyId, "activeCompanyId");
    const accessible = await getMembershipCompanyIds(userId);

    if (wantsAll) {
      if (!isPrivilegedRole(role)) {
        return {
          error: "Cross-company access requires a privileged role",
          status: 403,
          code: "CROSS_COMPANY_FORBIDDEN",
        };
      }
      return { mode: "all", companyIds: [...accessible].sort((left, right) => left - right) };
    }

    if (rawId) {
      const requestedId = parsePositiveCompanyId(rawId, "requestedCompanyId");
      if (requestedId !== activeCompanyId && !isPrivilegedRole(role)) {
        return {
          error: "Cross-company access requires a privileged role",
          status: 403,
          code: "CROSS_COMPANY_FORBIDDEN",
        };
      }
      if (!accessible.has(requestedId)) {
        return { error: "No access to this company", status: 403, code: "COMPANY_ACCESS_DENIED" };
      }
      return { mode: "single", companyId: requestedId };
    }

    if (!accessible.has(activeCompanyId)) {
      return { error: "No access to this company", status: 403, code: "COMPANY_ACCESS_DENIED" };
    }
    return { mode: "single", companyId: activeCompanyId };
  } catch (error) {
    return gitScopeError(error);
  }
}'''
source = regex_once(
    source,
    r'''export async function resolveGitCompanyScope\(.*?\n\}\n\n(?=// ── Calculation helpers)''',
    new_scope + "\n\n",
    "GIT company scope resolver",
)
write(path, source)

path = "server/routes/git/gitReportRoutes.ts"
source = read(path)
for obsolete in [
    'import { db } from "../../db";\n',
    'import { containers, companies, userCompanyRoles } from "../../../shared/schema";\n',
    'import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";\n',
]:
    source = source.replace(obsolete, "")
new_agent_route = '''  app.get("/api/git/agent-duty-summary", requireAuth, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const userId = String((req.user as any).id);
      const role = String((req.session as any)?.currentRole ?? (req.user as any).role ?? "");
      const sessionCompanyId: number | undefined = (req.session as any)?.currentCompanyId;
      const scope = await resolveGitCompanyScope(
        userId,
        role,
        req.query as Record<string, string | string[] | undefined>,
        sessionCompanyId,
      );
      if ("error" in scope) {
        return res.status(scope.status).json({ message: scope.error, code: scope.code });
      }

      const asOf = new Date().toISOString();
      if (scope.mode === "all") {
        const nameMap = await loadCompanyNames(scope.companyIds);
        const sections = await Promise.all(
          scope.companyIds.map(async (companyId) => ({
            companyId,
            companyName: nameMap[companyId] ?? `Company ${companyId}`,
            agents: await buildAgentsForCompany(companyId),
          })),
        );
        sections.sort((left, right) => left.companyId - right.companyId);
        return res.json({ asOf, mode: "all", companies: sections });
      }

      const nameMap = await loadCompanyNames([scope.companyId]);
      return res.json({
        asOf,
        mode: "single",
        companyId: scope.companyId,
        companyName: nameMap[scope.companyId] ?? `Company ${scope.companyId}`,
        agents: await buildAgentsForCompany(scope.companyId),
      });
    } catch (err) {
      logger.error("[gitRoutes] agent-duty-summary error:", { error: err });
      return res.status(500).json({ message: "Internal server error", code: "GIT_REPORT_FAILED" });
    }
  });'''
source = regex_once(
    source,
    r'''  app\.get\("/api/git/agent-duty-summary".*?\n  \}\);\n\n(?=  // ─── Shared inner helper)''',
    new_agent_route + "\n\n",
    "agent duty company scope",
)
source = source.replace(
    'res.status(scope.status).json({ message: scope.error });',
    'res.status(scope.status).json({ message: scope.error, code: scope.code });',
)
source = source.replace(
    'return res.status(scope.status).json({ message: scope.error });',
    'return res.status(scope.status).json({ message: scope.error, code: scope.code });',
)
write(path, source)

# ---------------------------------------------------------------------------
# Phase 7: voucher and offload routes assert active-company membership.
# ---------------------------------------------------------------------------
path = "server/routes/vouchers/voucherQueryRoutes.ts"
source = read(path)
source = replace_once(
    source,
    'import { loadVoucherRelatedData } from "./voucherDetailBatching";\n',
    '''import { loadVoucherRelatedData } from "./voucherDetailBatching";
import { assertActiveCompanyAccess, sendCompanyAccessError } from "../../security/companyAccessBoundary";
''',
    "voucher company boundary import",
)
source = replace_once(
    source,
    '''    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const parsedListQuery''',
    '''    try {
      const access = await assertActiveCompanyAccess(req);
      const parsedListQuery''',
    "voucher list active company",
)
source = source.replace("req.session.currentCompanyId,\n          startDate as string", "access.activeCompanyId,\n          startDate as string", 1)
source = source.replace(
    "storage.getVouchersByDateRange(req.session.currentCompanyId, fmt(start), fmt(end))",
    "storage.getVouchersByDateRange(access.activeCompanyId, fmt(start), fmt(end))",
    1,
)
source = source.replace(
    "eq(userLocations.companyId, req.session.currentCompanyId!)",
    "eq(userLocations.companyId, access.activeCompanyId)",
    1,
)
source = replace_once(
    source,
    '''    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Get unified ledger''',
    '''    } catch (error: unknown) {
      return sendCompanyAccessError(res, error);
    }
  });

  // Get unified ledger''',
    "voucher list error boundary",
)
source = replace_once(
    source,
    '''  app.get("/api/vouchers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);''',
    '''  app.get("/api/vouchers/:id", requireAuth, async (req, res) => {
    try {
      const access = await assertActiveCompanyAccess(req);
      const id = parseInt(req.params.id);''',
    "voucher detail active company",
)
source = source.replace(
    "if (voucher.companyId !== req.session.currentCompanyId) {",
    "if (voucher.companyId !== access.activeCompanyId) {",
    1,
)
source = replace_once(
    source,
    '''    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Update a voucher with entries''',
    '''    } catch (error: unknown) {
      return sendCompanyAccessError(res, error);
    }
  });

  // Update a voucher with entries''',
    "voucher detail error boundary",
)
write(path, source)

path = "server/routes/offloadRoutes.ts"
source = read(path)
source = replace_once(
    source,
    'import { getOrCreateLedgerAccount } from "./factory/_helpers";\n',
    '''import { getOrCreateLedgerAccount } from "./factory/_helpers";
import { assertActiveCompanyAccess, sendCompanyAccessError } from "../security/companyAccessBoundary";
''',
    "offload company boundary import",
)
source = replace_once(
    source,
    '''    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate } = req.query;''',
    '''    try {
      const access = await assertActiveCompanyAccess(req);
      const companyId = access.activeCompanyId;

      const { startDate, endDate } = req.query;''',
    "offload list active company",
)
source = replace_once(
    source,
    '''  app.get("/api/offloads/:id", requireAuth, async (req, res) => {
    try {
      const offloadId = parseInt(req.params.id);''',
    '''  app.get("/api/offloads/:id", requireAuth, async (req, res) => {
    try {
      const access = await assertActiveCompanyAccess(req);
      const offloadId = parseInt(req.params.id);''',
    "offload detail active company",
)
source = replace_once(
    source,
    '      if (!offload) return res.status(404).json({ message: "Offload not found" });\n\n      const items = await db\n',
    '''      if (!offload) return res.status(404).json({ message: "Offload not found" });
      if (offload.companyId !== access.activeCompanyId) {
        return res.status(403).json({ message: "No access to this company", code: "COMPANY_ACCESS_DENIED" });
      }

      const items = await db
''',
    "offload detail company comparison",
)
source = replace_once(
    source,
    '''    async (req, res) => {
      try {
        const offloadId = parseInt(req.params.id);''',
    '''    async (req, res) => {
      try {
        const access = await assertActiveCompanyAccess(req);
        const offloadId = parseInt(req.params.id);''',
    "offload toggle active company",
)
source = replace_once(
    source,
    '        if (!offload) return res.status(404).json({ message: "Offload not found" });\n\n        const makeOptional',
    '''        if (!offload) return res.status(404).json({ message: "Offload not found" });
        if (offload.companyId !== access.activeCompanyId) {
          return res.status(403).json({ message: "No access to this company", code: "COMPANY_ACCESS_DENIED" });
        }

        const makeOptional''',
    "offload toggle company comparison",
)
source = replace_once(
    source,
    '''        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Get container''',
    '''        const access = await assertActiveCompanyAccess(req);
        const companyId = access.activeCompanyId;

        // Get container''',
    "offload diagnostics active company",
)
source = source.replace(
    'res.status(500).json({ message: getErrorMessage(error) });',
    'return sendCompanyAccessError(res, error);',
)
write(path, source)

# ---------------------------------------------------------------------------
# Phase 8: connect paginated screens to canonical keys and exact invalidation.
# ---------------------------------------------------------------------------
path = "client/src/pages/GITContainers.tsx"
source = read(path)
source = replace_once(
    source,
    '''    usePaginatedGITContainers({
      allCompanies,''',
    '''    usePaginatedGITContainers({
      companyIdentity: allCompanies ? `all:${user?.id ?? "unknown"}` : user?.companyId ?? "no-company",
      allCompanies,''',
    "GIT company cache identity",
)
source = source.replace(
    "            value={filteredContainers.length}",
    "            value={data?.summary?.total ?? data?.total ?? filteredContainers.length}",
    1,
)
write(path, source)

path = "client/src/pages/git-containers/ContainerDrawer.tsx"
source = read(path)
source = replace_once(
    source,
    'import { apiRequest } from "@/lib/queryClient";\n',
    '''import { apiRequest } from "@/lib/queryClient";
import { invalidateApiFamily } from "@/lib/frontendDataArchitecture";
''',
    "drawer invalidation import",
)
source = source.replace(
    'queryClient.invalidateQueries({ queryKey: ["/api/git/containers"] });',
    'void invalidateApiFamily(queryClient, "/api/git/containers");',
)
write(path, source)

path = "client/src/pages/git-containers/useGITContainersData.ts"
source = read(path)
source = replace_once(
    source,
    'import { apiRequest } from "@/lib/queryClient";\n',
    '''import { apiRequest } from "@/lib/queryClient";
import { invalidateApiFamily } from "@/lib/frontendDataArchitecture";
''',
    "GIT mutation invalidation import",
)
source = source.replace(
    'queryClient.invalidateQueries({ queryKey: ["/api/git/containers"] });',
    'void invalidateApiFamily(queryClient, "/api/git/containers");',
)
write(path, source)

path = "client/src/pages/Daybook.tsx"
source = read(path)
source = replace_once(
    source,
    'import { apiRequest, queryClient } from "@/lib/queryClient";\n',
    '''import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  canonicalApiUrl,
  companyDataKey,
  frontendQueryPolicies,
  invalidateCompanyApiFamily,
} from "@/lib/frontendDataArchitecture";
''',
    "Daybook data architecture import",
)
old_offloads = '''  const { data: offloads = [], isLoading: offloadsLoading } = useQuery<OffloadListItem[]>({
    queryKey: ["/api/offloads", selectedCompany?.id, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (periodFilter.fromDate) p.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) p.append("endDate", periodFilter.toDate);
      const res = await fetch(`/api/offloads${p.toString() ? `?${p.toString()}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedCompany,
  });'''
new_offloads = '''  const offloadsUrl = useMemo(
    () =>
      canonicalApiUrl("/api/offloads", {
        startDate: periodFilter.fromDate,
        endDate: periodFilter.toDate,
      }),
    [periodFilter.fromDate, periodFilter.toDate],
  );
  const { data: offloads = [], isLoading: offloadsLoading } = useQuery<OffloadListItem[]>({
    queryKey: companyDataKey(offloadsUrl, selectedCompany?.id, "daybook-offloads"),
    queryFn: async ({ signal }) => {
      const response = await fetch(offloadsUrl, { credentials: "include", signal });
      if (!response.ok) throw new Error("Failed to load offloads");
      return response.json();
    },
    enabled: !!selectedCompany,
    ...frontendQueryPolicies.operational,
  });'''
source = replace_once(source, old_offloads, new_offloads, "Daybook offload query identity")
source = source.replace(
    'queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });',
    'void invalidateCompanyApiFamily(queryClient, "/api/vouchers", selectedCompany?.id);',
)
write(path, source)

print("Bandwidth Phases 7 and 8 integration applied.")
