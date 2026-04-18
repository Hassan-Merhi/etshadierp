import type { Express, Request, Response } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import {
  propertyUnits,
  propertyContracts,
  propertyMonthlyLedger,
  propertyPayments,
  insertPropertyUnitSchema,
  insertPropertyContractSchema,
  ledgerAccounts,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { eq, and, sql, desc, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

type RentalModule = "PROPERTIES" | "ERP" | "FACTORY";

function getCompanyId(req: Request): number | null {
  return req.session.currentCompanyId ?? null;
}

async function findOrCreateLedgerAccount(
  tx: any,
  companyId: number,
  name: string,
  accountType: "Income" | "Liability",
  codePrefix: string,
): Promise<number> {
  const [existing] = await tx.select().from(ledgerAccounts).where(and(
    eq(ledgerAccounts.companyId, companyId),
    eq(ledgerAccounts.name, name),
    isNull(ledgerAccounts.deletedAt),
  ));
  if (existing) return existing.id;
  const code = `${codePrefix}-${Date.now()}`;
  const [created] = await tx.insert(ledgerAccounts).values({
    companyId, code, name, accountType, active: true,
  }).returning();
  return created.id;
}

async function ensureMonthlyLedgerRows(contractId: number) {
  const [contract] = await db.select().from(propertyContracts).where(eq(propertyContracts.id, contractId));
  if (!contract || contract.status !== "ACTIVE") return;

  const start = new Date(contract.startDate as any);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1;

  const periods: Array<{ year: number; month: number }> = [];
  let y = startYear, m = startMonth;
  while (y < curYear || (y === curYear && m <= curMonth)) {
    periods.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
    if (periods.length > 600) break;
  }
  if (periods.length === 0) return;

  await db.insert(propertyMonthlyLedger).values(
    periods.map(p => ({
      companyId: contract.companyId,
      module: contract.module,
      contractId: contract.id,
      unitId: contract.unitId,
      year: p.year,
      month: p.month,
      expectedAmount: contract.rentalAmount,
      paidAmount: "0",
    }))
  ).onConflictDoNothing({
    target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
  });
}

async function ensureMonthlyForCompany(companyId: number, module: RentalModule) {
  const active = await db
    .select({ id: propertyContracts.id })
    .from(propertyContracts)
    .where(and(
      eq(propertyContracts.companyId, companyId),
      eq(propertyContracts.module, module),
      eq(propertyContracts.status, "ACTIVE"),
    ));
  for (const c of active) await ensureMonthlyLedgerRows(c.id);
}

export function registerRentalRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
) {
  const tag = `[${module}/rental]`;

  // ── UNITS list ──
  app.get(`${urlPrefix}/units`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const unitType = (req.query.unitType as string) || "WAREHOUSE";

      await ensureMonthlyForCompany(companyId, module);

      const units = await db.select().from(propertyUnits)
        .where(and(
          eq(propertyUnits.companyId, companyId),
          eq(propertyUnits.module, module),
          eq(propertyUnits.unitType, unitType),
          eq(propertyUnits.active, true),
        ))
        .orderBy(propertyUnits.locationGroup, propertyUnits.sortOrder, propertyUnits.unitNumber);

      const unitIds = units.map(u => u.id);
      const contracts = unitIds.length
        ? await db.select().from(propertyContracts).where(and(
            eq(propertyContracts.companyId, companyId),
            eq(propertyContracts.module, module),
            inArray(propertyContracts.unitId, unitIds),
            eq(propertyContracts.status, "ACTIVE"),
          ))
        : [];
      const contractByUnit = new Map<number, typeof contracts[0]>();
      contracts.forEach(c => contractByUnit.set(c.unitId, c));

      const contractIds = contracts.map(c => c.id);
      const outstandingByContract = new Map<number, number>();
      if (contractIds.length > 0) {
        const rows = await db.select({
          contractId: propertyMonthlyLedger.contractId,
          expected: sql<string>`COALESCE(SUM(${propertyMonthlyLedger.expectedAmount}), 0)`,
          paid: sql<string>`COALESCE(SUM(${propertyMonthlyLedger.paidAmount}), 0)`,
        }).from(propertyMonthlyLedger)
          .where(inArray(propertyMonthlyLedger.contractId, contractIds))
          .groupBy(propertyMonthlyLedger.contractId);
        rows.forEach(r => {
          outstandingByContract.set(r.contractId, Number(r.expected) - Number(r.paid));
        });
      }

      res.json(units.map(u => {
        const c = contractByUnit.get(u.id);
        return { ...u, contract: c ?? null, outstanding: c ? (outstandingByContract.get(c.id) ?? 0) : null };
      }));
    } catch (e: any) {
      console.error(`${tag} units:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── CREATE unit ──
  app.post(`${urlPrefix}/units`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const data = insertPropertyUnitSchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(propertyUnits).values({ ...data, module } as any).returning();
      res.json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      res.status(500).json({ error: e.message });
    }
  });

  // ── PATCH unit ──
  app.patch(`${urlPrefix}/units/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const id = parseInt(req.params.id);
      const allowed = ["unitNumber", "size", "dimensions", "locationGroup", "notes", "sortOrder", "active"];
      const updates: any = {};
      for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
      const [updated] = await db.update(propertyUnits).set(updates)
        .where(and(eq(propertyUnits.id, id), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module)))
        .returning();
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE unit ──
  app.delete(`${urlPrefix}/units/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const id = parseInt(req.params.id);
      const [active] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, id),
        eq(propertyContracts.status, "ACTIVE"),
      ));
      if (active) return res.status(400).json({ error: "Cannot delete: unit has active contract. End contract first." });
      await db.update(propertyUnits).set({ active: false })
        .where(and(eq(propertyUnits.id, id), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── START CONTRACT ──
  app.post(`${urlPrefix}/contracts`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const data = insertPropertyContractSchema.parse({ ...req.body, companyId });

      const [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, data.unitId),
        eq(propertyUnits.companyId, companyId),
        eq(propertyUnits.module, module),
      ));
      if (!unit) return res.status(404).json({ error: "Unit not found" });

      const [existing] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, data.unitId),
        eq(propertyContracts.status, "ACTIVE"),
      ));
      if (existing) return res.status(400).json({ error: "Unit already has an active contract" });

      const [created] = await db.insert(propertyContracts).values({ ...data, module } as any).returning();
      await ensureMonthlyLedgerRows(created.id);
      res.json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      console.error(`${tag} contracts:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── MODIFY RENT ──
  app.patch(`${urlPrefix}/contracts/:id/rent`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const id = parseInt(req.params.id);
      const { newAmount, effectiveFrom } = z.object({
        newAmount: z.union([z.string(), z.number()]).transform(v => String(v)),
        effectiveFrom: z.enum(["current", "next"]).default("current"),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ error: "Contract not found" });

      await db.update(propertyContracts).set({ rentalAmount: newAmount }).where(eq(propertyContracts.id, id));

      const now = new Date();
      let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
      if (effectiveFrom === "next") { m++; if (m > 12) { m = 1; y++; } }

      await db.execute(sql`
        UPDATE property_monthly_ledger
        SET expected_amount = ${newAmount}
        WHERE contract_id = ${id} AND paid_amount = 0
          AND ((year > ${y}) OR (year = ${y} AND month >= ${m}))
      `);
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      res.status(500).json({ error: e.message });
    }
  });

  // ── END CONTRACT ──
  app.post(`${urlPrefix}/contracts/:id/end`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const id = parseInt(req.params.id);
      const { endDate, notes } = z.object({
        endDate: z.string().min(1),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ error: "Contract not found" });

      await db.update(propertyContracts).set({
        status: "ENDED", endDate: endDate as any,
        notes: notes ? `${contract.notes ? contract.notes + "\n" : ""}END: ${notes}` : contract.notes,
      }).where(eq(propertyContracts.id, id));

      const end = new Date(endDate);
      const ey = end.getUTCFullYear(), em = end.getUTCMonth() + 1;
      await db.execute(sql`
        DELETE FROM property_monthly_ledger
        WHERE contract_id = ${id} AND paid_amount = 0
          AND ((year > ${ey}) OR (year = ${ey} AND month > ${em}))
      `);
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      res.status(500).json({ error: e.message });
    }
  });

  // ── GUARANTEE TO STATEMENT ──
  app.post(`${urlPrefix}/contracts/:id/guarantee-to-statement`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const id = parseInt(req.params.id);
      const { amount, cashAccountId, paymentDate, notes } = z.object({
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        cashAccountId: z.number().nullable().optional(),
        paymentDate: z.string().optional(),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ error: "Contract not found" });

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const dateStr = paymentDate || new Date().toISOString().slice(0, 10);

      await db.transaction(async (tx) => {
        await tx.update(propertyContracts).set({
          guaranteePostedToStatement: true,
          guaranteePostedAmount: amount,
          notes: notes ? `${contract.notes ? contract.notes + "\n" : ""}GUARANTEE→STMT: ${amount} (${notes})` : contract.notes,
        }).where(eq(propertyContracts.id, id));

        if (cashAccountId) {
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
          const narration = `Guarantee deposit - ${unitLabel}`;
          const [v] = await tx.insert(vouchers).values({
            companyId, voucherNumber: `GUAR-${Date.now()}-${id}`,
            voucherType: "Receipt", voucherDate: dateStr as any,
            description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
          }).returning();
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: amount, creditAmount: "0", narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0", creditAmount: amount, narration },
          ]);
        }
      });
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      res.status(500).json({ error: e.message });
    }
  });

  // ── RECORD PAYMENT ──
  app.post(`${urlPrefix}/payments`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const data = z.object({
        contractId: z.number(),
        cashAccountId: z.number().nullable().optional(),
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        paymentDate: z.string().min(1),
        forMonth: z.enum(["current", "next"]).default("current"),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, data.contractId),
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ error: "Contract not found" });

      await ensureMonthlyLedgerRows(contract.id);

      const now = new Date();
      let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
      if (data.forMonth === "next") { m++; if (m > 12) { m = 1; y++; } }

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));

      const payment = await db.transaction(async (tx) => {
        await tx.insert(propertyMonthlyLedger).values({
          companyId, module, contractId: contract.id, unitId: contract.unitId,
          year: y, month: m, expectedAmount: contract.rentalAmount, paidAmount: "0",
        }).onConflictDoNothing({
          target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
        });

        const [row] = await tx.select().from(propertyMonthlyLedger).where(and(
          eq(propertyMonthlyLedger.contractId, contract.id),
          eq(propertyMonthlyLedger.year, y),
          eq(propertyMonthlyLedger.month, m),
        ));

        let voucherId: number | null = null;
        if (data.cashAccountId) {
          const incomeAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC");
          const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
          const narration = `Rent received - ${unitLabel} - ${String(m).padStart(2, "0")}/${y}`;
          const [v] = await tx.insert(vouchers).values({
            companyId, voucherNumber: `RENT-${Date.now()}-${contract.id}`,
            voucherType: "Receipt", voucherDate: data.paymentDate as any,
            description: narration, totalAmount: data.amount, currency: "USD", sourceModule: "ERP",
          }).returning();
          voucherId = v.id;
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: data.amount, creditAmount: "0", narration },
            { voucherId: v.id, ledgerAccountId: incomeAccountId, debitAmount: "0", creditAmount: data.amount, narration },
          ]);
        }

        const [created] = await tx.insert(propertyPayments).values({
          companyId, module, contractId: contract.id, unitId: contract.unitId,
          ledgerRowId: row.id, cashAccountId: data.cashAccountId ?? null, voucherId: voucherId ?? null,
          amount: data.amount, paymentDate: data.paymentDate as any,
          forYear: y, forMonth: m, notes: data.notes ?? null,
        }).returning();

        await tx.execute(sql`
          UPDATE property_monthly_ledger SET paid_amount = paid_amount + ${data.amount}::numeric WHERE id = ${row.id}
        `);
        return created;
      });

      res.json(payment);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      console.error(`${tag} payments:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── UNIT DETAIL (ledger view) ──
  app.get(`${urlPrefix}/units/:id/detail`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const unitId = parseInt(req.params.id);

      const [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, unitId), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module),
      ));
      if (!unit) return res.status(404).json({ error: "Unit not found" });

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, unitId),
        eq(propertyContracts.status, "ACTIVE"),
      ));

      let ledger: any[] = [], payments: any[] = [];
      if (contract) {
        await ensureMonthlyLedgerRows(contract.id);
        ledger = await db.select().from(propertyMonthlyLedger)
          .where(eq(propertyMonthlyLedger.contractId, contract.id))
          .orderBy(propertyMonthlyLedger.year, propertyMonthlyLedger.month);
        payments = await db.select().from(propertyPayments)
          .where(eq(propertyPayments.contractId, contract.id))
          .orderBy(desc(propertyPayments.paymentDate));
      }

      const pastContracts = await db.select().from(propertyContracts)
        .where(and(
          eq(propertyContracts.companyId, companyId),
          eq(propertyContracts.module, module),
          eq(propertyContracts.unitId, unitId),
          eq(propertyContracts.status, "ENDED"),
        ))
        .orderBy(desc(propertyContracts.endDate));

      res.json({ unit, contract: contract ?? null, ledger, payments, pastContracts });
    } catch (e: any) {
      console.error(`${tag} detail:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── CASH ACCOUNTS picker ──
  app.get(`${urlPrefix}/cash-accounts`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const accts = await db.select().from(ledgerAccounts).where(and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt),
      ));
      res.json(accts.filter(a => a.accountType === "Cash" || a.accountType === "Bank")
        .sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GLOBAL PAYMENTS LOG ──
  app.get(`${urlPrefix}/payments`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });

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
      res.status(500).json({ error: e.message });
    }
  });

  // ── MANUAL MONTHLY ROLLOVER ──
  app.post(`${urlPrefix}/run-monthly`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      await ensureMonthlyForCompany(companyId, module);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
