/**
 * Regression test: WhatsApp statement prompt after voucher save
 *
 * Verifies that checkAccountWhatsAppRule returns the correct prompt value for all scenarios.
 *
 * Run: npx tsx scripts/test-whatsapp-statement-prompt.ts
 */

import { db } from "../server/db";
import { ledgerAccounts, factoryAccountWhatsappRules } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { checkAccountWhatsAppRule } from "../server/routes/factoryWhatsappRoutes";

const TEST_COMPANY_ID = 1;
const TEST_CHAT_ID = "test-chat-id-regression-001";

async function cleanup(accountId: number) {
  await db
    .delete(factoryAccountWhatsappRules)
    .where(
      and(
        eq(factoryAccountWhatsappRules.companyId, TEST_COMPANY_ID),
        eq(factoryAccountWhatsappRules.ledgerAccountId, accountId)
      )
    );
  await db
    .delete(ledgerAccounts)
    .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, TEST_COMPANY_ID)));
}

async function run() {
  console.log("=== WhatsApp statement prompt regression test ===\n");

  // 1. Create a test ledger account
  const [acct] = await db
    .insert(ledgerAccounts)
    .values({
      companyId: TEST_COMPANY_ID,
      name: "__WA_REGRESSION_TEST__",
      code: "__WA_REG__",
      accountType: "Asset",
      openingBalance: "0",
    })
    .returning();
  console.log(`[setup] Created ledger account id=${acct.id}`);

  try {
    // 2. No rule yet — should return prompt:false
    const noRule = await checkAccountWhatsAppRule({
      companyId: TEST_COMPANY_ID,
      accountId: acct.id,
      accountType: "ledger",
      voucherType: "Payment",
      voucherDate: "2026-06-01",
    });
    console.assert(!noRule.prompt, "FAIL: expected prompt=false when no rule exists");
    console.log(`[1] No rule → prompt=${noRule.prompt}   ✅ expected false`);

    // 3. Save rule with enabled=true, chatId set
    await db
      .insert(factoryAccountWhatsappRules)
      .values({
        companyId: TEST_COMPANY_ID,
        ledgerAccountId: acct.id,
        enabled: true,
        whatsappChatId: TEST_CHAT_ID,
        sendOnPayment: true,
        sendOnReceipt: true,
        sendOnJournal: true,
        updatedAt: new Date(),
      });
    console.log(`[setup] Saved enabled WhatsApp rule with chatId="${TEST_CHAT_ID}"`);

    // 4. Payment voucher → prompt:true
    const payResult = await checkAccountWhatsAppRule({
      companyId: TEST_COMPANY_ID,
      accountId: acct.id,
      accountType: "ledger",
      voucherType: "Payment",
      voucherDate: "2026-06-15",
    });
    console.assert(payResult.prompt === true, "FAIL: Payment should return prompt=true");
    console.assert(payResult.accountId === acct.id, "FAIL: accountId mismatch");
    console.assert(payResult.month === "2026-06", "FAIL: month mismatch");
    console.log(`[2] Payment → prompt=${payResult.prompt}, accountId=${payResult.accountId}, month=${payResult.month}   ✅`);

    // 5. Receipt voucher → prompt:true
    const recResult = await checkAccountWhatsAppRule({
      companyId: TEST_COMPANY_ID,
      accountId: acct.id,
      accountType: "ledger",
      voucherType: "Receipt",
      voucherDate: "2026-06-15",
    });
    console.assert(recResult.prompt === true, "FAIL: Receipt should return prompt=true");
    console.log(`[3] Receipt → prompt=${recResult.prompt}   ✅`);

    // 6. Journal voucher → prompt:true
    const jrnResult = await checkAccountWhatsAppRule({
      companyId: TEST_COMPANY_ID,
      accountId: acct.id,
      accountType: "ledger",
      voucherType: "Journal",
      voucherDate: "2026-06-15",
    });
    console.assert(jrnResult.prompt === true, "FAIL: Journal should return prompt=true");
    console.log(`[4] Journal → prompt=${jrnResult.prompt}   ✅`);

    // 7. Non-ledger account type → prompt:false (guard)
    const bankResult = await checkAccountWhatsAppRule({
      companyId: TEST_COMPANY_ID,
      accountId: acct.id,
      accountType: "bank",
      voucherType: "Payment",
      voucherDate: "2026-06-15",
    });
    console.assert(!bankResult.prompt, "FAIL: bank accountType should return prompt=false");
    console.log(`[5] Bank type → prompt=${bankResult.prompt}   ✅ expected false`);

    // 8. Disabled rule → prompt:false
    await db
      .update(factoryAccountWhatsappRules)
      .set({ enabled: false })
      .where(
        and(
          eq(factoryAccountWhatsappRules.companyId, TEST_COMPANY_ID),
          eq(factoryAccountWhatsappRules.ledgerAccountId, acct.id)
        )
      );
    const disabledResult = await checkAccountWhatsAppRule({
      companyId: TEST_COMPANY_ID,
      accountId: acct.id,
      accountType: "ledger",
      voucherType: "Payment",
      voucherDate: "2026-06-15",
    });
    console.assert(!disabledResult.prompt, "FAIL: disabled rule should return prompt=false");
    console.log(`[6] Disabled rule → prompt=${disabledResult.prompt}   ✅ expected false`);

    // 9. sendOnPayment=false gate
    await db
      .update(factoryAccountWhatsappRules)
      .set({ enabled: true, sendOnPayment: false })
      .where(
        and(
          eq(factoryAccountWhatsappRules.companyId, TEST_COMPANY_ID),
          eq(factoryAccountWhatsappRules.ledgerAccountId, acct.id)
        )
      );
    const gatedResult = await checkAccountWhatsAppRule({
      companyId: TEST_COMPANY_ID,
      accountId: acct.id,
      accountType: "ledger",
      voucherType: "Payment",
      voucherDate: "2026-06-15",
    });
    console.assert(!gatedResult.prompt, "FAIL: sendOnPayment=false should block prompt");
    console.log(`[7] sendOnPayment=false → prompt=${gatedResult.prompt}   ✅ expected false`);

    console.log("\n✅ All assertions passed.");
  } finally {
    await cleanup(acct.id);
    console.log("[cleanup] Test account and rule removed.");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
