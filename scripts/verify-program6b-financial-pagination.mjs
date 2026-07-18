#!/usr/bin/env node

/**
 * Program 6B static regression guard.
 *
 * This verifier protects the accounting invariants required while daybook,
 * accounts, and reporting endpoints are paginated or summarized. It does not
 * execute production data or mutate the database.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const daybookRoute = read("server/routes/factory/factoryDaybookPaginationRoutes.ts");
const accountsPage = read("client/src/pages/Accounts.tsx");
const ledgerRoutes = read("server/routes/ledgerRoutes.ts");

assert(daybookRoute.includes("MAX_PAGE_SIZE = 250"), "Factory Daybook must retain a bounded maximum page size.");
assert(daybookRoute.includes("COUNT(*)::int FROM filtered"), "Factory Daybook total must be calculated from the complete filtered result.");
assert(daybookRoute.includes("hasNextPage"), "Factory Daybook pagination metadata is missing.");
assert(daybookRoute.includes("ORDER BY sort_date"), "Factory Daybook must retain deterministic server ordering.");
assert(accountsPage.includes('queryKey: ["/api/accounts/all"'), "Accounts screen must retain the balance-aware accounts endpoint.");
assert(accountsPage.includes("accountsResponse?.accounts"), "Accounts screen must unwrap the balance-aware response contract.");
assert(accountsPage.includes("rawTransactionData.preNetBalance"), "Account statements must preserve pre-period balance semantics.");
assert(accountsPage.includes("broughtForwardBalance"), "Account statements must preserve brought-forward balance calculation.");
assert(ledgerRoutes.includes("eq(ledgerAccounts.accountType, accountType.trim())"), "Ledger account type filtering must remain server-side.");
assert(ledgerRoutes.includes("ilike(ledgerAccounts.name, q)"), "Ledger account search must remain server-side.");

if (failures.length > 0) {
  console.error("Program 6B financial pagination verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Program 6B financial pagination invariants verified.");
