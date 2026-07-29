import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

const boundary = read("server/security/companyAccessBoundary.ts");
for (const required of [
  "getCompanyAccessContext",
  "assertCompanyAccess",
  "assertCompaniesAccess",
  "resolveAuthorizedCompanyId",
  "CROSS_COMPANY_FORBIDDEN",
  "COMPANY_ACCESS_DENIED",
  "await assertCompanyAccess(context.userId, targetCompanyId)",
]) {
  if (!boundary.includes(required)) failures.push(`companyAccessBoundary missing ${required}`);
}

const transfer = read("server/routes/transfers/transferRequestContext.ts");
for (const required of ["getCompanyAccessContext", "assertCompaniesAccess", "assertCompanyAccess"]) {
  if (!transfer.includes(required)) failures.push(`transferRequestContext missing ${required}`);
}
if (transfer.includes("storage.getUserCompaniesWithRoles")) {
  failures.push("transferRequestContext still owns duplicate company-role lookup logic");
}

const exportRoute = read("server/routes/netPositionMonthlyExcelRoute.ts");
for (const required of [
  "requireNonPOS",
  "resolveAuthorizedCompanyId(req, req.query.companyId)",
  "sendCompanyAccessError",
]) {
  if (!exportRoute.includes(required)) failures.push(`netPositionMonthlyExcelRoute missing ${required}`);
}
if (exportRoute.includes("isAdminOrDev && requestedCompanyId")) {
  failures.push("net-position export still permits role-only cross-company override");
}

const docs = read("docs/engineering/phase7-permission-company-isolation-completion.md").toLowerCase();
for (const phrase of [
  "explicit company membership",
  "privileged cross-company access",
  "active company",
  "transfer boundary",
  "financial exports",
  "verification boundary",
  "merge boundary",
]) {
  if (!docs.includes(phrase)) failures.push(`Phase 7 documentation missing ${phrase}`);
}

if (!fs.existsSync(path.join(root, "tests/company-access-boundary-contract.test.ts"))) {
  failures.push("missing company access boundary contract test");
}

if (failures.length) {
  console.error("Phase 7 permission and company isolation verification failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("Phase 7 permission and company isolation contracts verified.");
