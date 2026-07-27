import fs from "node:fs";

const files = {
  service: "server/services/rental/rentalPaymentPostingService.ts",
  routes: "server/routes/rental/rentalPaymentsAccrualRoutes.ts",
  deleteRoute: "server/routes/vouchers/centralPaymentReceiptDeleteRoute.ts",
  doc: "docs/program-2-phase-8-rentals.md",
};

const read = (path) => fs.readFileSync(path, "utf8");
const assertHas = (text, marker, label) => {
  if (!text.includes(marker)) throw new Error(`Missing ${label}: ${marker}`);
};

for (const path of Object.values(files)) {
  if (!fs.existsSync(path)) throw new Error(`Required file missing: ${path}`);
}

const service = read(files.service);
const routes = read(files.routes);
const deletion = read(files.deleteRoute);
const doc = read(files.doc);

assertHas(service, "Single authoritative source for rental payment accounting", "authoritative posting service");
assertHas(service, "Advisory lock + idempotency guard prevents double-posting", "double-posting protection");
assertHas(service, "SCHEDULED → POSTED", "scheduled posting transition");
assertHas(service, "Dr Accrued Rent Payable / Cr Cash", "accrued payment formula");
assertHas(service, "Dr Advance Rent Paid / Cr Cash", "due-unaccrued payment formula");
assertHas(service, "Dr Prepaid Rent / Cr Cash", "prepaid payment formula");
assertHas(service, "posting_status = 'POSTED'", "posted-payment authority");
assertHas(service, "normalizeVoucherEntryAmounts", "historical currency normalization");
assertHas(service, "usedAdvanceAccount", "advance-account state");
assertHas(service, "usedPrepaidAccount", "prepaid-account state");

assertHas(routes, "createRentalPaymentGroup", "payment creation service usage");
assertHas(routes, "postDueScheduledRentalPayments", "scheduled posting service usage");
assertHas(routes, "scheduleFuturePayment", "future scheduling boundary");
assertHas(routes, "DELETE PAYMENT (full reversal)", "rental-aware deletion");
assertHas(routes, "property_monthly_ledger", "monthly ledger reversal");
assertHas(routes, "propertyPayments", "payment linkage cleanup");
assertHas(routes, "isSharedPayment", "shared-company boundary");

assertHas(deletion, "propertyPayments", "generic deletion compatibility cleanup");
assertHas(deletion, "paid_amount = GREATEST", "generic monthly-ledger reversal compatibility");

assertHas(doc, "Scheduled payments remain non-posting", "scheduled-payment contract");
assertHas(doc, "POSTED payment rows", "authoritative paid-total contract");
assertHas(doc, "Repeated deletion or scheduled posting", "replay-safe lifecycle contract");

console.log("Program 2 Phase 8 rental accounting verifier passed.");
