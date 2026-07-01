import type { Express } from "express";
import { db, pool } from "../../db";
import { requireAuth } from "../../auth";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import {
  insuranceMembers,
  insertInsuranceMemberSchema,
  ledgerAccounts,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { z } from "zod";

/** Derive the active company for this request from the session (mirrors payroll pattern). */
function getFactoryCompanyId(req: any): number | undefined {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
}

/** Find or create a ledger account by name for a company. */
async function findOrCreateLedger(
  companyId: number,
  name: string,
  accountType: string
): Promise<{ id: number }> {
  // Check if it already exists
  const existing = await pool.query(
    `SELECT id FROM ledger_accounts WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
    [companyId, name]
  );
  if (existing.rows.length > 0) return { id: existing.rows[0].id };

  // Generate the next available numeric code for this company
  const maxRow = await pool.query(
    `SELECT MAX(CAST(code AS INTEGER)) AS max_code
     FROM ledger_accounts
     WHERE company_id = $1 AND code ~ '^[0-9]+$'`,
    [companyId]
  );
  const nextCode = String((parseInt(maxRow.rows[0]?.max_code || "0") || 0) + 1);

  // Insert, falling back gracefully if there's a code collision
  const inserted = await pool.query(
    `INSERT INTO ledger_accounts (company_id, code, name, account_type, active, is_hidden)
     VALUES ($1, $2, $3, $4, true, false)
     ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [companyId, nextCode, name, accountType]
  );
  return { id: inserted.rows[0].id };
}

export function registerFactoryInsuranceRoutes(app: Express) {
  // GET /api/insurance/members — list members for a company
  app.get("/api/insurance/members", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "companyId required" });

      const includeInactive = req.query.includeInactive === "true";

      const conditions: any[] = [eq(insuranceMembers.companyId, companyId)];
      if (!includeInactive) conditions.push(eq(insuranceMembers.active, true));

      const rows = await db
        .select()
        .from(insuranceMembers)
        .where(and(...conditions))
        .orderBy(insuranceMembers.name);

      res.json(rows);
    } catch (err: any) {
      console.error("GET /api/insurance/members error:", err);
      res.status(500).json({ message: err.message || "Failed to fetch insurance members" });
    }
  });

  // GET /api/insurance/members/:id/entries — ledger entries for a member
  app.get("/api/insurance/members/:id/entries", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "companyId required" });

      const [member] = await db
        .select()
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)));
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
        .where(
          and(
            eq(voucherEntries.ledgerAccountId, member.ledgerAccountId),
            eq(vouchers.companyId, companyId)
          )
        )
        .orderBy(desc(vouchers.voucherDate), desc(vouchers.id));

      res.json(entries);
    } catch (err: any) {
      console.error("GET /api/insurance/members/:id/entries error:", err);
      res.status(500).json({ message: err.message || "Failed to fetch entries" });
    }
  });

  // POST /api/insurance/members — create a new member
  app.post("/api/insurance/members", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertInsuranceMemberSchema.safeParse({ ...req.body, companyId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.errors });
      }

      const data = parsed.data;

      // Auto-create personal ledger account for this member
      const ledgerName = `Insurance - ${data.name}`;
      const ledger = await findOrCreateLedger(data.companyId, ledgerName, "Liability");

      const inserted = await pool.query(
        `INSERT INTO insurance_members
           (company_id, name, nationality, position_working, insurance_number,
            start_date, amount, dob, notes, active, ledger_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          data.companyId,
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
        ]
      );
      res.status(201).json(inserted.rows[0]);
    } catch (err: any) {
      console.error("POST /api/insurance/members error:", err);
      res.status(500).json({ message: err.message || "Failed to create insurance member" });
    }
  });

  // PATCH /api/insurance/members/:id — update a member (enforces company ownership)
  app.patch("/api/insurance/members/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Enforce company ownership
      const [existing] = await db
        .select()
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Member not found" });

      const updateSchema = insertInsuranceMemberSchema.partial().omit({ companyId: true });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.errors });
      }

      const data = parsed.data as any;

      // If name changed, update the ledger account name too
      if (data.name && data.name !== existing.name && existing.ledgerAccountId) {
        await db
          .update(ledgerAccounts)
          .set({ name: `Insurance - ${data.name}` })
          .where(
            and(
              eq(ledgerAccounts.id, existing.ledgerAccountId),
              eq(ledgerAccounts.companyId, companyId)
            )
          );
      }

      const [updated] = await db
        .update(insuranceMembers)
        .set(data)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("PATCH /api/insurance/members/:id error:", err);
      res.status(500).json({ message: err.message || "Failed to update insurance member" });
    }
  });

  // PATCH /api/insurance/members/:id/toggle — toggle active status (enforces company ownership)
  app.patch("/api/insurance/members/:id/toggle", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const companyId = req.body?.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Enforce company ownership
      const [existing] = await db
        .select()
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Member not found" });

      const [updated] = await db
        .update(insuranceMembers)
        .set({ active: !existing.active })
        .where(and(eq(insuranceMembers.id, id), eq(insuranceMembers.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("PATCH /api/insurance/members/:id/toggle error:", err);
      res.status(500).json({ message: err.message || "Failed to toggle member status" });
    }
  });

  // POST /api/insurance/generate — generate journal entries for a month/year
  app.post("/api/insurance/generate", requireAuth, async (req: any, res: any) => {
    try {
      const schema = z.object({
        month: z.number().min(1).max(12),
        year: z.number().min(2000).max(2100),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.errors });
      }

      const { month, year } = parsed.data;
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Period: first and last day of the chosen month
      const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Fetch active members whose startDate <= periodEnd, scoped to company
      const members = await db
        .select()
        .from(insuranceMembers)
        .where(and(eq(insuranceMembers.companyId, companyId), eq(insuranceMembers.active, true)));

      const eligibleMembers = members.filter((m) => m.startDate <= periodEnd);

      if (eligibleMembers.length === 0) {
        return res.status(400).json({ message: "No active insurance members found for this period" });
      }

      // Auto-create shared Insurance Expense account
      const expenseAccount = await findOrCreateLedger(companyId, "Insurance Expense", "Expense");

      // Ensure each member has a personal ledger account
      const memberLedgers: { memberId: number; ledgerId: number; amount: number }[] = [];
      for (const member of eligibleMembers) {
        let ledgerId = member.ledgerAccountId;
        if (!ledgerId) {
          const ledger = await findOrCreateLedger(
            companyId,
            `Insurance - ${member.name}`,
            "Liability"
          );
          ledgerId = ledger.id;
          await db
            .update(insuranceMembers)
            .set({ ledgerAccountId: ledgerId })
            .where(and(eq(insuranceMembers.id, member.id), eq(insuranceMembers.companyId, companyId)));
        }

        // Prorate for partial first month
        let memberAmount = parseFloat(member.amount);
        if (member.startDate > periodStart && member.startDate <= periodEnd) {
          const startDay = parseInt(member.startDate.split("-")[2]);
          const daysActive = lastDay - startDay + 1;
          memberAmount = parseFloat(((memberAmount / lastDay) * daysActive).toFixed(2));
        }

        memberLedgers.push({ memberId: member.id, ledgerId, amount: memberAmount });
      }

      const totalAmount = memberLedgers.reduce((s, m) => s + m.amount, 0);
      const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
      const voucherNumber = `INS-${year}-${String(month).padStart(2, "0")}-${Date.now()}`;
      const narration = `Insurance entries for ${monthLabel}`;

      const result = await db.transaction(async (tx) => {
        const [newVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber,
            voucherType: "Journal",
            description: narration,
            voucherDate: periodStart,
            totalAmount: totalAmount.toFixed(2),
            sourceModule: "ERP",
          })
          .returning({ id: vouchers.id, voucherNumber: vouchers.voucherNumber });

        const vId = newVoucher.id;

        const journalEntries = [
          // Debit: Insurance Expense (total)
          {
            voucherId: vId,
            ledgerAccountId: expenseAccount.id,
            debitAmount: totalAmount.toFixed(2),
            creditAmount: "0",
            narration,
          },
          // Credit: each member's personal account
          ...memberLedgers.map((ml) => ({
            voucherId: vId,
            ledgerAccountId: ml.ledgerId,
            debitAmount: "0",
            creditAmount: ml.amount.toFixed(2),
            narration,
          })),
        ];

        await tx.insert(voucherEntries).values(journalEntries);

        return { voucherId: vId, voucherNumber: newVoucher.voucherNumber };
      });

      res.json({
        voucherId: result.voucherId,
        voucherNumber: result.voucherNumber,
        totalAmount,
        membersCount: eligibleMembers.length,
        period: monthLabel,
      });
    } catch (err: any) {
      console.error("POST /api/insurance/generate error:", err);
      res.status(500).json({ message: err.message || "Failed to generate insurance entries" });
    }
  });
}
