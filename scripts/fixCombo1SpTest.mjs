import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/sp-sales-accounting.test.ts";
let source = readFileSync(path, "utf8");

const declaration = "let cashLedgerAcctId: number;\n";
const duplicateInsert = `  const [cashLedgerAcct] = await db
    .insert(schema.ledgerAccounts)
    .values({
      companyId: ctx.companyId,
      code: \`${TEST_PREFIX}_CASH\`,
      name: "Test Cash",
      accountType: "Cash",
      openingBalance: "0",
      openingBalanceSide: "Dr",
    })
    .returning();
  cashLedgerAcctId = cashLedgerAcct.id;

`;

if (source.includes(declaration)) {
  source = source.replace(declaration, "");
}
if (source.includes(duplicateInsert)) {
  source = source.replace(duplicateInsert, "");
}
if (source.includes(declaration) || source.includes(duplicateInsert)) {
  throw new Error("SP test cleanup did not fully apply");
}

writeFileSync(path, source);
