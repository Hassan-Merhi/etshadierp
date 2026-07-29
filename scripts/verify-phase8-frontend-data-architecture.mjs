import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

const architecture = read("client/src/lib/frontendDataArchitecture.ts");
for (const required of [
  "canonicalApiUrl",
  "companyDataKey",
  "queryMatchesApiFamily",
  "invalidateApiFamily",
  "removeApiFamily",
  "unwrapList",
  "frontendQueryPolicies",
  'refetchType ?? "active"',
]) {
  if (!architecture.includes(required)) failures.push(`frontendDataArchitecture.ts missing ${required}`);
}

for (const forbidden of ["startsWith(family)", "JSON.stringify(params)"]) {
  if (architecture.includes(forbidden)) failures.push(`frontendDataArchitecture.ts contains unsafe ${forbidden}`);
}

const keys = read("client/src/lib/queryKeys.ts");
for (const required of [
  "companyKeys",
  "canonicalApiUrl",
  "companyDataKey",
  "autoTransferConfig",
  "voucherSearch",
  "stockItemKeys",
  "page:",
]) {
  if (!keys.includes(required)) failures.push(`queryKeys.ts missing ${required}`);
}

for (const test of [
  "tests/ui/frontend-data-architecture.test.ts",
  "tests/ui/queryKeys.test.ts",
]) {
  if (!fs.existsSync(path.join(root, test))) failures.push(`missing focused test ${test}`);
}

const docs = read("docs/engineering/phase8-frontend-data-architecture.md").toLowerCase();
for (const phrase of [
  "canonical request urls",
  "company-scoped cache identity",
  "exact endpoint-family invalidation",
  "active-only refetch",
  "response-shape normalization",
  "merge boundary",
]) {
  if (!docs.includes(phrase)) failures.push(`phase8 documentation missing ${phrase}`);
}

if (failures.length) {
  console.error("Phase 8 frontend data architecture verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 8 frontend data architecture contracts verified.");
