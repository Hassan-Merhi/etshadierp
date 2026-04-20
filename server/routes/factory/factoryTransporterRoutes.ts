import type { Express, Request, Response } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { getOrCreateLedgerAccount } from "./_helpers";
import {
  factoryTransporters,
  factoryTransporterTransactions,
  ledgerAccounts,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { z } from "zod";

function getCompanyId(req: Request): number | null {
  const s = (req as any).session;
  return s?.factoryCompanyId || s?.currentCompanyId || null;
}

export function registerFactoryTransporterRoutes(app: Express) {

  // ── LIST all transporters (with balance summary) ──
  app.get("/api/factory/transporters", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const transporters = await db.select().from(factoryTransporters)
        .where(and(eq(factoryTransporters.companyId, companyId), eq(factoryTransporters.active, true)))
        .orderBy(asc(factoryTransporters.name));

      const ids = transporters.map(t => t.id);
      const balances: Record<number, { charged: number; paid: number }> = {};
      if (ids.length > 0) {
        const rows = await db.select({
          transporterId: factoryTransporterTransactions.transporterId,
          txType: factoryTransporterTransactions.txType,
          total: sql<string>`COALESCE(SUM(${factoryTransporterTransactions.amount}), 0)`,
        }).from(factoryTransporterTransactions)
          .where(eq(factoryTransporterTransactions.companyId, companyId))
          .groupBy(factoryTransporterTransactions.transporterId, factoryTransporterTransactions.txType);

        rows.forEach(r => {
          if (!balances[r.transporterId]) balances[r.transporterId] = { charged: 0, paid: 0 };
          if (r.txType === "charge") balances[r.transporterId].charged += Number(r.total);
          else balances[r.transporterId].paid += Number(r.total);
        });
      }

      res.json(transporters.map(t => ({
        ...t,
        totalCharged: balances[t.id]?.charged ?? 0,
        totalPaid: balances[t.id]?.paid ?? 0,
        outstanding: (balances[t.id]?.charged ?? 0) - (balances[t.id]?.paid ?? 0),
      })));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET single transporter with full statement ──
  app.get("/api/factory/transporters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);

      const [transporter] = await db.select().from(factoryTransporters)
        .where(and(eq(factoryTransporters.id, id), eq(factoryTransporters.companyId, companyId)));
      if (!transporter) return res.status(404).json({ message: "Transporter not found" });

      const transactions = await db.select().from(factoryTransporterTransactions)
        .where(and(
          eq(factoryTransporterTransactions.transporterId, id),
          eq(factoryTransporterTransactions.companyId, companyId),
        )).orderBy(asc(factoryTransporterTransactions.txDate), asc(factoryTransporterTransactions.id));

      let runningBalance = 0;
      const withBalance = transactions.map(tx => {
        if (tx.txType === "charge") runningBalance += Number(tx.amount);
        else runningBalance -= Number(tx.amount);
        return { ...tx, runningBalance };
      });

      const totalCharged = transactions.filter(t => t.txType === "charge").reduce((s, t) => s + Number(t.amount), 0);
      const totalPaid = transactions.filter(t => t.txType === "payment").reduce((s, t) => s + Number(t.amount), 0);

      res.json({ ...transporter, transactions: withBalance, totalCharged, totalPaid, outstanding: totalCharged - totalPaid });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── CREATE transporter ──
  app.post("/api/factory/transporters", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { name, phone, notes } = z.object({
        name: z.string().min(1),
        phone: z.string().optional(),
        notes: z.string().optional(),
      }).parse(req.body);

      const code = `TRANS-${name.toUpperCase().replace(/[^A-Z0-9]/g, "-").slice(0, 30)}`;
      const ledgerAccountId = await getOrCreateLedgerAccount(companyId, code, name, "Transporter Agent");

      const [created] = await db.insert(factoryTransporters).values({
        companyId, name, phone, notes, ledgerAccountId, active: true,
      }).returning();

      res.json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((x: any) => x.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── UPDATE transporter ──
  app.patch("/api/factory/transporters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);

      const { name, phone, notes } = z.object({
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
      }).parse(req.body);

      const [updated] = await db.update(factoryTransporters)
        .set({ ...(name && { name }), phone, notes })
        .where(and(eq(factoryTransporters.id, id), eq(factoryTransporters.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── RECORD CHARGE (Dr Expense / Cr Transporter Account) ──
  app.post("/api/factory/transporters/:id/charges", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transporterId = parseInt(req.params.id);

      const { amount, txDate, description, expenseAccountId } = z.object({
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        txDate: z.string().min(1),
        description: z.string().optional(),
        expenseAccountId: z.number(),
      }).parse(req.body);

      const [transporter] = await db.select().from(factoryTransporters)
        .where(and(eq(factoryTransporters.id, transporterId), eq(factoryTransporters.companyId, companyId)));
      if (!transporter) return res.status(404).json({ message: "Transporter not found" });

      const narration = description || `Transport charge - ${transporter.name}`;

      const tx = await db.transaction(async (trx) => {
        const [v] = await trx.insert(vouchers).values({
          companyId,
          voucherNumber: `TRANS-CHG-${Date.now()}-${transporterId}`,
          voucherType: "Payment",
          voucherDate: txDate as any,
          description: narration,
          totalAmount: amount,
          currency: "USD",
          sourceModule: "ERP",
        }).returning();

        await trx.insert(voucherEntries).values([
          { voucherId: v.id, ledgerAccountId: expenseAccountId, debitAmount: amount, creditAmount: "0", narration },
          { voucherId: v.id, ledgerAccountId: transporter.ledgerAccountId!, debitAmount: "0", creditAmount: amount, narration },
        ]);

        const [record] = await trx.insert(factoryTransporterTransactions).values({
          companyId, transporterId, txType: "charge",
          amount, txDate: txDate as any, description: narration,
          expenseAccountId, voucherId: v.id,
        }).returning();

        return record;
      });

      res.json(tx);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((x: any) => x.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── RECORD PAYMENT (Dr Transporter Account / Cr Cash) ──
  app.post("/api/factory/transporters/:id/payments", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transporterId = parseInt(req.params.id);

      const { amount, txDate, description, cashAccountId } = z.object({
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        txDate: z.string().min(1),
        description: z.string().optional(),
        cashAccountId: z.number(),
      }).parse(req.body);

      const [transporter] = await db.select().from(factoryTransporters)
        .where(and(eq(factoryTransporters.id, transporterId), eq(factoryTransporters.companyId, companyId)));
      if (!transporter) return res.status(404).json({ message: "Transporter not found" });

      const narration = description || `Payment to transporter - ${transporter.name}`;

      const tx = await db.transaction(async (trx) => {
        const [v] = await trx.insert(vouchers).values({
          companyId,
          voucherNumber: `TRANS-PAY-${Date.now()}-${transporterId}`,
          voucherType: "Payment",
          voucherDate: txDate as any,
          description: narration,
          totalAmount: amount,
          currency: "USD",
          sourceModule: "ERP",
        }).returning();

        await trx.insert(voucherEntries).values([
          { voucherId: v.id, ledgerAccountId: transporter.ledgerAccountId!, debitAmount: amount, creditAmount: "0", narration },
          { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: "0", creditAmount: amount, narration },
        ]);

        const [record] = await trx.insert(factoryTransporterTransactions).values({
          companyId, transporterId, txType: "payment",
          amount, txDate: txDate as any, description: narration,
          cashAccountId, voucherId: v.id,
        }).returning();

        return record;
      });

      res.json(tx);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((x: any) => x.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE a transaction ──
  app.delete("/api/factory/transporters/:id/transactions/:txId", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const txId = parseInt(req.params.txId);

      const [tx] = await db.select().from(factoryTransporterTransactions)
        .where(and(eq(factoryTransporterTransactions.id, txId), eq(factoryTransporterTransactions.companyId, companyId)));
      if (!tx) return res.status(404).json({ message: "Transaction not found" });

      await db.transaction(async (trx) => {
        if (tx.voucherId) {
          await trx.delete(voucherEntries).where(eq(voucherEntries.voucherId, tx.voucherId));
          await trx.delete(vouchers).where(eq(vouchers.id, tx.voucherId));
        }
        await trx.delete(factoryTransporterTransactions).where(eq(factoryTransporterTransactions.id, txId));
      });

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET cash/expense accounts for forms ──
  app.get("/api/factory/transporter-accounts", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const accounts = await db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name, accountType: ledgerAccounts.accountType })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.active, true)))
        .orderBy(asc(ledgerAccounts.name));

      res.json(accounts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
