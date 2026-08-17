from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        if new in text:
            return
        raise SystemExit(f"Expected Phase 3 source not found in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "server/services/accounting/centralPostingEngine.ts",
    "const result = await insertVoucherWithEntriesTx(tx, request.voucher, request.entries);",
    "const result = await insertVoucherWithEntriesTx(tx, request.voucher, request.entries, request.source);",
)

replace_once(
    "server/routes/factory/factoryInsuranceRoutes.ts",
    'import { insertVoucherWithEntriesTx } from "../../services/accounting/voucherPostingService";',
    'import { postBalancedVoucherTx } from "../../services/accounting/centralPostingEngine";\n'
    'import { createDatabasePostingDependencies } from "../../services/accounting/databasePostingDependencies";\n'
    'import { infrastructurePostingIdentity } from "../../services/accounting/infrastructureVoucherIdentity";',
)

replace_once(
    "server/routes/factory/factoryInsuranceRoutes.ts",
    'const voucherNumber = `INS-${year}-${String(month).padStart(2, "0")}-${Date.now()}`;',
    'const voucherNumber = `INS-${year}-${String(month).padStart(2, "0")}`;',
)

replace_once(
    "server/routes/factory/factoryInsuranceRoutes.ts",
    '''      const result = await db.transaction(async (tx) =>
        insertVoucherWithEntriesTx(
          tx,
          {
            companyId,
            voucherNumber,
            voucherType: "Journal",
            description: narration,
            voucherDate: periodStart,
            totalAmount: totalAmount.toFixed(2),
            sourceModule: "ERP",
          },
          // Dr Insurance Expense / Cr each member's liability.
          //
          // This ran the other way round until now — the expense account
          // credited and the member liabilities debited — which is the reverse
          // of standard double entry and of the convention every other posting
          // here uses (see the transporter charge route: Dr expense / Cr the
          // party owed). The effect was that running the monthly journal
          // reduced recorded expense and made each member's liability account
          // read as an asset.
          //
          // Only new journals are affected. Ones already posted keep the old
          // direction; correcting those is a data question, not a code one, and
          // is left to whoever owns the chart of accounts.
          [
            {
              ledgerAccountId: expenseAccount.id,
              debitAmount: totalAmount.toFixed(2),
              creditAmount: "0",
              narration,
            },
            ...memberLedgers.map((member) => ({
              ledgerAccountId: member.ledgerId,
              debitAmount: "0",
              creditAmount: member.amount.toFixed(2),
              narration,
            })),
          ]
        )
      );''',
    '''      const result = await db.transaction((tx) =>
        postBalancedVoucherTx(
          tx,
          {
            voucher: {
              companyId,
              voucherNumber,
              voucherType: "Journal",
              description: narration,
              voucherDate: periodStart,
              totalAmount: totalAmount.toFixed(2),
              sourceModule: "ERP",
            },
            entries: [
              {
                ledgerAccountId: expenseAccount.id,
                debitAmount: totalAmount.toFixed(2),
                creditAmount: "0",
                narration,
              },
              ...memberLedgers.map((member) => ({
                ledgerAccountId: member.ledgerId,
                debitAmount: "0",
                creditAmount: member.amount.toFixed(2),
                narration,
              })),
            ],
            source: infrastructurePostingIdentity(
              "factory-insurance",
              `${companyId}:${year}:${String(month).padStart(2, "0")}`,
              "monthly-journal"
            ),
            actor: {
              userId: req.user?.id ?? null,
              username: req.user?.username ?? null,
              reason: "Generate monthly insurance journal",
            },
          },
          createDatabasePostingDependencies()
        )
      );''',
)

replace_once(
    "scripts/audit-write-evidence.mjs",
    'const REQUEST_IDENTITY =\n  /\\b(?:clientRequestId|resolveStockDocumentRequestId|stockDocumentIdempotencyKey|postBalancedVoucherTx)\\b/;',
    'const REQUEST_IDENTITY =\n  /\\b(?:clientRequestId|resolveStockDocumentRequestId|stockDocumentIdempotencyKey|postBalancedVoucherTx|insertInfrastructureVoucherTx|insertInfrastructureVoucher)\\b/;\n\n'
    'const IDENTITY_OWNING_VOUCHER_WRITERS = new Set([\n'
    '  "server/services/accounting/voucherPostingService.ts",\n'
    '  "server/services/accounting/infrastructureVoucherIdentity.ts",\n'
    ']);',
)

replace_once(
    "scripts/audit-write-evidence.mjs",
    '''    if (createsTableRow(source, "vouchers", "vouchers")) {
      if (REQUEST_IDENTITY.test(source)) voucherWritesWithRequestIdentity += 1;
      else voucherWritesWithoutRequestIdentity.push(file);
    }''',
    '''    if (createsTableRow(source, "vouchers", "vouchers")) {
      if (IDENTITY_OWNING_VOUCHER_WRITERS.has(file) || REQUEST_IDENTITY.test(source)) {
        voucherWritesWithRequestIdentity += 1;
      } else {
        voucherWritesWithoutRequestIdentity.push(file);
      }
    }''',
)
