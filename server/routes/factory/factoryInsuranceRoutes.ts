import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, or } from "drizzle-orm";
import { db, pool } from "../../db";
import { requireAuth } from "../../auth";
import {
  companies,
  insuranceMembers,
  insertInsuranceMemberSchema,
  ledgerAccounts,
  voucherEntries,
  vouchers,
} from "@shared/schema";
import {
  isCompanyIsolationError,
  resolveRequestCompanyId,
} from "../../services/security/requestCompanyScope";
import { insertVoucherWithEntriesTx } from "../../services/accounting/voucherPostingService";

function handleCompanyIsolationError(res: any, error: unknown): boolean {
  if (!isCompanyIsolationError(error)) return false;
  res.status(error.code === "RESOURCE_COMPANY_INVALID" ? 400 : 404).json({ message: "Not found" });
  return true;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function findOrCreateLedger(
  companyId: number,
  name: string,
  accountType: string,
): Promise<{ id: number }> {
  const existing = await pool.query(
    `SELECT id FROM ledger_accounts WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
    [companyId, name],
  );
  if (existing.rows.length > 0) return { id: existing.rows[0].id };

  const maxRow = await pool.query(
    `SELECT MAX(CAST(code AS INTEGER)) AS max_code
     FROM ledger_accounts
     WHERE company_id = $1 AND code ~ '^[0-9]+$'`,
    [companyId],
  );
  const nextCode = String((parseInt(maxRow.rows[0]?.max_code || "0") || 0) + 1);

  const inserted = await pool.query(
    `INSERT INTO ledger_accounts (company_id, code, name, account_type, active, is_hidden)
     VALUES ($1, $2, $3, $4, true, false)
     ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [companyId, nextCode, name, accountType],
  );
  return { id: inserted.rows[0].id };
}

export function registerFactoryInsuranceRoutes(app: Express) {
  // ── Factory company resolution ──────────────────────────────────────────────
  // /api/insurance/* is registered outside /api/factory/* so the factory
  // middleware that sets session.factoryCompanyId never runs automatically.
  // This guard mirrors that middleware exactly: if factoryCompanyId is not yet
  // in the session it resolves it from currentCompanyId (checking it is a
  // factory company) or falls back to the first active factory company.
  app.use("/api/insurance", async (req: any, _res: any, next: any) => {
    try {
      const session = req.session as any;
      if (!session?.userId || session.factoryCompanyId) return next();

      const currentCompanyId = session.currentCompanyId;
      if (currentCompanyId) {
        const [co] = await db
          .select({ id: companies.id, companyType: companies.companyType })
          .from(companies)
          .where(eq(companies.id, currentCompanyId));
        if (co?.companyType === "factory" || co?.companyType === "factory_v2") {
          session.factoryCompanyId = co.id;
          return next();
        }
      }

      // currentCompanyId is ERP/other — fall back to any active factory company
      const [factoryComp] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            or(eq(companies.companyType, "factory"), eq(companies.companyType, "factory_v2")),
            eq(companies.active, true),
          ),
        )
        .orderBy(companies.id)
        .limit(1);
      if (factoryComp) {
        session.factoryCompanyId = factoryComp.id;
      } else if (currentCompanyId) {
        session.factoryCompanyId = currentCompanyId;
      }
      next();
    } catch {
      next();
    }
  });

  app.get("/api/insurance/members", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = resolveRequestCompanyId(req);
      const includeInactive = req.query.includeInactive === "true";
      const where = includeInactive
        ? eq(insuranceMembers.companyId, companyId)
        : and(eq(insuranceMembers.companyId, companyId), eq(insuranceMembers.active, true));
      const rows = await db.select().from(insuranceMembers).where(where).orderBy(insuranceMembers.name);
      res.json(rows);
    } catch (error: unknown) {
      if (handleCompanyIsolationError(res, error)) return;
      console.error("GET /api/insurance/members error:", error);
      res.status(500).json({ message: errorMessage(error, "Failed to fetch insurance members") });
    }
  });

  app.get("/api/insurance/members/:id/entries", requireAuth, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      const companyId = resolveRequestCompanyId(req);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });

      const [member] = await db
        .select({ ledgerAccountId: insuranceMembers.ledgerAccountId })
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)))
        .limit(1);
      if (!member) return res.status(404).json({ message: "Member not found" });
      if (!member.ledgerAccountId) return res.json([]);

      const entries = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          narration: voucherEntries.narration,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(eq(voucherEntries.ledgerAccountId, member.ledgerAccountId), eq(vouchers.companyId, companyId)))
        .orderBy(desc(vouchers.voucherDate), desc(vouchers.id));
      res.json(entries);
    } catch (error: unknown) {
      if (handleCompanyIsolationError(res, error)) return;
      console.error("GET /api/insurance/members/:id/entries error:", error);
      res.status(500).json({ message: errorMessage(error, "Failed to fetch entries") });
    }
  });

  app.post("/api/insurance/members", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = resolveRequestCompanyId(req);
      const parsed = insertInsuranceMemberSchema.safeParse({ ...req.body, companyId });
      if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.errors });
      const data = parsed.data;
      const ledger = await findOrCreateLedger(companyId, `Insurance - ${data.name}`, "Liability");
      const inserted = await pool.query(
        `INSERT INTO insurance_members
           (company_id, name, nationality, position_working, insurance_number,
            start_date, amount, dob, notes, active, ledger_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          companyId,
          data.name,
          data.nationality ?? null,
          data.positionWorking ?? null,
          data.insuranceNumber ?? null,
          data.startDate,
          data.amount,
          data.dob ?? null,
          data.notes ?? null,
          data.active ?? true,
          ledger.id,
        ],
      );
      res.status(201).json(inserted.rows[0]);
    } catch (error: unknown) {
      if (handleCompanyIsolationError(res, error)) return;
      console.error("POST /api/insurance/members error:", error);
      res.status(500).json({ message: errorMessage(error, "Failed to create insurance member") });
    }
  });

  app.patch("/api/insurance/members/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
      const companyId = resolveRequestCompanyId(req);
      const [existing] = await db
        .select({ name: insuranceMembers.name, ledgerAccountId: insuranceMembers.ledgerAccountId })
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Member not found" });

      const parsed = insertInsuranceMemberSchema.partial().omit({ companyId: true }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.errors });
      const data = parsed.data;
      if (data.name && data.name !== existing.name && existing.ledgerAccountId) {
        await db
          .update(ledgerAccounts)
          .set({ name: `Insurance - ${data.name}` })
          .where(and(eq(ledgerAccounts.id, existing.ledgerAccountId), eq(ledgerAccounts.companyId, companyId)));
      }
      const [updated] = await db
        .update(insuranceMembers)
        .set(data)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)))
        .returning();
      res.json(updated);
    } catch (error: unknown) {
      if (handleCompanyIsolationError(res, error)) return;
      console.error("PATCH /api/insurance/members/:id error:", error);
      res.status(500).json({ message: errorMessage(error, "Failed to update insurance member") });
    }
  });

  app.patch("/api/insurance/members/:id/toggle", requireAuth, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
      const companyId = resolveRequestCompanyId(req);
      const [existing] = await db
        .select({ active: insuranceMembers.active })
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Member not found" });
      const [updated] = await db
        .update(insuranceMembers)
        .set({ active: !existing.active })
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)))
        .returning();
      res.json(updated);
    } catch (error: unknown) {
      if (handleCompanyIsolationError(res, error)) return;
      console.error("PATCH /api/insurance/members/:id/toggle error:", error);
      res.status(500).json({ message: errorMessage(error, "Failed to toggle member status") });
    }
  });

  app.delete("/api/insurance/members/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
      const companyId = resolveRequestCompanyId(req);
      const [existing] = await db
        .select({ ledgerAccountId: insuranceMembers.ledgerAccountId })
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Member not found" });
      await db.delete(insuranceMembers).where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)));
      if (existing.ledgerAccountId) {
        await pool.query(`UPDATE ledger_accounts SET deleted_at = NOW() WHERE id = $1 AND company_id = $2`, [existing.ledgerAccountId, companyId]);
      }
      res.json({ success: true });
    } catch (error: unknown) {
      if (handleCompanyIsolationError(res, error)) return;
      console.error("DELETE /api/insurance/members/:id error:", error);
      res.status(500).json({ message: errorMessage(error, "Failed to delete insurance member") });
    }
  });

  app.post("/api/insurance/generate", requireAuth, async (req: any, res: any) => {
    try {
      const parsed = z.object({ month: z.number().min(1).max(12), year: z.number().min(2000).max(2100) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.errors });
      const { month, year } = parsed.data;
      const companyId = resolveRequestCompanyId(req);
      const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const members = await db
        .select({
          id: insuranceMembers.id,
          name: insuranceMembers.name,
          startDate: insuranceMembers.startDate,
          amount: insuranceMembers.amount,
          ledgerAccountId: insuranceMembers.ledgerAccountId,
        })
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.companyId, companyId), eq(insuranceMembers.active, true)));
      const eligibleMembers = members.filter((member) => member.startDate <= periodEnd);
      if (eligibleMembers.length === 0) return res.status(400).json({ message: "No active insurance members found for this period" });

      const expenseAccount = await findOrCreateLedger(companyId, "Insurance Expense", "Expense");
      const memberLedgers: { ledgerId: number; amount: number }[] = [];
      for (const member of eligibleMembers) {
        let ledgerId = member.ledgerAccountId;
        if (!ledgerId) {
          const ledger = await findOrCreateLedger(companyId, `Insurance - ${member.name}`, "Liability");
          ledgerId = ledger.id;
          await db
            .update(insuranceMembers)
            .set({ ledgerAccountId: ledgerId })
            .where(and(eq(insuranceMembers.id, member.id), eq(insuranceMembers.companyId, companyId)));
        }
        let memberAmount = parseFloat(member.amount);
        if (member.startDate > periodStart && member.startDate <= periodEnd) {
          const startDay = parseInt(member.startDate.split("-")[2]);
          memberAmount = parseFloat(((memberAmount / lastDay) * (lastDay - startDay + 1)).toFixed(2));
        }
        memberLedgers.push({ ledgerId, amount: memberAmount });
      }

      const totalAmount = memberLedgers.reduce((sum, member) => sum + member.amount, 0);
      const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
      const voucherNumber = `INS-${year}-${String(month).padStart(2, "0")}-${Date.now()}`;
      const narration = `Insurance entries for ${monthLabel}`;
      const result = await db.transaction(async (tx) => {
        return insertVoucherWithEntriesTx(
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
          [
            {
              ledgerAccountId: expenseAccount.id,
              debitAmount: "0",
              creditAmount: totalAmount.toFixed(2),
              narration,
            },
            ...memberLedgers.map((member) => ({
              ledgerAccountId: member.ledgerId,
              debitAmount: member.amount.toFixed(2),
              creditAmount: "0",
              narration,
            })),
          ],
        );
      });

      res.json({
        voucherId: result.voucher.id,
        voucherNumber: result.voucher.voucherNumber,
        totalAmount,
        membersCount: eligibleMembers.length,
        period: monthLabel,
      });
    } catch (error: unknown) {
      if (handleCompanyIsolationError(res, error)) return;
      console.error("POST /api/insurance/generate error:", error);
      res.status(500).json({ message: errorMessage(error, "Failed to generate insurance entries") });
    }
  });
}
