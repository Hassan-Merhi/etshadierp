import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const failures = [];

function requireText(path, needle, label = needle) {
  const source = read(path);
  if (!source.includes(needle)) failures.push(`${path}: missing ${label}`);
  return source;
}

function forbidText(path, needle, label = needle) {
  const source = read(path);
  if (source.includes(needle)) failures.push(`${path}: contains forbidden ${label}`);
  return source;
}

const program2 = spawnSync(process.execPath, ["scripts/verify-program2-phase9-final-reconciliation.mjs"], {
  cwd: root,
  encoding: "utf8",
});
if (program2.status !== 0) {
  failures.push("Program 2 accounting convergence verifier did not pass");
  if (program2.stdout) process.stdout.write(program2.stdout);
  if (program2.stderr) process.stderr.write(program2.stderr);
}

for (const servicePath of [
  "server/routes/transfers/simpleCompanyTransferService.ts",
  "server/routes/transfers/interCompanyTransferService.ts",
]) {
  requireText(servicePath, "postBalancedVoucherTx", "central posting boundary");
  requireText(servicePath, "transferRepository.transaction", "transaction-owned transfer posting");
  requireText(servicePath, "findTransferByVoucherIdsTx", "replay-safe transfer row lookup");
  requireText(servicePath, "requireCompanyAccess", "two-company authorization");
  forbidText(servicePath, ".insert(vouchers)", "direct voucher insert");
  forbidText(servicePath, ".insert(voucherEntries)", "direct voucher-entry insert");
}

const simpleTransfer = read("server/routes/transfers/simpleCompanyTransferService.ts");
for (const invariant of [
  "simple-company-transfer-reversal",
  "getVoucherSnapshotTx",
  "hasCompletedTransferReversal",
  "originals remain for audit",
]) {
  if (!simpleTransfer.includes(invariant)) {
    failures.push(`server/routes/transfers/simpleCompanyTransferService.ts: missing ${invariant}`);
  }
}

const repository = requireText(
  "server/routes/transfers/transferRepository.ts",
  "db.transaction",
  "database transaction adapter",
);
for (const boundary of [
  "createTransferTx",
  "findTransferByVoucherIdsTx",
  "getSimpleTransferForUpdateTx",
  "getVoucherSnapshotTx",
  "hasCompletedTransferReversal",
]) {
  if (!repository.includes(boundary)) {
    failures.push(`server/routes/transfers/transferRepository.ts: missing ${boundary}`);
  }
}
forbidText("server/routes/transfers/transferRepository.ts", ".delete(vouchers)", "voucher hard delete");
forbidText("server/routes/transfers/transferRepository.ts", ".delete(voucherEntries)", "voucher-entry hard delete");

const containerSales = requireText(
  "server/routes/containers/containerSalesService.ts",
  "postBalancedVoucherTx",
  "central container-sale posting",
);
for (const invariant of [
  "db.transaction",
  "buildContainerSalePostingRequest",
  "existingSale",
  'status: "SOLD"',
]) {
  if (!containerSales.includes(invariant)) {
    failures.push(`server/routes/containers/containerSalesService.ts: missing ${invariant}`);
  }
}
forbidText("server/routes/containers/containerSalesService.ts", ".insert(vouchers)", "direct voucher insert");
forbidText(
  "server/routes/containers/containerSalesService.ts",
  ".insert(voucherEntries)",
  "direct voucher-entry insert",
);

const requestIdentity = read("client/src/lib/accountingRequestIdentity.ts");
for (const route of ["/api/simple-company-transfer", "/api/inter-company-transfers"]) {
  if (!requestIdentity.includes(route)) {
    failures.push(`client/src/lib/accountingRequestIdentity.ts: missing retry identity for ${route}`);
  }
}

for (const builderPath of [
  "server/services/accounting/companyTransferPosting.ts",
  "server/services/accounting/containerSalePosting.ts",
]) {
  requireText(builderPath, "createHash", "payload fingerprint");
  requireText(builderPath, "PostingValidationError", "posting validation");
  requireText(builderPath, "idempotencyKey", "idempotency identity");
}

const completion = read("docs/engineering/phase3-accounting-boundary-completion.md");
for (const phrase of [
  "balanced posting",
  "company ownership",
  "atomic cross-company transfer",
  "retry-stable request identity",
  "auditable reversal",
  "container sale",
  "Verification boundary",
  "Merge boundary",
]) {
  if (!completion.includes(phrase)) {
    failures.push(`docs/engineering/phase3-accounting-boundary-completion.md: missing ${phrase}`);
  }
}

if (failures.length > 0) {
  console.error("Phase 3 accounting boundary completion verification failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Phase 3 accounting boundary completion contracts verified.");
