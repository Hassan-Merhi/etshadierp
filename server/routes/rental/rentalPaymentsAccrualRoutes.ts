import type { Express } from "express";
import { getCompanyId, findOrCreateLedgerAccount, maybeRunAutoTransfer, ensureMonthlyLedgerRows, findEarliestOutstandingMonth, buildAllocations, ensureMonthlyForCompany, postRentAccrualForCompany, type RentalModule } from "./_rentalShared";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { z } from "zod";
import { eq, and, sql, desc, inArray, isNull, isNotNull, ne } from "drizzle-orm";
import {
  propertyUnits, propertyContracts, propertyMonthlyLedger, propertyPayments,
  insertPropertyUnitSchema, insertPropertyContractSchema,
  ledgerAccounts, vouchers, voucherEntries, rentalAutoTransferConfigs,
  interCompanyTransfers, companies,
} from "@shared/schema";
import { parseId, parseOptionalId } from "../../lib/parseId";
import { logAudit } from "../_helpers";
import { getClientDate } from "../../lib/dateUtils";

export function registerRentalPaymentsAccrualRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
  shopExpenseAccountName: string = "Rent Expense - Shops",
) {
  const tag = `[${module}/rental]`;

  app.post(`${urlPrefix}/payments`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = z.object({
        contractId: z.number(),
        cashAccountId: z.number().nullable().optional(),
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        paymentDate: z.string().min(1),
        notes: z.string().optional(),
        currency: z.string().optional().default("USD"),
        exchangeRate: z.union([z.string(), z.number()]).transform(v => String(v)).optional().default("1"),
      }).parse(req.body);

      let isSharedPayment = false;
      let [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, data.contractId),
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
      ));
      // If not found as owner, check if it's a shared contract linked to this company
      if (!contract) {
        const [sharedContract] = await db.select().from(propertyContracts).where(and(
          eq(propertyContracts.id, data.contractId),
          eq(propertyContracts.linkedCompanyId, companyId),
          eq(propertyContracts.status, "ACTIVE"),
        ));
        if (sharedContract) { contract = sharedContract; isSharedPayment = true; }
      }
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      // For shared contracts, ledger/payment rows use the source company's ID;
      // vouchers use the caller's companyId (the tenant paying cash).
      const contractCompanyId = isSharedPayment ? contract.companyId : companyId;

      await ensureMonthlyLedgerRows(contract.id);

      const pd = new Date(data.paymentDate);
      const payYear = pd.getUTCFullYear(), payMonth = pd.getUTCMonth() + 1;

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));

      // ── Build monthly allocations ──────────────────────────────────────────
      // Always start from the oldest outstanding past/current month so that
      // overdue months are filled before current or future months.
      const totalAmountNum = parseFloat(data.amount);
      const rentalAmountNum = parseFloat(contract.rentalAmount as string);
      const { year: y, month: m } = await findEarliestOutstandingMonth(contract.id, payYear, payMonth);
      const allocations = await buildAllocations(contract.id, y, m, totalAmountNum, rentalAmountNum);

      const payments = await db.transaction(async (tx) => {
        // Ensure a ledger row exists for every allocated month
        for (const alloc of allocations) {
          await tx.insert(propertyMonthlyLedger).values({
            companyId: contractCompanyId, module, contractId: contract.id, unitId: contract.unitId,
            year: alloc.year, month: alloc.month,
            expectedAmount: contract.rentalAmount, paidAmount: "0",
          }).onConflictDoNothing({
            target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
          });
        }

        // Create ONE voucher for the full payment total
        let voucherId: number | null = null;
        if (data.cashAccountId) {
          // Both owned SHOP units AND shared units represent rent HADI pays outward as a tenant
          // (expense — Dr Rent Expense / Cr Cash → Payment voucher).
          // Shared units are rented FROM Hassan Properties, so HADI is paying OUT, not collecting.
          const isShop = isSharedPayment || unit?.unitType === "SHOP";
          const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
          const monthSpan = allocations.length > 1
            ? `${String(allocations[0].month).padStart(2,"0")}/${allocations[0].year} – ${String(allocations[allocations.length-1].month).padStart(2,"0")}/${allocations[allocations.length-1].year}`
            : `${String(m).padStart(2,"0")}/${y}`;

          const voucherCurrency = data.currency || "USD";
          if (isShop) {
            // Simple direct posting: Dr Rent Expense / Cr Cash for the full amount.
            // No accrual/prepaid/advance splitting — the expense is recognised at payment time.
            const narration = `Rent paid - ${unitLabel} - ${monthSpan}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
              voucherType: "Payment", voucherDate: data.paymentDate as any,
              description: narration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
            }).returning();
            voucherId = v.id;

            const expenseId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: expenseId,          debitAmount: data.amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: "0", creditAmount: data.amount, narration },
            ]);
          } else {
            const incomeAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income");
            const narration = `Rent received - ${unitLabel} - ${monthSpan}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
              voucherType: "Receipt", voucherDate: data.paymentDate as any,
              description: narration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
            }).returning();
            voucherId = v.id;
            // Split: future months → Deferred Rent Revenue; due months → Rent Income
            const futureAllocsL = allocations.filter(a => a.year > payYear || (a.year === payYear && a.month > payMonth));
            const deferredChunkL = futureAllocsL.reduce((s, a) => s + Number(a.chunk), 0);
            const earnedChunkL = parseFloat(data.amount) - deferredChunkL;
            const lEntries: any[] = [
              { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: data.amount, creditAmount: "0", narration },
            ];
            if (earnedChunkL > 0.005) {
              lEntries.push({ voucherId: v.id, ledgerAccountId: incomeAccountId, debitAmount: "0", creditAmount: earnedChunkL.toFixed(2), narration });
            }
            if (deferredChunkL > 0.005) {
              const deferredId = await findOrCreateLedgerAccount(tx, companyId, "Deferred Rent Revenue", "Liability", "DEF-RENT-REV");
              lEntries.push({ voucherId: v.id, ledgerAccountId: deferredId, debitAmount: "0", creditAmount: deferredChunkL.toFixed(2), narration });
            }
            await tx.insert(voucherEntries).values(lEntries);

            // ── Intercompany mirror voucher for the source (Properties) company ──
            // When HADI L'SHI collects rent on a shared unit, Hassan Properties also
            // books the income with a matching intercompany payable:
            //
            //   Hassan Properties journal:
            //     Dr  HADI L'SHI — Intercompany  (Properties owes HADI the cash it collected)
            //     Cr  Rental Income - Properties
            //
            //   HADI L'SHI journal (separate, so HADI's receipt stays balanced):
            //     Dr  Hassan Properties — Intercompany  (HADI is owed by Properties)
            //     Cr  Rental Income - ERP  (reclass: the income belongs to Properties, not HADI)
            //
            // The two intercompany accounts net to zero across both companies.
            if (isSharedPayment) {
              const sourceCompanyId = contract.companyId; // Hassan Properties (13)

              // ── HADI L'SHI intercompany account (Asset — Properties owes HADI) ──
              const hadiIntercoId = await findOrCreateLedgerAccount(
                tx, companyId,
                "Hassan Properties — Intercompany",
                "Intercompany",
                "PROP-IC",
                "hadi_prop_intercompany",
              );
              // ── Hassan Properties intercompany account (Liability — owes HADI) ──
              const propIntercoId = await findOrCreateLedgerAccount(
                tx, sourceCompanyId,
                "HADI L'SHI — Intercompany",
                "Intercompany",
                "HADI-IC",
                "prop_hadi_intercompany",
              );
              // ── Hassan Properties rental income account ──
              const propIncomeId = await findOrCreateLedgerAccount(
                tx, sourceCompanyId,
                "Rental Income - Properties",
                "Income",
                "RENT-INC",
                "Indirect Income",
              );

              const icNarration = `Rent collected by HADI L'SHI - ${unitLabel} - ${monthSpan}`;

              // HADI reclass journal: Dr Rental Income (reverse HADI's own income) / Cr Interco (HADI is owed by Properties)
              // This leaves HADI with: Dr Cash / Cr Interco Receivable — a clean collection on behalf of Properties.
              const [hadiIcV] = await tx.insert(vouchers).values({
                companyId,
                voucherNumber: `RENT-IC-H-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
                voucherType: "Journal", voucherDate: data.paymentDate as any,
                description: icNarration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
              }).returning();
              await tx.insert(voucherEntries).values([
                { voucherId: hadiIcV.id, ledgerAccountId: incomeAccountId, debitAmount: data.amount, creditAmount: "0", narration: icNarration },
                { voucherId: hadiIcV.id, ledgerAccountId: hadiIntercoId,   debitAmount: "0", creditAmount: data.amount, narration: icNarration },
              ]);

              // Hassan Properties income journal: Dr Interco (liability) / Cr Rental Income
              const [propV] = await tx.insert(vouchers).values({
                companyId: sourceCompanyId,
                voucherNumber: `RENT-IC-P-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
                voucherType: "Journal", voucherDate: data.paymentDate as any,
                description: icNarration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "PROPERTIES",
              }).returning();
              await tx.insert(voucherEntries).values([
                { voucherId: propV.id, ledgerAccountId: propIntercoId, debitAmount: data.amount, creditAmount: "0", narration: icNarration },
                { voucherId: propV.id, ledgerAccountId: propIncomeId,  debitAmount: "0", creditAmount: data.amount, narration: icNarration },
              ]);
            }
          }
        }

        // Create one payment row per allocated month and update that month's ledger
        const created: (typeof propertyPayments.$inferSelect)[] = [];
        for (const alloc of allocations) {
          const [row] = await tx.select().from(propertyMonthlyLedger).where(and(
            eq(propertyMonthlyLedger.contractId, contract.id),
            eq(propertyMonthlyLedger.year, alloc.year),
            eq(propertyMonthlyLedger.month, alloc.month),
          ));

          const isFutureAlloc = alloc.year > payYear || (alloc.year === payYear && alloc.month > payMonth);

          const [p] = await tx.insert(propertyPayments).values({
            companyId: contractCompanyId, module, contractId: contract.id, unitId: contract.unitId,
            ledgerRowId: row.id,
            cashAccountId: data.cashAccountId ?? null,
            // All split rows share the same voucherId (one financial transaction)
            voucherId: voucherId ?? null,
            amount: alloc.chunk,
            paymentDate: data.paymentDate as any,
            forYear: alloc.year, forMonth: alloc.month,
            currency: data.currency || "USD",
            exchangeRate: data.exchangeRate || "1",
            notes: allocations.length > 1
              ? `${data.notes ? data.notes + " | " : ""}Split from ${data.amount} payment`
              : (data.notes ?? null),
          }).returning();
          created.push(p);

          await tx.execute(sql`
            UPDATE property_monthly_ledger SET paid_amount = paid_amount + ${alloc.chunk}::numeric WHERE id = ${row.id}
          `);
        }
        return created;
      });

      // Fire auto-transfer if configured (outside transaction — best-effort, use total amount)
      if (data.cashAccountId) {
        const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
        await maybeRunAutoTransfer(companyId, module, data.cashAccountId, data.amount, data.paymentDate, unitLabel, payments[0].id, data.notes);
      }

      res.json(payments[0]);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      console.error(`${tag} payments:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── BULK PAYMENTS ──
  app.post(`${urlPrefix}/payments/bulk`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const items = z.array(z.object({
        contractId: z.number(),
        cashAccountId: z.number().nullable().optional(),
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        paymentDate: z.string().min(1),
        notes: z.string().optional(),
        currency: z.string().optional().default("USD"),
        exchangeRate: z.union([z.string(), z.number()]).transform(v => String(v)).optional().default("1"),
      })).min(1).parse(req.body);

      const results: any[] = [];
      for (const data of items) {
        const [contract] = await db.select().from(propertyContracts).where(and(
          eq(propertyContracts.id, data.contractId),
          eq(propertyContracts.companyId, companyId),
          eq(propertyContracts.module, module),
        ));
        if (!contract) { results.push({ contractId: data.contractId, error: "Contract not found" }); continue; }

        await ensureMonthlyLedgerRows(contract.id);

        const pd = new Date(data.paymentDate);
        const payYear = pd.getUTCFullYear(), payMonth = pd.getUTCMonth() + 1;
        const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));

        const totalAmountNum = parseFloat(data.amount);
        const rentalAmountNum = parseFloat(contract.rentalAmount as string);
        // Always start from the oldest outstanding past/current month
        const { year: y, month: m } = await findEarliestOutstandingMonth(contract.id, payYear, payMonth);
        const allocations = await buildAllocations(contract.id, y, m, totalAmountNum, rentalAmountNum);

        const payments = await db.transaction(async (tx) => {
          for (const alloc of allocations) {
            await tx.insert(propertyMonthlyLedger).values({
              companyId, module, contractId: contract.id, unitId: contract.unitId,
              year: alloc.year, month: alloc.month,
              expectedAmount: contract.rentalAmount, paidAmount: "0",
            }).onConflictDoNothing({
              target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
            });
          }

          let voucherId: number | null = null;
          if (data.cashAccountId) {
            const isShop = unit?.unitType === "SHOP";
            const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
            const monthSpan = allocations.length > 1
              ? `${String(allocations[0].month).padStart(2,"0")}/${allocations[0].year} – ${String(allocations[allocations.length-1].month).padStart(2,"0")}/${allocations[allocations.length-1].year}`
              : `${String(m).padStart(2,"0")}/${y}`;

            const voucherCurrency = data.currency || "USD";
            if (isShop) {
              // Simple direct posting: Dr Rent Expense / Cr Cash for the full amount.
              const narration = `Rent paid - ${unitLabel} - ${monthSpan}`;
              const [v] = await tx.insert(vouchers).values({
                companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2,7)}-${contract.id}`,
                voucherType: "Payment", voucherDate: data.paymentDate as any,
                description: narration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
              }).returning();
              voucherId = v.id;
              const expenseId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
              await tx.insert(voucherEntries).values([
                { voucherId: v.id, ledgerAccountId: expenseId,          debitAmount: data.amount, creditAmount: "0", narration },
                { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: "0", creditAmount: data.amount, narration },
              ]);
            } else {
              const incomeAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income");
              const narration = `Rent received - ${unitLabel} - ${monthSpan}`;
              const [v] = await tx.insert(vouchers).values({
                companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2,7)}-${contract.id}`,
                voucherType: "Receipt", voucherDate: data.paymentDate as any,
                description: narration, totalAmount: data.amount, currency: voucherCurrency, sourceModule: "ERP",
              }).returning();
              voucherId = v.id;
              const futureAllocsLB = allocations.filter(a => a.year > payYear || (a.year === payYear && a.month > payMonth));
              const deferredChunkLB = futureAllocsLB.reduce((s, a) => s + Number(a.chunk), 0);
              const earnedChunkLB = parseFloat(data.amount) - deferredChunkLB;
              const lbEntries: any[] = [
                { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: data.amount, creditAmount: "0", narration },
              ];
              if (earnedChunkLB > 0.005) {
                lbEntries.push({ voucherId: v.id, ledgerAccountId: incomeAccountId, debitAmount: "0", creditAmount: earnedChunkLB.toFixed(2), narration });
              }
              if (deferredChunkLB > 0.005) {
                const deferredId = await findOrCreateLedgerAccount(tx, companyId, "Deferred Rent Revenue", "Liability", "DEF-RENT-REV");
                lbEntries.push({ voucherId: v.id, ledgerAccountId: deferredId, debitAmount: "0", creditAmount: deferredChunkLB.toFixed(2), narration });
              }
              await tx.insert(voucherEntries).values(lbEntries);
            }
          }

          const created: (typeof propertyPayments.$inferSelect)[] = [];
          for (const alloc of allocations) {
            const [row] = await tx.select().from(propertyMonthlyLedger).where(and(
              eq(propertyMonthlyLedger.contractId, contract.id),
              eq(propertyMonthlyLedger.year, alloc.year),
              eq(propertyMonthlyLedger.month, alloc.month),
            ));
            const [p] = await tx.insert(propertyPayments).values({
              companyId, module, contractId: contract.id, unitId: contract.unitId,
              ledgerRowId: row.id, cashAccountId: data.cashAccountId ?? null,
              voucherId: voucherId ?? null, amount: alloc.chunk,
              paymentDate: data.paymentDate as any,
              forYear: alloc.year, forMonth: alloc.month,
              currency: data.currency || "USD",
              exchangeRate: data.exchangeRate || "1",
              notes: allocations.length > 1
                ? `${data.notes ? data.notes + " | " : ""}Split from ${data.amount} payment`
                : (data.notes ?? null),
            }).returning();
            created.push(p);
            await tx.execute(sql`
              UPDATE property_monthly_ledger SET paid_amount = paid_amount + ${alloc.chunk}::numeric WHERE id = ${row.id}
            `);
          }
          return created;
        });

        if (data.cashAccountId && payments.length > 0) {
          const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
          await maybeRunAutoTransfer(companyId, module, data.cashAccountId, data.amount, data.paymentDate, unitLabel, payments[0].id, data.notes);
        }
        results.push({ contractId: data.contractId, paymentsCreated: payments.length });
      }

      res.json({ processed: results.length, results });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      console.error(`${tag} bulk-payments:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE PAYMENT (full reversal) ──
  app.delete(`${urlPrefix}/payments/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const paymentId = parseId(req.params.id);
      if (paymentId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(paymentId)) return res.status(400).json({ message: "Invalid payment id" });

      const [payment] = await db.select().from(propertyPayments).where(and(
        eq(propertyPayments.id, paymentId),
        eq(propertyPayments.companyId, companyId),
        eq(propertyPayments.module, module),
      ));
      if (!payment) return res.status(404).json({ message: "Payment not found" });

      await db.transaction(async tx => {
        // 1. Reverse the monthly ledger paid_amount
        if (payment.ledgerRowId) {
          await tx.execute(sql`
            UPDATE property_monthly_ledger
            SET paid_amount = GREATEST(0, paid_amount - ${payment.amount}::numeric)
            WHERE id = ${payment.ledgerRowId}
          `);
        }

        // 2. Soft-delete the linked payment voucher ONLY if no other payment row
        //    references the same voucherId (split payments share one voucher)
        if (payment.voucherId) {
          const siblings = await tx.select({ id: propertyPayments.id })
            .from(propertyPayments)
            .where(and(
              eq(propertyPayments.voucherId, payment.voucherId),
              sql`${propertyPayments.id} != ${paymentId}`,
            ));
          if (siblings.length === 0) {
            await tx.execute(sql`
              UPDATE vouchers SET deleted_at = NOW() WHERE id = ${payment.voucherId}
            `);
            // Also soft-delete the AP-CLEAR auto-clearing journal created alongside this payment
            await tx.execute(sql`
              UPDATE vouchers SET deleted_at = NOW()
              WHERE voucher_number = ${'AP-CLEAR-' + payment.voucherId}
                AND company_id = ${companyId}
                AND deleted_at IS NULL
            `);
          }
        }

        // 3. Reverse any auto-transfers that were created for this payment
        //    Hard-delete both sides (entries + voucher) so the destination company's
        //    books are fully clean — matching the simple-company-transfer pattern.
        const linkedTransfers = await tx
          .select()
          .from(interCompanyTransfers)
          .where(eq(interCompanyTransfers.sourcePaymentId, paymentId));

        for (const transfer of linkedTransfers) {
          const fvid = transfer.fromVoucherId;
          const tvid = transfer.toVoucherId;
          // Delete the transfer record FIRST to release FK "restrict" constraints
          // on fromVoucherId / toVoucherId before hard-deleting those voucher rows.
          await tx.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, transfer.id));
          if (fvid) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, fvid));
            await tx.delete(vouchers).where(eq(vouchers.id, fvid));
          }
          if (tvid) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, tvid));
            await tx.delete(vouchers).where(eq(vouchers.id, tvid));
          }
        }

        // 4. Delete the payment row itself
        await tx.delete(propertyPayments).where(eq(propertyPayments.id, paymentId));

        // 5. If this was a guarantee-release payment, reset guaranteePostedToStatement on the contract
        if (payment.notes && payment.notes.includes("[Guarantee release]") && payment.contractId) {
          await tx.update(propertyContracts)
            .set({ guaranteePostedToStatement: false })
            .where(eq(propertyContracts.id, payment.contractId));
        }
      });

      res.json({ ok: true });
    } catch (e: any) {
      console.error(`${tag} delete-payment:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── UNIT DETAIL (ledger view) ──
  app.get(`${urlPrefix}/units/:id/detail`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const unitId = parseId(req.params.id);
      if (unitId === null) return res.status(400).json({ message: "Invalid id" });

      let isShared = false;
      let [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, unitId), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module),
      ));

      // If unit doesn't belong to this company, check if it's shared with this company
      // Wrapped in try/catch — gracefully skips if column not migrated yet in production
      if (!unit) {
        try {
          const [sharedContract] = await db.select().from(propertyContracts).where(and(
            eq(propertyContracts.unitId, unitId),
            eq(propertyContracts.linkedCompanyId, companyId),
            eq(propertyContracts.status, "ACTIVE"),
          ));
          if (sharedContract) {
            const [ownerUnit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, unitId));
            if (ownerUnit) { unit = ownerUnit; isShared = true; }
          }
        } catch (sharedErr: any) {
          console.warn(`${tag} shared-detail skipped:`, sharedErr.message?.split("\n")[0]);
        }
      }
      if (!unit) return res.status(404).json({ message: "Unit not found" });

      const [contract] = await db.select().from(propertyContracts).where(and(
        isShared
          ? eq(propertyContracts.linkedCompanyId, companyId)
          : eq(propertyContracts.companyId, companyId),
        // Shared contracts may live in any module on the owner's side; skip module filter
        ...(isShared ? [] : [eq(propertyContracts.module, module)]),
        eq(propertyContracts.unitId, unitId),
        eq(propertyContracts.status, "ACTIVE"),
      ));

      let ledger: any[] = [], rentPayments: any[] = [], guaranteePayments: any[] = [];
      if (contract) {
        await ensureMonthlyLedgerRows(contract.id);
        ledger = await db.select().from(propertyMonthlyLedger)
          .where(eq(propertyMonthlyLedger.contractId, contract.id))
          .orderBy(propertyMonthlyLedger.year, propertyMonthlyLedger.month);
        const allPayments = await db.select().from(propertyPayments)
          .where(eq(propertyPayments.contractId, contract.id))
          .orderBy(desc(propertyPayments.paymentDate));
        // Separate guarantee/deposit activity from normal rent payments.
        // A payment is a guarantee activity if its notes contain "[Guarantee release]"
        // OR if ledgerRowId is null (guarantee-to-cash inserts with ledgerRowId: null).
        guaranteePayments = allPayments.filter(
          p => p.ledgerRowId === null || (p.notes ?? "").includes("[Guarantee release]"),
        );
        rentPayments = allPayments.filter(
          p => p.ledgerRowId !== null && !(p.notes ?? "").includes("[Guarantee release]"),
        );
      }

      const pastContracts = await db.select().from(propertyContracts)
        .where(and(
          eq(propertyContracts.companyId, companyId),
          eq(propertyContracts.module, module),
          eq(propertyContracts.unitId, unitId),
          eq(propertyContracts.status, "ENDED"),
        ))
        .orderBy(desc(propertyContracts.endDate));

      res.json({ unit, contract: contract ?? null, ledger, payments: rentPayments, guaranteePayments, pastContracts, isShared });
    } catch (e: any) {
      console.error(`${tag} detail:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── CASH ACCOUNTS picker ──
  app.get(`${urlPrefix}/cash-accounts`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accts = await db.select().from(ledgerAccounts).where(and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt),
      ));
      res.json(accts.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GLOBAL PAYMENTS LOG ──
  app.get(`${urlPrefix}/payments`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const payments = await db
        .select({
          id: propertyPayments.id,
          paymentDate: propertyPayments.paymentDate,
          amount: propertyPayments.amount,
          forYear: propertyPayments.forYear,
          forMonth: propertyPayments.forMonth,
          notes: propertyPayments.notes,
          contractId: propertyPayments.contractId,
          unitId: propertyPayments.unitId,
          currency: propertyPayments.currency,
          exchangeRate: propertyPayments.exchangeRate,
          cashAccountId: propertyPayments.cashAccountId,
          voucherId: propertyPayments.voucherId,
          tenantName: propertyContracts.tenantName,
          unitNumber: propertyUnits.unitNumber,
          locationGroup: propertyUnits.locationGroup,
        })
        .from(propertyPayments)
        .leftJoin(propertyContracts, eq(propertyContracts.id, propertyPayments.contractId))
        .leftJoin(propertyUnits, eq(propertyUnits.id, propertyPayments.unitId))
        .where(and(
          eq(propertyPayments.companyId, companyId),
          eq(propertyPayments.module, module),
        ))
        .orderBy(desc(propertyPayments.paymentDate));

      res.json(payments);
    } catch (e: any) {
      console.error(`${tag} payments-log:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── MANUAL MONTHLY ROLLOVER ──
  app.post(`${urlPrefix}/run-monthly`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      await ensureMonthlyForCompany(companyId, module);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── ACCRUAL (ERP SHOP only) ────────────────────────────────────────────────
  // Manually post rent accrual journal vouchers for all unpaid ERP shop months.
  // Returns { accrued: N } where N = number of newly-posted accrual voucher rows.
  app.post(`${urlPrefix}/accrue`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      await ensureMonthlyForCompany(companyId, module);

      // Post all due, unaccrued rows as ONE combined journal voucher
      const { accrued, skipped } = await postRentAccrualForCompany(companyId, shopExpenseAccountName, module, incomeAccountName);

      res.json({ accrued, skipped });
    } catch (e: any) {
      console.error(`${tag} accrue:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── RESET + RE-ACCRUE (ERP SHOP only) ────────────────────────────────────
  // Deletes all existing individual accrual vouchers (where no payment has been
  // applied yet) and then immediately re-runs the combined accrual so the daybook
  // shows ONE journal instead of one-per-unit.
  //
  // Safe guard: rows where paidAmount > 0 are left alone — their accrual is already
  // partially settled and reversing it would leave the books inconsistent.
  //
  // Returns { reset: N, accrued: M } where:
  //   reset   = number of old individual vouchers deleted
  //   accrued = number of rows stamped with the new combined voucher
}
