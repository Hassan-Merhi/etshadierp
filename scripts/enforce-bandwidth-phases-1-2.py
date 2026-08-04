from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not find {label}")
    return text.replace(old, new, 1)


def replace_block(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    if replacement in text:
        return text
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Could not find start of {label}")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"Could not find end of {label}")
    return text[:start] + replacement + text[end:]


# Fix the visibility callback typing and keep all polling hidden-tab aware.
path = Path("client/src/lib/queryPolicies.ts")
text = path.read_text()
text = text.replace('import type { Query } from "@tanstack/react-query";\n\n', "")
text = text.replace("  return (_query: Query) => {", "  return () => {")
path.write_text(text)

# Apply stable cache defaults centrally so existing forms with matching
# URL-prefix keys share one long-lived cache without per-form rewrites.
path = Path("client/src/lib/queryClient.ts")
text = path.read_text()
import_anchor = 'import { toast } from "@/hooks/use-toast";\n'
policy_import = (
    'import { accessQueryPolicy, stableReferenceQueryPolicy, stableSettingsQueryPolicy } '
    'from "./queryPolicies";\n'
)
if policy_import not in text:
    text = replace_once(text, import_anchor, import_anchor + policy_import, "query policy import")

defaults_block = '''\n\nexport const STABLE_REFERENCE_QUERY_PREFIXES = [
  "/api/ledger-accounts",
  "/api/locations",
  "/api/suppliers",
  "/api/customers",
  "/api/employees",
  "/api/bank-accounts",
  "/api/fixed-assets",
  "/api/stock-groups",
  "/api/stock-categories",
  "/api/stock-grades",
] as const;

export const STABLE_SETTINGS_QUERY_PREFIXES = [
  "/api/company-settings",
  "/api/factory/settings",
  "/api/user/preferences",
] as const;

export const ACCESS_QUERY_PREFIXES = ["/api/my-erp-pages", "/api/factory/my-access"] as const;

for (const prefix of STABLE_REFERENCE_QUERY_PREFIXES) {
  queryClient.setQueryDefaults([prefix], stableReferenceQueryPolicy);
}
for (const prefix of STABLE_SETTINGS_QUERY_PREFIXES) {
  queryClient.setQueryDefaults([prefix], stableSettingsQueryPolicy);
}
for (const prefix of ACCESS_QUERY_PREFIXES) {
  queryClient.setQueryDefaults([prefix], accessQueryPolicy);
}
'''
query_client_end = '''export const queryClient = new QueryClient({
  queryCache: globalQueryCache,
  mutationCache: globalMutationCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});'''
if "STABLE_REFERENCE_QUERY_PREFIXES" not in text:
    text = replace_once(text, query_client_end, query_client_end + defaults_block, "central query defaults")
path.write_text(text)

# Make reference-data prefetch use the exact URL-only keys used by the
# existing forms, with the same long-lived cache policy.
path = Path("client/src/contexts/CompanyContext.tsx")
text = path.read_text()
text = text.replace("  companyQueryKey,\n", "")
policy_import = 'import { stableReferenceQueryPolicy } from "@/lib/queryPolicies";\n'
switch_import = 'import { createCompanySwitchQueue, type CompanySwitchQueue } from "@/lib/companySwitchQueue";\n'
if policy_import not in text:
    text = replace_once(text, switch_import, policy_import + switch_import, "CompanyContext policy import")
text = replace_once(
    text,
    '''  "/api/fixed-assets",\n] as const;''',
    '''  "/api/fixed-assets",\n  "/api/stock-groups",\n  "/api/stock-categories",\n  "/api/stock-grades",\n] as const;''',
    "reference prefetch keys",
)
text = replace_once(
    text,
    "    queryClient.prefetchQuery({ queryKey: companyQueryKey(url, companyId) });",
    "    queryClient.prefetchQuery({ queryKey: [url], ...stableReferenceQueryPolicy });",
    "reference prefetch policy",
)
text = text.replace("function prefetchReferenceData(companyId: number, role?: string)", "function prefetchReferenceData(_companyId: number, role?: string)")
path.write_text(text)

# ERP sidebar: share settings/access/unread keys with the authenticated shell.
path = Path("client/src/components/AppSidebar.tsx")
text = path.read_text()
toast_import = 'import { useToast } from "@/hooks/use-toast";\n'
scope_import = 'import { companyQueryKey } from "@/lib/companyQueryScope";\n'
policy_import = (
    'import { accessQueryPolicy, liveCountQueryPolicy, stableSettingsQueryPolicy } '
    'from "@/lib/queryPolicies";\n'
)
if scope_import not in text:
    text = replace_once(text, toast_import, toast_import + scope_import, "ERP sidebar scope import")
if policy_import not in text:
    text = replace_once(text, scope_import, scope_import + policy_import, "ERP sidebar policy import")
text = replace_block(
    text,
    '  const { data: myErpPages } = useQuery<{ pageKeys: string[]; fullAccess: boolean }>({',
    '\n\n  const { data: companySettings }',
    '''  const { data: myErpPages } = useQuery<{ pageKeys: string[]; fullAccess: boolean }>({
    queryKey: companyQueryKey("/api/my-erp-pages", selectedCompany?.id),
    ...accessQueryPolicy,
    enabled: !!user && !!selectedCompany?.id,
  });''',
    "ERP page access query",
)
text = replace_block(
    text,
    '  const { data: companySettings } = useQuery<any>({',
    '\n\n  const allowedPages',
    '''  const { data: companySettings } = useQuery<any>({
    queryKey: companyQueryKey("/api/company-settings", selectedCompany?.id),
    ...stableSettingsQueryPolicy,
    enabled: !!selectedCompany?.id,
  });''',
    "ERP company settings query",
)
text = replace_block(
    text,
    '  const { data: chatUnread } = useQuery<{ count: number }>({',
    '\n\n  useEffect(() => {',
    '''  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: companyQueryKey("/api/chat/unread-count", selectedCompany?.id),
    ...liveCountQueryPolicy(60_000),
    enabled: !!user && !!selectedCompany?.id,
  });''',
    "ERP unread query",
)
path.write_text(text)

# Factory sidebar: use the same company-scoped settings/access/unread cache.
path = Path("client/src/components/FactorySidebar.tsx")
text = path.read_text()
toast_import = 'import { useToast } from "@/hooks/use-toast";\n'
scope_import = 'import { companyQueryKey } from "@/lib/companyQueryScope";\n'
policy_import = (
    'import { accessQueryPolicy, liveCountQueryPolicy, stableSettingsQueryPolicy } '
    'from "@/lib/queryPolicies";\n'
)
if scope_import not in text:
    text = replace_once(text, toast_import, toast_import + scope_import, "Factory sidebar scope import")
if policy_import not in text:
    text = replace_once(text, scope_import, scope_import + policy_import, "Factory sidebar policy import")
hook_marker = '''} {\n  const isDeveloper = user?.role === "Developer";'''
hook_replacement = '''} {\n  const { selectedCompany } = useCompany();\n  const isDeveloper = user?.role === "Developer";'''
text = replace_once(text, hook_marker, hook_replacement, "Factory company scope")
text = replace_block(
    text,
    '  const { data: settings } = useQuery<any>({',
    '\n\n  const { data: myAccess }',
    '''  const { data: settings } = useQuery<any>({
    queryKey: companyQueryKey("/api/factory/settings", selectedCompany?.id),
    queryFn: async () => {
      const r = await fetch("/api/factory/settings");
      return r.ok ? r.json() : {};
    },
    ...stableSettingsQueryPolicy,
    enabled: !!user && !!selectedCompany?.id,
  });''',
    "Factory settings query",
)
text = replace_block(
    text,
    '  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hiddenCostFields: string[] }>({',
    '\n\n  const isPinnedVisible',
    '''  const { data: myAccess } = useQuery<{
    fullAccess: boolean;
    pageKeys: string[];
    hiddenCostFields: string[];
  }>({
    queryKey: companyQueryKey("/api/factory/my-access", selectedCompany?.id),
    ...accessQueryPolicy,
    enabled: !!user && !!selectedCompany?.id,
  });''',
    "Factory access query",
)
component_marker = '''export function FactorySidebar({ user }: { user?: any }) {\n  const { toast } = useToast();\n  const { conflictCount } = useConnectivity();'''
component_replacement = '''export function FactorySidebar({ user }: { user?: any }) {\n  const { toast } = useToast();\n  const { conflictCount } = useConnectivity();\n  const { selectedCompany } = useCompany();'''
text = replace_once(text, component_marker, component_replacement, "Factory sidebar company context")
text = replace_block(
    text,
    '  const { data: chatUnread } = useQuery<{ count: number }>({',
    '\n\n  useEffect(() => {',
    '''  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: companyQueryKey("/api/chat/unread-count", selectedCompany?.id),
    ...liveCountQueryPolicy(60_000),
    enabled: !!user && !!selectedCompany?.id,
  });''',
    "Factory unread query",
)
text = text.replace(
    '  const { selectedCompany } = useCompany();\n  const recentItems = useRecentNav',
    '  const recentItems = useRecentNav',
    1,
)
path.write_text(text)

# Notifications: slower visible-tab-only count polling; lists poll only while open.
path = Path("client/src/components/NotificationsCenter.tsx")
text = path.read_text()
api_import = 'import { apiRequest } from "@/lib/queryClient";\n'
scope_import = 'import { companyQueryKey } from "@/lib/companyQueryScope";\n'
policy_import = 'import { liveCountQueryPolicy, stableReferenceQueryPolicy } from "@/lib/queryPolicies";\n'
if scope_import not in text:
    text = replace_once(text, api_import, api_import + scope_import, "notification scope import")
if policy_import not in text:
    text = replace_once(text, scope_import, scope_import + policy_import, "notification policy import")
text = replace_block(
    text,
    '  const { data: unreadData } = useQuery<{ count: number }>({',
    '\n\n  const { data: icCountData }',
    '''  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: companyQueryKey("/api/notifications/unread-count", companyId),
    queryFn: async () => {
      const r = await fetch("/api/notifications/unread-count", { credentials: "include" });
      return r.ok ? r.json() : { count: 0 };
    },
    ...liveCountQueryPolicy(60_000),
    enabled: !!companyId,
  });''',
    "notification unread count",
)
text = replace_block(
    text,
    '  const { data: icCountData } = useQuery<{ count: number }>({',
    '\n\n  const totalBadge',
    '''  const { data: icCountData } = useQuery<{ count: number }>({
    queryKey: companyQueryKey("/api/intercompany-requests/pending-count", companyId),
    queryFn: async () => {
      const r = await fetch("/api/intercompany-requests/pending-count", { credentials: "include" });
      return r.ok ? r.json() : { count: 0 };
    },
    ...liveCountQueryPolicy(60_000),
    enabled: !!companyId,
  });''',
    "intercompany count",
)
text = text.replace(
    '  const qKey = ["/api/notifications", activeTab, companyId];',
    '  const qKey = companyQueryKey("/api/notifications", companyId, activeTab);',
)
text = replace_once(
    text,
    '''    enabled: open && activeTab !== "intercompany",\n    refetchInterval: 30_000,\n  });''',
    '''    ...liveCountQueryPolicy(60_000),\n    enabled: open && activeTab !== "intercompany" && !!companyId,\n  });''',
    "notification list polling",
)
text = replace_once(
    text,
    '    queryKey: ["/api/intercompany-requests", "pending"],',
    '    queryKey: companyQueryKey("/api/intercompany-requests", companyId, "pending"),',
    "intercompany list key",
)
text = replace_once(
    text,
    '''    enabled: open && activeTab === "intercompany",\n    refetchInterval: 30_000,\n  });''',
    '''    ...liveCountQueryPolicy(60_000),\n    enabled: open && activeTab === "intercompany" && !!companyId,\n  });''',
    "intercompany list polling",
)
text = replace_once(
    text,
    '    queryKey: ["/api/ledger-accounts", approveReq?.destCompanyId],',
    '    queryKey: companyQueryKey("/api/ledger-accounts", approveReq?.destCompanyId),',
    "destination account key",
)
text = replace_once(
    text,
    '''    enabled: !!approveReq,\n  });''',
    '''    ...stableReferenceQueryPolicy,\n    enabled: !!approveReq?.destCompanyId,\n  });''',
    "destination account policy",
)
text = text.replace(
    'queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });',
    'queryClient.invalidateQueries({ queryKey: ["/api/notifications"], refetchType: "active" });',
)
text = text.replace(
    'queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });',
    'queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"], refetchType: "active" });',
)
text = text.replace(
    'queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests"] });',
    'queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests"], refetchType: "active" });',
)
text = text.replace(
    'queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests/pending-count"] });',
    'queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests/pending-count"], refetchType: "active" });',
)
path.write_text(text)
