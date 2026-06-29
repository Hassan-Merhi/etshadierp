import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  insuranceMembers,
  insertInsuranceMemberSchema,
  ledgerAccounts,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { z } from "zod";

/** Find or create a ledger account by name for a company. */
async function findOrCreateLedger(
  companyId: number,
  name: string,
  accountType: string
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name)));
  if (existing) return existing;

  const [maxCodeRow] = await db
    .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
  const nextCode = String((parseInt((maxCodeRow as any)?.maxCode || "0") || 0) + 1);

  const [created] = await db
    .insert(ledgerAccounts)
    .values({ companyId, code: nextCode, name, accountType, active: true, isHidden: false })
    .returning({ id: ledgerAccounts.id });
  return created;
}

export function registerFactoryInsuranceRoutes(app: Express) {
  // GET /api/insurance/members — list members for a company
  app.get("/api/insurance/members", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = parseInt(req.query.companyId as string);
      if (!companyId) return res.status(400).json({ message: "companyId required" });

      const includeInactive = req.query.includeInactive === "true";

      const conditions = [eq(insuranceMembers.companyId, companyId)];
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

  // POST /api/insurance/members — create a new member
  app.post("/api/insurance/members", requireAuth, async (req: any, res: any) => {
    try {
      const parsed = insertInsuranceMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.errors });
      }

      const data = parsed.data;

      // Auto-create personal ledger account for this member
      const ledgerName = `Insurance - ${data.name}`;
      const ledger = await findOrCreateLedger(data.companyId, ledgerName, "Liability");

      const [member] = await db
        .insert(insuranceMembers)
        .values({ ...data, ledgerAccountId: ledger.id })
        .returning();

      res.status(201).json(member);
    } catch (err: any) {
      console.error("POST /api/insurance/members error:", err);
      res.status(500).json({ message: err.message || "Failed to create insurance member" });
    }
  });

  // PATCH /api/insurance/members/:id — update a member
  app.patch("/api/insurance/members/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const [existing] = await db
        .select()
        .from(insuranceMembers)
        .where(eq(insuranceMembers.id, id));
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
          .where(eq(ledgerAccounts.id, existing.ledgerAccountId));
      }

      const [updated] = await db
        .update(insuranceMembers)
        .set(data)
        .where(eq(insuranceMembers.id, id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("PATCH /api/insurance/members/:id error:", err);
      res.status(500).json({ message: err.message || "Failed to update insurance member" });
    }
  });

  // PATCH /api/insurance/members/:id/toggle — toggle active status
  app.patch("/api/insurance/members/:id/toggle", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db
        .select()
        .from(insuranceMembers)
        .where(eq(insuranceMembers.id, id));
      if (!existing) return res.status(404).json({ message: "Member not found" });

      const [updated] = await db
        .update(insuranceMembers)
        .set({ active: !existing.active })
        .where(eq(insuranceMembers.id, id))
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
        companyId: z.number().min(1),
        month: z.number().min(1).max(12),
        year: z.number().min(2000).max(2100),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation failed", errors: parsed.error.errors });
      }

      const { companyId, month, year } = parsed.data;

      // Period: first and last day of the chosen month
      const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Fetch active members whose startDate <= periodEnd
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
            .where(eq(insuranceMembers.id, member.id));
        }

        // Prorate for partial first month
        let memberAmount = parseFloat(member.amount);
        if (member.startDate > periodStart && member.startDate <= periodEnd) {
          const startDay = parseInt(member.startDate.split("-")[2]);
          const daysInMonth = lastDay;
          const daysActive = daysInMonth - startDay + 1;
          memberAmount = parseFloat(((memberAmount / daysInMonth) * daysActive).toFixed(2));
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

      // Build journal entries: Dr Insurance Expense (total) + Cr each member account
      const journalEntries: {
        voucherId: number;
        ledgerAccountId: number;
        debitAmount: string;
        creditAmount: string;
        narration: string;
      }[] = [];

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
          .returning({ id: vouchers.id });

        const vId = newVoucher.id;

        // Debit: Insurance Expense (total)
        journalEntries.push({
          voucherId: vId,
          ledgerAccountId: expenseAccount.id,
          debitAmount: totalAmount.toFixed(2),
          creditAmount: "0",
          narration,
        });

        // Credit: each member's personal account
        for (const ml of memberLedgers) {
          journalEntries.push({
            voucherId: vId,
            ledgerAccountId: ml.ledgerId,
            debitAmount: "0",
            creditAmount: ml.amount.toFixed(2),
            narration,
          });
        }

        await tx.insert(voucherEntries).values(journalEntries);

        return { voucherId: vId };
      });

      res.json({
        voucherId: result.voucherId,
        voucherNumber,
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
