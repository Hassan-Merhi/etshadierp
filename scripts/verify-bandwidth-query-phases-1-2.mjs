#!/usr/bin/env node
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const appData = read("client/src/app/useAuthenticatedAppData.ts");
const erpSidebar = read("client/src/components/AppSidebar.tsx");
const factorySidebar = read("client/src/components/FactorySidebar.tsx");
const notifications = read("client/src/components/NotificationsCenter.tsx");
const companyContext = read("client/src/contexts/CompanyContext.tsx");
const queryClient = read("client/src/lib/queryClient.ts");
const policies = read("client/src/lib/queryPolicies.ts");
const presence = read("client/src/hooks/use-presence.ts");

const failures = [];
const requireText = (source, value, label) => {
  if (!source.includes(value)) failures.push(label);
};
const forbidText = (source, value, label) => {
  if (source.includes(value)) failures.push(label);
};

requireText(policies, "refetchIntervalInBackground: false", "live polling must pause in background tabs");
requireText(policies, "return () =>", "visibility callback must remain query-type agnostic");
requireText(policies, "stableReferenceQueryPolicy", "stable reference-data policy missing");
requireText(queryClient, "STABLE_REFERENCE_QUERY_PREFIXES", "central reference-data defaults missing");
requireText(queryClient, '"/api/stock-categories"', "stock categories are not centrally cached");
requireText(queryClient, "queryClient.setQueryDefaults([prefix], stableReferenceQueryPolicy)", "reference defaults are not registered");
requireText(companyContext, "queryKey: [url], ...stableReferenceQueryPolicy", "reference prefetch does not share URL-only form keys");
requireText(companyContext, '"/api/stock-groups"', "stock groups are not prefetched");
requireText(companyContext, '"/api/stock-categories"', "stock categories are not prefetched");
requireText(companyContext, '"/api/stock-grades"', "stock grades are not prefetched");
requireText(appData, 'companyQueryKey("/api/chat/unread-count"', "authenticated chat count is not company scoped");
requireText(appData, "stableSettingsQueryPolicy", "authenticated settings policy missing");
requireText(erpSidebar, 'companyQueryKey("/api/chat/unread-count"', "ERP chat count is not company scoped");
requireText(erpSidebar, 'companyQueryKey("/api/company-settings"', "ERP settings are not shared/company scoped");
requireText(erpSidebar, 'companyQueryKey("/api/my-erp-pages"', "ERP access is not company scoped");
requireText(erpSidebar, "liveCountQueryPolicy(60_000)", "ERP live-count policy missing");
requireText(factorySidebar, 'companyQueryKey("/api/chat/unread-count"', "Factory chat count is not company scoped");
requireText(factorySidebar, 'companyQueryKey("/api/factory/settings"', "Factory settings are not company scoped");
requireText(factorySidebar, 'companyQueryKey("/api/factory/my-access"', "Factory access is not company scoped");
requireText(factorySidebar, "liveCountQueryPolicy(60_000)", "Factory live-count policy missing");
requireText(notifications, 'companyQueryKey("/api/notifications/unread-count"', "notification count is not company scoped");
requireText(notifications, 'companyQueryKey("/api/intercompany-requests/pending-count"', "intercompany count is not company scoped");
requireText(notifications, "liveCountQueryPolicy(60_000)", "notification polling was not increased and hidden-tab protected");
requireText(notifications, 'enabled: open && activeTab !== "intercompany" && !!companyId', "notification details load while closed");
requireText(notifications, 'enabled: open && activeTab === "intercompany" && !!companyId', "intercompany details load while closed");
requireText(notifications, 'refetchType: "active"', "notification mutations do not limit refetches to active queries");
requireText(notifications, "stableReferenceQueryPolicy", "destination account selector does not use shared reference cache");
requireText(presence, "const HEARTBEAT_INTERVAL = 90000", "presence interval regressed below 90 seconds");
requireText(presence, 'document.visibilityState === "visible"', "presence does not pause in hidden tabs");
forbidText(erpSidebar, 'queryKey: ["/api/chat/unread-count"]', "unscoped ERP chat query remains");
forbidText(factorySidebar, 'queryKey: ["/api/chat/unread-count"]', "unscoped Factory chat query remains");
forbidText(erpSidebar, "refetchInterval: 60000", "raw ERP sidebar polling remains");
forbidText(factorySidebar, "refetchInterval: 60000", "raw Factory sidebar polling remains");
forbidText(erpSidebar, "company-settings?companyId=", "duplicate raw ERP settings request remains");
forbidText(notifications, "refetchInterval: 30_000", "30-second notification polling remains");
forbidText(policies, "(_query: Query)", "generic-incompatible query callback remains");

if (failures.length) {
  console.error("Bandwidth query phases 1-2 contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({ phases: [1, 2], status: "complete", idlePolling: "visible-tab-only essential counts and presence", sharedReferenceCache: true, companyIsolation: true, sqlRequired: false }, null, 2));
