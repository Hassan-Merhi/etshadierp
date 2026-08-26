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

const editForm = "const editForm = useForm({";
if (!text.includes(editForm)) throw new Error("Expected editForm declaration not found");
text = text.replace(editForm, 'const editForm = useForm<Omit<UpdateLedgerAccount, "id" | "companyId">>({');

fs.writeFileSync(file, text);
console.log("Typed Accounts bank/edit forms from shared schemas.");
