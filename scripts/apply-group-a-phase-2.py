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


POLICIES = '''export const QUERY_STALE_TIMES = {
  liveCount: 45_000,
  access: 5 * 60_000,
  settings: 15 * 60_000,
  referenceData: 30 * 60_000,
} as const;

export const QUERY_GC_TIMES = {
  liveCount: 10 * 60_000,
  access: 30 * 60_000,
  settings: 2 * 60 * 60_000,
  referenceData: 2 * 60 * 60_000,
} as const;

/** Poll only while this browser tab is visible. */
export function visibleTabInterval(intervalMs: number) {
  return () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return false;
    }
    return intervalMs;
  };
}

export const stableReferenceQueryPolicy = {
  staleTime: QUERY_STALE_TIMES.referenceData,
  gcTime: QUERY_GC_TIMES.referenceData,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export const stableSettingsQueryPolicy = {
  staleTime: QUERY_STALE_TIMES.settings,
  gcTime: QUERY_GC_TIMES.settings,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export const accessQueryPolicy = {
  staleTime: QUERY_STALE_TIMES.access,
  gcTime: QUERY_GC_TIMES.access,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function liveCountQueryPolicy(intervalMs = 60_000) {
  return {
    staleTime: QUERY_STALE_TIMES.liveCount,
    gcTime: QUERY_GC_TIMES.liveCount,
    refetchInterval: visibleTabInterval(intervalMs),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  } as const;
}
'''

Path("client/src/lib/queryPolicies.ts").write_text(POLICIES)

# Central endpoint-family defaults.
path = Path("client/src/lib/queryClient.ts")
text = path.read_text()
anchor = 'import { toast } from "@/hooks/use-toast";\n'
policy_import = (
    'import { accessQueryPolicy, stableReferenceQueryPolicy, stableSettingsQueryPolicy } '
    'from "./queryPolicies";\n'
)
if policy_import not in text:
    text = replace_once(text, anchor, anchor + policy_import, "query policy import")

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

# Preserve the current companyDataKey architecture while extending bootstrap coverage.
path = Path("client/src/contexts/CompanyContext.tsx")
text = path.read_text()
architecture_import = 'import { companyDataKey, frontendQueryPolicies } from "@/lib/frontendDataArchitecture";\n'
policy_import = 'import { stableReferenceQueryPolicy } from "@/lib/queryPolicies";\n'
if policy_import not in text:
    text = replace_once(text, architecture_import, architecture_import + policy_import, "CompanyContext policy import")
text = replace_once(
    text,
    '''  "/api/fixed-assets",\n] as const;''',
    '''  "/api/fixed-assets",\n  "/api/stock-groups",\n  "/api/stock-categories",\n  "/api/stock-grades",\n] as const;''',
    "reference prefetch keys",
)
text = replace_once(
    text,
    '''    void queryClient.prefetchQuery({
      queryKey: companyDataKey(url, companyId),
      ...frontendQueryPolicies.reference,
    });''',
    '''    void queryClient.prefetchQuery({
      queryKey: companyDataKey(url, companyId),
      ...stableReferenceQueryPolicy,
    });''',
    "reference prefetch policy",
)
text = text.replace(architecture_import, 'import { companyDataKey } from "@/lib/frontendDataArchitecture";\n')
path.write_text(text)

# Authenticated shell policies.
path = Path("client/src/app/useAuthenticatedAppData.ts")
text = path.read_text()
anchor = 'import { setAppTimezone } from "@/lib/queryClient";\n'
policy_import = 'import { accessQueryPolicy, liveCountQueryPolicy, stableSettingsQueryPolicy } from "@/lib/queryPolicies";\n'
if policy_import not in text:
    text = replace_once(text, anchor, anchor + policy_import, "authenticated policy import")
text = replace_block(
    text,
    '  const { data: chatUnread } = useQuery<{ count: number }>({',
    '\n\n  useEffect(() => {',
    '''  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: companyQueryKey("/api/chat/unread-count", selectedCompanyId),
    ...liveCountQueryPolicy(60_000),
    enabled: isPOS && userPresent && !!selectedCompanyId,
  });''',
    "authenticated chat polling",
)
text = replace_block(
    text,
    '  const { data: companySettings } = useQuery<any>({',
    '\n\n  useEffect(() => {',
    '''  const { data: companySettings } = useQuery<any>({
    queryKey: companyQueryKey("/api/company-settings", selectedCompanyId),
    ...stableSettingsQueryPolicy,
    enabled: userPresent && !!selectedCompanyId,
  });''',
    "authenticated company settings",
)
text = replace_block(
    text,
    '  } = useQuery<FactoryAccess>({',
    '\n\n  const { data: factorySettings }',
    '''  } = useQuery<FactoryAccess>({
    queryKey: companyQueryKey("/api/factory/my-access", selectedCompanyId),
    ...accessQueryPolicy,
    enabled: userPresent && !isPOS && !!selectedCompanyId,
    retry: 2,
  });''',
    "authenticated factory access",
)
text = replace_block(
    text,
    '  const { data: factorySettings } = useQuery<Record<string, any>>({',
    '\n\n  return {',
    '''  const { data: factorySettings } = useQuery<Record<string, any>>({
    queryKey: companyQueryKey("/api/factory/settings", selectedCompanyId),
    queryFn: async () => {
      const response = await fetch("/api/factory/settings");
      return response.ok ? response.json() : {};
    },
    ...stableSettingsQueryPolicy,
    enabled: userPresent && !isPOS && !!selectedCompanyId,
  });''',
    "authenticated factory settings",
)
path.write_text(text)

