import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];

function requireText(relativePath, text, label = text) {
  const contents = read(relativePath);
  if (!contents.includes(text)) failures.push(`${relativePath}: missing ${label}`);
  return contents;
}

function forbidText(relativePath, text, label = text) {
  const contents = read(relativePath);
  if (contents.includes(text)) failures.push(`${relativePath}: contains forbidden ${label}`);
  return contents;
}

const context = requireText(
  "client/src/contexts/CompanyContext.tsx",
  "createCompanySwitchQueue",
  "serialized switch queue",
);
for (const invariant of [
  "cancelCompanySessionQueries(queryClient)",
  "removeCompanySessionQueries(queryClient)",
  "const ok = await switchCompanyOnServer(company.id)",
  "commitCompanySelection(company, { prefetch: true, serverSynced: true })",
  "commitCompanySelection(company, { prefetch: false, serverSynced: false })",
  "scheduleInitialSyncRetry",
  "refetchType: \"active\"",
]) {
  if (!context.includes(invariant)) {
    failures.push(`client/src/contexts/CompanyContext.tsx: missing ${invariant}`);
  }
}
if (context.includes("invalidateCompanyQueries")) {
  failures.push("client/src/contexts/CompanyContext.tsx: legacy invalidate-only switch boundary remains");
}

const selector = read("client/src/components/CompanySelector.tsx");
for (const invariant of [
  "await selectCompany(company",
  "{ offline: true }",
  "The server did not accept the workspace change",
]) {
  if (!selector.includes(invariant)) {
    failures.push(`client/src/components/CompanySelector.tsx: missing ${invariant}`);
  }
}
for (const forbidden of [
  "window.location.reload",
  'apiRequest("POST", "/api/auth/set-company"',
]) {
  if (selector.includes(forbidden)) {
    failures.push(`client/src/components/CompanySelector.tsx: contains forbidden ${forbidden}`);
  }
}

const appRoot = read("client/src/App.tsx");
for (const invariant of [
  "function AuthenticatedRoot()",
  "useAuthenticatedUser()",
  "if (isLoading || !user) return <AppLoadingState />;",
  "<CompanyProvider>",
  "<AuthenticatedApp user={user} handleLogout={handleLogout} />",
]) {
  if (!appRoot.includes(invariant)) {
    failures.push(`client/src/App.tsx: missing ${invariant}`);
  }
}
const authLoadingGuard = appRoot.indexOf("if (isLoading || !user) return <AppLoadingState />;");
const protectedProvider = appRoot.indexOf("<CompanyProvider>", authLoadingGuard);
if (authLoadingGuard < 0 || protectedProvider <= authLoadingGuard) {
  failures.push("client/src/App.tsx: protected providers are not behind the verified-session guard");
}

const app = read("client/src/app/AuthenticatedApp.tsx");
for (const invariant of [
  "if (companyLoading || !selectedCompany) return <AppLoadingState />;",
  "userPresent: true",
  "interface AuthenticatedAppProps",
]) {
  if (!app.includes(invariant)) {
    failures.push(`client/src/app/AuthenticatedApp.tsx: missing ${invariant}`);
  }
}
if (app.includes("useAuthenticatedUser(")) {
  failures.push("client/src/app/AuthenticatedApp.tsx: duplicated authenticated-user query remains");
}

const appData = read("client/src/app/useAuthenticatedAppData.ts");
for (const invariant of [
  'companyQueryKey("/api/company-settings", selectedCompanyId)',
  'companyQueryKey("/api/factory/my-access", selectedCompanyId)',
  'companyQueryKey("/api/factory/settings", selectedCompanyId)',
]) {
  if (!appData.includes(invariant)) {
    failures.push(`client/src/app/useAuthenticatedAppData.ts: missing ${invariant}`);
  }
}

const scope = read("client/src/lib/companyQueryScope.ts");
for (const invariant of [
  "companyQueryKey",
  "isGlobalQueryKey",
  "isCompanySessionQueryKey",
  "cancelCompanySessionQueries",
  "removeCompanySessionQueries",
  '"/api/auth/me"',
  '"/api/user/companies"',
]) {
  if (!scope.includes(invariant)) {
    failures.push(`client/src/lib/companyQueryScope.ts: missing ${invariant}`);
  }
}

const queue = read("client/src/lib/companySwitchQueue.ts");
for (const invariant of ["tail.then(task)", "queuedTasks", "isBusy()", "result.finally"]) {
  if (!queue.includes(invariant)) {
    failures.push(`client/src/lib/companySwitchQueue.ts: missing ${invariant}`);
  }
}

const transferPage = read("client/src/pages/CompanyTransfer.tsx");
for (const invariant of [
  "companyKeys.simpleTransfers(fromCompanyId)",
  "companyKeys.companyAccounts(fromCompanyId, fromCompanyId)",
  "companyKeys.companyAccounts(fromCompanyId, ruleDestCompanyId || null)",
  "companyKeys.autoTransferConfig(fromCompanyId",
]) {
  if (!transferPage.includes(invariant)) {
    failures.push(`client/src/pages/CompanyTransfer.tsx: missing ${invariant}`);
  }
}
if (transferPage.includes('queryKey: ["/api/simple-company-transfers"]')) {
  failures.push("client/src/pages/CompanyTransfer.tsx: unscoped transfer history key remains");
}

for (const testPath of [
  "tests/ui/company-query-scope.test.ts",
  "tests/ui/company-switch-queue.test.ts",
  "tests/ui/company-state-isolation.test.ts",
  "tests/ui/queryKeys.test.ts",
  "tests/ui/authenticated-request-gating.test.ts",
]) {
  if (!fs.existsSync(path.join(root, testPath))) failures.push(`missing focused test: ${testPath}`);
}

const completion = read("docs/archive/engineering/phase4-frontend-company-state-isolation.md");
const normalizedCompletion = completion.toLowerCase();
for (const phrase of [
  "server-authoritative switch",
  "cache eviction",
  "global workspace gate",
  "serialized company switching",
  "offline workspace switch",
  "company-scoped query keys",
  "verification boundary",
  "merge boundary",
]) {
  if (!normalizedCompletion.includes(phrase)) {
    failures.push(`docs/archive/engineering/phase4-frontend-company-state-isolation.md: missing ${phrase}`);
  }
}

forbidText(
  "client/src/components/CompanySelector.tsx",
  "localStorage.setItem",
  "selector-owned local company persistence",
);

if (failures.length > 0) {
  console.error("Phase 4 frontend company-state isolation verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 4 frontend company-state isolation contracts verified.");
