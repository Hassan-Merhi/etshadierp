import type { Express } from "express";
import { db } from "../db";
import { requireAuth, requireNonPOS } from "../auth";
import {
  ledgerAccounts, vouchers, voucherEntries, containers,
} from "@shared/schema";
import { eq, and, asc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { parseId } from "../lib/parseId";

// ── helpers ──────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Extract a container number (4 letters + 7 digits) from free text
function extractContainerNumber(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b([A-Z]{4}[0-9]{7})\b/);
  return m ? m[1] : null;
}

// ── route registration ────────────────────────────────────────────────────────

export function registerTransporterStatementRoutes(app: Express) {

  // GET /api/transporter-statement/transporters
  app.get("/api/transporter-statement/transporters", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const accounts = await db
        .select({
          id: ledgerAccounts.id,
          name: ledgerAccounts.name,
          code: ledgerAccounts.code,
          accountType: ledgerAccounts.accountType,
          openingBalance: ledgerAccounts.openingBalance,
          openingBalanceSide: ledgerAccounts.openingBalanceSide,
        })
        .from(ledgerAccounts)
        .where(and(
          eq(ledgerAccounts.companyId, companyId),
          eq(ledgerAccounts.accountType, "Loans"),
          isNull(ledgerAccounts.deletedAt),
        ))
        .orderBy(asc(ledgerAccounts.name));

      res.json(accounts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/transporter-statement/:accountId/settings
  app.get("/api/transporter-statement/:accountId/settings", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = parseId(req.params.accountId);
      if (accountId === null) return res.status(400).json({ message: "Invalid account ID" });

      const rows = await db.execute(
        sql`SELECT payment_terms_days FROM transporter_payment_settings
            WHERE company_id = ${companyId} AND ledger_account_id = ${accountId} LIMIT 1`
      );
      const row = rows.rows?.[0] as { payment_terms_days: number } | undefined;
      res.json({ paymentTermsDays: row?.payment_terms_days ?? 0 });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PUT /api/transporter-statement/:accountId/settings
  app.put("/api/transporter-statement/:accountId/settings", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = parseId(req.params.accountId);
      if (accountId === null) return res.status(400).json({ message: "Invalid account ID" });

      const { paymentTermsDays } = z.object({
        paymentTermsDays: z.number().int().min(0).max(365),
      }).parse(req.body);

      await db.execute(
        sql`INSERT INTO transporter_payment_settings (company_id, ledger_account_id, payment_terms_days)
            VALUES (${companyId}, ${accountId}, ${paymentTermsDays})
            ON CONFLICT (company_id, ledger_account_id)
            DO UPDATE SET payment_terms_days = EXCLUDED.payment_terms_days, updated_at = now()`
      );

      res.json({ paymentTermsDays });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // PUT /api/transporter-entry-due-dates/:entryId
  app.put("/api/transporter-entry-due-dates/:entryId", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const entryId = parseId(req.params.entryId);
      if (entryId === null) return res.status(400).json({ message: "Invalid entry ID" });

      const { dueDate } = z.object({
        dueDate: z.string().nullable(),
      }).parse(req.body);

      if (dueDate) {
        await db.execute(
          sql`INSERT INTO transporter_entry_due_dates (voucher_entry_id, company_id, due_date)
              VALUES (${entryId}, ${companyId}, ${dueDate})
              ON CONFLICT (voucher_entry_id)
              DO UPDATE SET due_date = EXCLUDED.due_date, updated_at = now()`
        );
      } else {
        await db.execute(
          sql`DELETE FROM transporter_entry_due_dates WHERE voucher_entry_id = ${entryId}`
        );
      }

      res.json({ ok: true, dueDate });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // POST /api/transporter-statement/:accountId/reallocate
  // FIFO allocation: clears existing allocations for account and re-runs
  app.post("/api/transporter-statement/:accountId/reallocate", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = parseId(req.params.accountId);
      if (accountId === null) return res.status(400).json({ message: "Invalid account ID" });

      // Verify account belongs to this company
      const accRows = await db.execute(
        sql`SELECT id FROM ledger_accounts WHERE id = ${accountId} AND company_id = ${companyId} LIMIT 1`
      );
      if (!accRows.rows?.length) return res.status(404).json({ message: "Account not found" });

      // Fetch all entries for this account ordered by date
      const entryRows = await db.execute(sql`
        SELECT
          ve.id,
          ve.debit_amount,
          ve.credit_amount,
          v.voucher_date
        FROM voucher_entries ve
        JOIN vouchers v ON v.id = ve.voucher_id
        WHERE ve.ledger_account_id = ${accountId}
          AND v.company_id = ${companyId}
          AND (v.deleted_at IS NULL)
          AND (v.optional IS DISTINCT FROM true)
        ORDER BY v.voucher_date ASC, ve.id ASC
      `);

      const entries = entryRows.rows as Array<{
        id: number;
        debit_amount: string;
        credit_amount: string;
        voucher_date: string;
      }>;

      // Separate credits (charges) and debits (payments)
      const creditEntries = entries
        .filter((e) => parseFloat(e.credit_amount || "0") > 0)
        .map((e) => ({ id: e.id, total: parseFloat(e.credit_amount), remaining: parseFloat(e.credit_amount) }));

      const debitEntries = entries
        .filter((e) => parseFloat(e.debit_amount || "0") > 0)
        .map((e) => ({ id: e.id, total: parseFloat(e.debit_amount), remaining: parseFloat(e.debit_amount) }));

      // Clear existing allocations for this account
      await db.execute(
        sql`DELETE FROM transporter_payment_allocations WHERE company_id = ${companyId}
            AND (credit_entry_id = ANY(${sql.raw(`ARRAY[${creditEntries.map((c) => c.id).join(",") || "NULL"}]::integer[]`)})
              OR debit_entry_id = ANY(${sql.raw(`ARRAY[${debitEntries.map((d) => d.id).join(",") || "NULL"}]::integer[]`)}))`
      );

      // FIFO: iterate debits in date order, distribute against oldest unpaid credits
      const newAllocations: Array<{ debitId: number; creditId: number; amount: number }> = [];

      for (const debit of debitEntries) {
        let debitRemaining = debit.remaining;
        for (const credit of creditEntries) {
          if (debitRemaining <= 0) break;
          if (credit.remaining <= 0) continue;

          const alloc = Math.min(debitRemaining, credit.remaining);
          newAllocations.push({ debitId: debit.id, creditId: credit.id, amount: alloc });
          debitRemaining -= alloc;
          credit.remaining -= alloc;
        }
      }

      // Insert new allocations in bulk
      if (newAllocations.length > 0) {
        for (const a of newAllocations) {
          await db.execute(
            sql`INSERT INTO transporter_payment_allocations
                  (company_id, debit_entry_id, credit_entry_id, allocated_amount)
                VALUES (${companyId}, ${a.debitId}, ${a.creditId}, ${a.amount})`
          );
        }
      }

      res.json({ ok: true, allocationsCreated: newAllocations.length });
    } catch (err: any) {
      console.error("[TransporterStatement/reallocate]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/transporter-statement/:accountId/statement
  app.get("/api/transporter-statement/:accountId/statement", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = parseId(req.params.accountId);
      if (accountId === null) return res.status(400).json({ message: "Invalid account ID" });

      const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

      // Verify account belongs to this company
      const [account] = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)))
        .limit(1);
      if (!account) return res.status(404).json({ message: "Account not found" });

      // Get payment terms setting
      const settingsRows = await db.execute(
        sql`SELECT payment_terms_days FROM transporter_payment_settings
            WHERE company_id = ${companyId} AND ledger_account_id = ${accountId} LIMIT 1`
      );
      const paymentTermsDays: number = (settingsRows.rows?.[0] as any)?.payment_terms_days ?? 0;

      // Fetch all voucher entries for this account (all time for running balance)
      const rawEntries = await db.execute(sql`
        SELECT
          ve.id,
          ve.voucher_id,
          ve.debit_amount,
          ve.credit_amount,
          ve.narration,
          v.voucher_date,
          v.description       AS voucher_description,
          v.voucher_number,
          v.voucher_type,
          COALESCE(tedd.due_date, NULL) AS manual_due_date
        FROM voucher_entries ve
        JOIN vouchers v ON v.id = ve.voucher_id
        LEFT JOIN transporter_entry_due_dates tedd ON tedd.voucher_entry_id = ve.id
        WHERE ve.ledger_account_id = ${accountId}
          AND v.company_id = ${companyId}
          AND (v.deleted_at IS NULL)
          AND (v.optional IS DISTINCT FROM true)
        ORDER BY v.voucher_date ASC, ve.id ASC
      `);

      // Fetch containers for this company (for number plate / offload date lookup)
      const allContainers = await db
        .select({
          containerNumber: containers.containerNumber,
          numberPlate: containers.numberPlate,
          offloadDate: containers.offloadDate,
        })
        .from(containers)
        .where(eq(containers.companyId, companyId));

      const containerMap = new Map<string, { numberPlate: string | null; offloadDate: string | null }>();
      for (const c of allContainers) {
        containerMap.set(c.containerNumber.toUpperCase(), {
          numberPlate: c.numberPlate ?? null,
          offloadDate: c.offloadDate ?? null,
        });
      }

      // Fetch paid amounts per credit entry from allocations table
      const allocRows = await db.execute(sql`
        SELECT credit_entry_id, SUM(allocated_amount) AS paid_amount
        FROM transporter_payment_allocations
        WHERE company_id = ${companyId}
        GROUP BY credit_entry_id
      `);
      const paidMap = new Map<number, number>();
      for (const a of (allocRows.rows as any[])) {
        paidMap.set(Number(a.credit_entry_id), parseFloat(a.paid_amount || "0"));
      }

      // Opening balance
      const ob = parseFloat(account.openingBalance || "0");
      const obSide = account.openingBalanceSide;
      let runningBalance = obSide === "Dr" ? -ob : ob;

      const allRows = rawEntries.rows as any[];

      // Build rows with running balance
      const statementRows = allRows.map((row: any) => {
        const debit  = parseFloat(row.debit_amount  || "0");
        const credit = parseFloat(row.credit_amount || "0");
        runningBalance = runningBalance + credit - debit;

        const containerNum =
          extractContainerNumber(row.voucher_description) ||
          extractContainerNumber(row.narration);

        let numberPlate: string | null = null;
        let offloadDate: string | null = null;
        if (containerNum) {
          const c = containerMap.get(containerNum.toUpperCase());
          if (c) {
            numberPlate = c.numberPlate;
            offloadDate = c.offloadDate;
          }
        }

        let dateToBePaid: string | null = null;
        if (row.manual_due_date) {
          dateToBePaid = row.manual_due_date;
        } else if (offloadDate && paymentTermsDays > 0) {
          dateToBePaid = addDays(offloadDate, paymentTermsDays);
        }

        // Determine payment status for credit rows
        let status: "unpaid" | "partial" | "paid" | null = null;
        let paidAmount: string | null = null;
        if (credit > 0) {
          const paid = paidMap.get(row.id) ?? 0;
          paidAmount = paid.toFixed(2);
          if (paid <= 0) {
            status = "unpaid";
          } else if (paid >= credit - 0.005) {
            status = "paid";
          } else {
            status = "partial";
          }
        }

        return {
          id: row.id,
          voucherId: row.voucher_id,
          voucherNumber: row.voucher_number,
          voucherType: row.voucher_type,
          date: row.voucher_date,
          description: row.voucher_description || row.narration || "",
          narration: row.narration || "",
          debit: debit > 0 ? debit.toFixed(2) : null,
          credit: credit > 0 ? credit.toFixed(2) : null,
          runningBalance: runningBalance.toFixed(2),
          numberPlate,
          offloadDate,
          dateToBePaid,
          hasManualDueDate: !!row.manual_due_date,
          containerNumber: containerNum,
          status,
          paidAmount,
        };
      });

      // Apply date filters AFTER computing running balance
      const filteredRows = statementRows.filter((r) => {
        if (dateFrom && r.date < dateFrom) return false;
        if (dateTo && r.date > dateTo) return false;
        return true;
      });

      // Opening balance for the filtered window
      const filteredOpeningBalance = filteredRows.length > 0
        ? (() => {
            const firstIdx = allRows.findIndex((r: any) => r.id === filteredRows[0].id);
            if (firstIdx === 0) {
              return (obSide === "Dr" ? -ob : ob).toFixed(2);
            }
            return statementRows[firstIdx - 1].runningBalance;
          })()
        : runningBalance.toFixed(2);

      res.json({
        account: {
          id: account.id,
          name: account.name,
          code: account.code,
          openingBalance: account.openingBalance,
          openingBalanceSide: account.openingBalanceSide,
        },
        paymentTermsDays,
        openingBalance: filteredOpeningBalance,
        closingBalance: filteredRows.length > 0
          ? filteredRows[filteredRows.length - 1].runningBalance
          : runningBalance.toFixed(2),
        rows: filteredRows,
      });
    } catch (err: any) {
      console.error("[TransporterStatement]", err);
      res.status(500).json({ message: err.message });
    }
  });
}