# ERP sidebar shares company-scoped cache keys with the shell.
path = Path("client/src/components/AppSidebar.tsx")
text = path.read_text()
toast_import = 'import { useToast } from "@/hooks/use-toast";\n'
scope_import = 'import { companyQueryKey } from "@/lib/companyQueryScope";\n'
policy_import = (
    'import { accessQueryPolicy, liveCountQueryPolicy, stableSettingsQueryPolicy } '
    'from "@/lib/queryPolicies";\n'
)
if scope_import not in text:
    text = replace_once(text, toast_import, toast_import + scope_import, "ERP scope import")
if policy_import not in text:
    text = replace_once(text, scope_import, scope_import + policy_import, "ERP policy import")
text = replace_block(
    text,
    '  const { data: myErpPages } = useQuery<{ pageKeys: string[]; fullAccess: boolean }>({',
    '\n\n  const { data: companySettings }',
    '''  const { data: myErpPages } = useQuery<{ pageKeys: string[]; fullAccess: boolean }>({
    queryKey: companyQueryKey("/api/my-erp-pages", selectedCompany?.id),
    ...accessQueryPolicy,
    enabled: !!user && !!selectedCompany?.id,
  });''',
    "ERP access query",
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
    "ERP settings query",
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
    "ERP chat polling",
)
path.write_text(text)

# Factory sidebar shares settings/access/unread keys with the shell.
path = Path("client/src/components/FactorySidebar.tsx")
text = path.read_text()
toast_import = 'import { useToast } from "@/hooks/use-toast";\n'
scope_import = 'import { companyQueryKey } from "@/lib/companyQueryScope";\n'
policy_import = (
    'import { accessQueryPolicy, liveCountQueryPolicy, stableSettingsQueryPolicy } '
    'from "@/lib/queryPolicies";\n'
)
if scope_import not in text:
    text = replace_once(text, toast_import, toast_import + scope_import, "Factory scope import")
if policy_import not in text:
    text = replace_once(text, scope_import, scope_import + policy_import, "Factory policy import")
text = replace_once(
    text,
    '''} {
  const isDeveloper = user?.role === "Developer";''',
    '''} {
  const { selectedCompany } = useCompany();
  const isDeveloper = user?.role === "Developer";''',
    "Factory company scope",
)
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
text = replace_once(
    text,
    '''export function FactorySidebar({ user }: { user?: any }) {
  const { toast } = useToast();
  const { conflictCount } = useConnectivity();''',
    '''export function FactorySidebar({ user }: { user?: any }) {
  const { toast } = useToast();
  const { conflictCount } = useConnectivity();
  const { selectedCompany } = useCompany();''',
    "Factory sidebar company context",
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
    "Factory chat polling",
)
text = text.replace(
    '  const { selectedCompany } = useCompany();\n  const recentItems = useRecentNav',
    '  const recentItems = useRecentNav',
    1,
)
path.write_text(text)

# Notification counts and detail lists poll only when useful.
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
    "notification count",
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
    '''    enabled: open && activeTab !== "intercompany",
    refetchInterval: 30_000,
  });''',
    '''    ...liveCountQueryPolicy(60_000),
    enabled: open && activeTab !== "intercompany" && !!companyId,
  });''',
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
    '''    enabled: open && activeTab === "intercompany",
    refetchInterval: 30_000,
  });''',
    '''    ...liveCountQueryPolicy(60_000),
    enabled: open && activeTab === "intercompany" && !!companyId,
  });''',
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
    '''    enabled: !!approveReq,
  });''',
    '''    ...stableReferenceQueryPolicy,
    enabled: !!approveReq?.destCompanyId,
  });''',
    "destination account cache",
)
for old, new in [
    ('queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });', 'queryClient.invalidateQueries({ queryKey: ["/api/notifications"], refetchType: "active" });'),
    ('queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });', 'queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"], refetchType: "active" });'),
    ('queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests"] });', 'queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests"], refetchType: "active" });'),
    ('queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests/pending-count"] });', 'queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests/pending-count"], refetchType: "active" });'),
]:
    text = text.replace(old, new)
path.write_text(text)

print("Group A Phase 2 polling and shared-cache migration applied.")
