import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/sp-sales-accounting.test.ts";
const source = readFileSync(path, "utf8");
const oldText = "cashLedgerAcctId";
const count = source.split(oldText).length - 1;

if (count === 0 && source.includes("paymentAccountId: ctx.cashAccountId")) {
  console.log("SP test references are already updated.");
  process.exit(0);
}

if (count !== 2) {
  throw new Error(`Expected exactly 2 stale cashLedgerAcctId references, found ${count}`);
}

const updated = source.split(oldText).join("ctx.cashAccountId");
writeFileSync(path, updated);
console.log("Updated both SP cash-account test references to ctx.cashAccountId.");
