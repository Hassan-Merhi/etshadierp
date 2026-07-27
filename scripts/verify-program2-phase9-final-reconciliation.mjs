import fs from "node:fs";

const required = [
  "docs/program-2-phase-1-accounting-foundation.md",
  "docs/program-2-phase-2-manual-vouchers.md",
  "docs/program-2-phase-3-payments-receipts.md",
  "docs/program-2-phase-4-pos-stock-transfers.md",
  "docs/program-2-phase-5-containers-freight.md",
  "docs/program-2-phase-6-supplier-partner.md",
  "docs/program-2-phase-7-payroll.md",
  "docs/program-2-phase-8-rentals.md",
  "docs/program-2-phase-9-final-reconciliation.md",
  "scripts/verify-program2-phase3-payments-receipts.mjs",
  "scripts/verify-program2-phase4-pos-stock-transfers.mjs",
  "scripts/verify-program2-phase5-containers-freight.mjs",
  "scripts/verify-program2-phase6-supplier-partner.mjs",
  "scripts/verify-program2-phase7-payroll.mjs",
  "scripts/verify-program2-phase8-rentals.mjs",
];

const missing = required.filter((path) => !fs.existsSync(path));
if (missing.length) {
  console.error("Program 2 final reconciliation failed. Missing files:");
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}

const completion = fs.readFileSync("docs/program-2-phase-9-final-reconciliation.md", "utf8");
for (const phrase of [
  "company ownership",
  "historical currency",
  "deterministic request identity",
  "replay-safe compatibility effects",
  "exact edit/delete reversal",
  "specialized-workflow isolation",
  "Merge-order requirement",
  "Verification boundary",
]) {
  if (!completion.includes(phrase)) {
    console.error(`Program 2 final reconciliation failed. Missing invariant: ${phrase}`);
    process.exit(1);
  }
}

console.log("Program 2 final reconciliation static verification passed.");
