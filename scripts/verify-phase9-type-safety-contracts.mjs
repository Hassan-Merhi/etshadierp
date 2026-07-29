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
  "authenticatedUserSchema",
  "userCompanyAssignmentSchema",
  "userCompaniesResponseSchema",
  "sessionCompanyResponseSchema",
  "parseAuthenticatedUser",
  "parseUserCompanies",
  "parseSessionCompany",
  ".safeParse(value)",
]) {
  if (!contracts.includes(invariant)) failures.push(`sessionContracts.ts: missing ${invariant}`);
}

const auth = read("client/src/app/useAuthenticatedUser.ts");
for (const invariant of [
  "useQuery<AuthenticatedUser | null>",
  "parseAuthenticatedUser(value)",
  "logoutError: unknown",
]) {
  if (!auth.includes(invariant)) failures.push(`useAuthenticatedUser.ts: missing ${invariant}`);
}
forbidText("client/src/app/useAuthenticatedUser.ts", "useQuery<any>");

const company = read("client/src/contexts/CompanyContext.tsx");
for (const invariant of [
  "useQuery<UserCompanyAssignment[]>",
  "parseUserCompanies(value)",
  "parseSessionCompany(value)",
  "export interface Company",
  "companyType: CompanyType",
  "createCompanySwitchQueue",
  "cancelCompanySessionQueries(queryClient)",
  "removeCompanySessionQueries(queryClient)",
]) {
  if (!company.includes(invariant)) failures.push(`CompanyContext.tsx: missing ${invariant}`);
}
forbidText("client/src/contexts/CompanyContext.tsx", "useQuery<any[]>");

const selector = read("client/src/components/CompanySelector.tsx");
for (const invariant of ["company: Company", "error: unknown", "Record<CompanyType", "await selectCompany(company"]) {
  if (!selector.includes(invariant)) failures.push(`CompanySelector.tsx: missing ${invariant}`);
}
for (const forbidden of ["company: any", "as any", "error: any", "window.location.reload"]) {
  if (selector.includes(forbidden)) failures.push(`CompanySelector.tsx: contains forbidden ${forbidden}`);
}

for (const testPath of [
  "tests/ui/session-contracts.test.ts",
  "tests/ui/phase9-type-safety-wiring.test.ts",
]) {
  if (!fs.existsSync(path.join(root, testPath))) failures.push(`missing focused test: ${testPath}`);
}

const docs = requireText("docs/engineering/phase9-type-safety-contracts.md", "# Phase 9");
for (const phrase of [
  "runtime validation",
  "unknown at the network boundary",
  "authenticated user",
  "company assignments",
  "session company",
  "Compatibility boundary",
  "Verification boundary",
  "Merge boundary",
]) {
  if (!docs.includes(phrase)) failures.push(`phase9 documentation: missing ${phrase}`);
}

if (failures.length > 0) {
  console.error("Phase 9 type-safety contract verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 9 type-safety contracts verified.");
