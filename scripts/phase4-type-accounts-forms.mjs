#!/usr/bin/env node
import fs from "node:fs";

const file = "client/src/pages/accountslegacy/useAccountsLegacyModel.ts";
let text = fs.readFileSync(file, "utf8");

const importLine = 'import { LedgerAccount, BankAccount, insertBankAccountSchema, updateLedgerAccountSchema } from "@shared/schema";';
if (!text.includes(importLine)) throw new Error("Expected accounting schema import not found");
text = text.replace(
  importLine,
  `${importLine}\nimport type { InsertBankAccount, UpdateLedgerAccount } from "@shared/schema";`,
);

const bankForm = "const bankForm = useForm({";
if (!text.includes(bankForm)) throw new Error("Expected bankForm declaration not found");
text = text.replace(bankForm, 'const bankForm = useForm<Omit<InsertBankAccount, "companyId">>({');

const bankResetAnchor = "if (bankToEdit) {\n      bankForm.reset({";
if (!text.includes(bankResetAnchor)) throw new Error("Expected bank reset block not found");
text = text.replace(
  bankResetAnchor,
  'if (bankToEdit) {\n      const openingBalanceSide = insertBankAccountSchema.shape.openingBalanceSide.safeParse(\n        bankToEdit.openingBalanceSide ?? "Dr"\n      );\n      bankForm.reset({',
);

const bankSideLine = 'openingBalanceSide: bankToEdit.openingBalanceSide ?? "Dr",';
if (!text.includes(bankSideLine)) throw new Error("Expected bank opening balance side line not found");
text = text.replace(bankSideLine, 'openingBalanceSide: openingBalanceSide.success ? openingBalanceSide.data : "Dr",');

const editForm = "const editForm = useForm({";
if (!text.includes(editForm)) throw new Error("Expected editForm declaration not found");
text = text.replace(editForm, 'const editForm = useForm<Omit<UpdateLedgerAccount, "id" | "companyId">>({');

const editResetAnchor = "setAlterSelectedAccount(account);\n    editForm.reset({";
if (!text.includes(editResetAnchor)) throw new Error("Expected edit reset block not found");
text = text.replace(
  editResetAnchor,
  "setAlterSelectedAccount(account);\n    const accountType = updateLedgerAccountSchema.shape.accountType.safeParse(account.accountType || account.type);\n    editForm.reset({",
);

const accountTypeLine = 'accountType: account.accountType || account.type || "",';
if (!text.includes(accountTypeLine)) throw new Error("Expected account type reset line not found");
text = text.replace(accountTypeLine, "accountType: accountType.success ? accountType.data : undefined,");

fs.writeFileSync(file, text);
console.log("Typed Accounts bank/edit forms from shared schemas with schema-backed normalization.");
