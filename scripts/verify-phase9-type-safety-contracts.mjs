import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];

function requireText(relativePath, text) {
  const contents = read(relativePath);
  if (!contents.includes(text)) failures.push(`${relativePath}: missing ${text}`);
  return contents;
}

function forbidText(relativePath, text) {
  const contents = read(relativePath);
  if (contents.includes(text)) failures.push(`${relativePath}: contains forbidden ${text}`);
}

const contracts = read("client/src/contracts/sessionContracts.ts");
for (const invariant of [
  "SessionContractError",
  "authenticatedUserSchema",
  "userCompanyAssignmentSchema",
  "userCompaniesResponseSchema",
  "sessionCompanyResponseSchema",
  "parseAuthenticatedUser",
  "parseUserCompanies",
  "parseSessionCompany",
  "currentCompanyId",
  "currentLocationId",
  "currentPOSStation",
  "canSellNegativeStock",
  "canDeleteRecords",
  ".safeParse(value)",
]) {
  if (!contracts.includes(invariant)) failures.push(`sessionContracts.ts: missing ${invariant}`);
}

const queries = read("client/src/contracts/sessionQueryContracts.ts");
for (const invariant of [
  "authenticatedUserQueryKey",
  "userCompaniesQueryKey",
  "sessionCompanyQueryKey",
  "fetchAuthenticatedUser",
  "fetchUserCompanies",
  "fetchSessionCompany",
  "parseAuthenticatedUser",
  "parseUserCompanies",
  "parseSessionCompany",
  "authenticatedUserQueryOptions",
  "userCompaniesQueryOptions",
  "response.status === 401",
]) {
  if (!queries.includes(invariant)) failures.push(`sessionQueryContracts.ts: missing ${invariant}`);
}

const auth = read("client/src/app/useAuthenticatedUser.ts");
for (const invariant of [
  "useQuery(authenticatedUserQueryOptions())",
  "logoutError: unknown",
  "setLoadingTimedOut(false)",
]) {
  if (!auth.includes(invariant)) failures.push(`useAuthenticatedUser.ts: missing ${invariant}`);
}
forbidText("client/src/app/useAuthenticatedUser.ts", "useQuery<any>");

const company = read("client/src/contexts/CompanyContext.tsx");
for (const invariant of [
  "useQuery(userCompaniesQueryOptions())",
  "fetchSessionCompany()",
  "export interface Company",
  "companyType: CompanyType",
  "createCompanySwitchQueue",
  "cancelCompanySessionQueries(queryClient)",
  "removeCompanySessionQueries(queryClient)",
  "companyDataKey(url, companyId)",
  "error: companyAssignmentsError instanceof Error",
]) {
  if (!company.includes(invariant)) failures.push(`CompanyContext.tsx: missing ${invariant}`);
}
forbidText("client/src/contexts/CompanyContext.tsx", "useQuery<any[]>");

const selector = read("client/src/components/CompanySelector.tsx");
for (const invariant of [
  "company: Company",
  "error: unknown",
  "error: companyError",
  "button-company-selector-error",
  "Record<CompanyType",
  "await selectCompany(company",
]) {
  if (!selector.includes(invariant)) failures.push(`CompanySelector.tsx: missing ${invariant}`);
}
for (const forbidden of ["company: any", "as any", "error: any", "window.location.reload"]) {
  if (selector.includes(forbidden)) failures.push(`CompanySelector.tsx: contains forbidden ${forbidden}`);
}

const gitPage = read("client/src/pages/GITContainers.tsx");
for (const invariant of [
  "useQuery(authenticatedUserQueryOptions())",
  "const { selectedCompany } = useCompany()",
  'selectedCompany?.id ?? "no-company"',
  "error instanceof Error",
]) {
  if (!gitPage.includes(invariant)) failures.push(`GITContainers.tsx: missing ${invariant}`);
}
for (const forbidden of ["useQuery<AuthUser>", "catch (err: any)", "error as any"]) {
  if (gitPage.includes(forbidden)) failures.push(`GITContainers.tsx: contains forbidden ${forbidden}`);
}

const gitTypes = read("client/src/pages/git-containers/gitContainerTypes.ts");
if (gitTypes.includes("export interface AuthUser")) {
  failures.push("gitContainerTypes.ts: still contains duplicate AuthUser contract");
}

const authRoute = read("server/routes/auth/coreAuthRoutes.ts");
for (const invariant of [
  "currentCompanyId",
  "currentLocationId",
  "currentPOSStation",
  "assignedLocationId",
  "canSellNegativeStock",
  "posViewOnly",
  "daybookEditDays",
  "canAccessCustomers",
  "canDeleteRecords",
]) {
  if (!authRoute.includes(invariant)) failures.push(`coreAuthRoutes.ts: auth/me missing ${invariant}`);
}

for (const testPath of [
  "tests/ui/session-contracts.test.ts",
  "tests/ui/phase9-type-safety-wiring.test.ts",
]) {
  if (!fs.existsSync(path.join(root, testPath))) failures.push(`missing focused test: ${testPath}`);
}

const docs = requireText("docs/engineering/phase9-type-safety-contracts.md", "# Phase 9");
for (const phrase of [
  "Runtime validation",
  "unknown at the network boundary",
  "Shared session query contracts",
  "Authenticated user",
  "Company assignments",
  "Session company",
  "GIT integration",
  "Compatibility boundary",
  "Deferred verification",
  "Merge order",
]) {
  if (!docs.includes(phrase)) failures.push(`phase9 documentation: missing ${phrase}`);
}

if (failures.length > 0) {
  console.error("Phase 9 type-safety contract verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 9 type-safety contracts verified.");
