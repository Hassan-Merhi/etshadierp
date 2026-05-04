import type { Express, Request, Response } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import { getClientDate } from "../lib/dateUtils";
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
  rentalAutoTransferConfigs,
  interCompanyTransfers,
  companies,
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
  accountType: "Income" | "Liability" | "Indirect Expense" | "Indirect Income",
  codePrefix: string,
  subType?: string,
): Promise<number> {
  const [existing] = await tx.select().from(ledgerAccounts).where(and(
    eq(ledgerAccounts.companyId, companyId),
    eq(ledgerAccounts.name, name),
    isNull(ledgerAccounts.deletedAt),
  ));
  if (existing) {
    // Patch account type/subType if it was previously created with wrong values
    const needsPatch =
      existing.accountType !== accountType ||
      (subType !== undefined && existing.subType !== subType);
    if (needsPatch) {
      await tx.update(ledgerAccounts)
        .set({ accountType, ...(subType !== undefined ? { subType } : {}) })
        .where(eq(ledgerAccounts.id, existing.id));
    }
    return existing.id;
  }
  const code = `${codePrefix}-${Date.now()}`;
  const [created] = await tx.insert(ledgerAccounts).values({
    companyId, code, name, accountType, subType: subType ?? null, active: true,
  }).returning();
  return created.id;
}

// ── Auto-transfer helper ──────────────────────────────────────────────────────
// Called after a payment is committed. Looks up the auto-transfer config for
// this company/module and, if enabled, posts two vouchers (one per company)
// using the same TRANSFER-CLEARING pattern as /api/simple-company-transfer.
async function maybeRunAutoTransfer(
  companyId: number,
  module: RentalModule,
  fromLedgerAccountId: number,
  amount: string,
  transferDate: string,
  unitLabel: string,
  sourcePaymentId?: number,
  notes?: string,
) {
  try {
    // Fetch ALL active rules for this company+module
    const configs = await db.select().from(rentalAutoTransferConfigs).where(and(
      eq(rentalAutoTransferConfigs.companyId, companyId),
      eq(rentalAutoTransferConfigs.module, module),
      eq(rentalAutoTransferConfigs.enabled, true),
    ));
    if (configs.length === 0) return;

    const [fromCompany] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!fromCompany) return;

    // Get or create TRANSFER-CLEARING account in a company
    async function getOrCreateClearing(cid: number) {
      const [existing] = await db.select().from(ledgerAccounts).where(and(
        eq(ledgerAccounts.companyId, cid),
        eq(ledgerAccounts.code, "TRANSFER-CLEARING"),
        isNull(ledgerAccounts.deletedAt),
      ));
      if (existing) return existing;
      const [created] = await db.insert(ledgerAccounts).values({
        companyId: cid, code: "TRANSFER-CLEARING", name: "Transfer Clearing",
        accountType: "Equity", active: true,
      }).returning();
      return created;
    }

    const fromClearing = await getOrCreateClearing(companyId);

    // Find the FIRST rule that matches the source account.
    // Rules with a specific sourceCashAccountIds list take precedence; fallback to the
    // first rule with an empty filter only when no specific rule matched.
    const specificMatch = configs.find(c => {
      const ids = (c.sourceCashAccountIds ?? []) as number[];
      return ids.length > 0 && ids.includes(fromLedgerAccountId);
    });
    const fallbackMatch = configs.find(c => {
      const ids = (c.sourceCashAccountIds ?? []) as number[];
      return ids.length === 0;
    });
    const cfg = specificMatch ?? fallbackMatch;
    if (!cfg) return;

    // Only one transfer per payment — use the matched rule.
    {
      const [toCompany] = await db.select().from(companies).where(eq(companies.id, cfg.destCompanyId));
      if (!toCompany) return;

      const toClearing = await getOrCreateClearing(cfg.destCompanyId);
      const baseDesc = `Auto rent transfer - ${unitLabel}`;
      const desc = notes ? `${baseDesc} - ${notes}` : baseDesc;
      const txId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const outNarration = notes
        ? `Transfer out to ${toCompany.name} - ${notes}`
        : `Transfer out to ${toCompany.name}`;
      const inNarration = notes
        ? `Transfer in from ${fromCompany.name} - ${notes}`
        : `Transfer in from ${fromCompany.name}`;

      // Voucher in FROM company (Payment — money leaves)
      const [fromVoucher] = await db.insert(vouchers).values({
        companyId, voucherNumber: `TR-OUT-${txId}`,
        voucherType: "Payment", voucherDate: transferDate as any,
        description: `${desc} → ${toCompany.name}`, totalAmount: amount, optional: false,
      }).returning();
      await db.insert(voucherEntries).values([
        { voucherId: fromVoucher.id, ledgerAccountId: fromClearing.id, debitAmount: amount,  creditAmount: "0", narration: outNarration },
        { voucherId: fromVoucher.id, ledgerAccountId: fromLedgerAccountId, debitAmount: "0", creditAmount: amount, narration: outNarration },
      ]);

      // Voucher in TO company (Receipt — money arrives)
      // DR destLedgerAccountId (cash/account receives money), CR toClearing (clearing settled)
      const [toVoucher] = await db.insert(vouchers).values({
        companyId: cfg.destCompanyId, voucherNumber: `TR-IN-${txId}`,
        voucherType: "Receipt", voucherDate: transferDate as any,
        description: notes ? `Transfer from ${fromCompany.name} - ${notes}` : `Transfer from ${fromCompany.name}`,
        totalAmount: amount, optional: false,
      }).returning();
      await db.insert(voucherEntries).values([
        { voucherId: toVoucher.id, ledgerAccountId: cfg.destLedgerAccountId, debitAmount: amount, creditAmount: "0",   narration: inNarration },
        { voucherId: toVoucher.id, ledgerAccountId: toClearing.id,           debitAmount: "0",   creditAmount: amount, narration: inNarration },
      ]);

      // Record link (sourcePaymentId links this transfer back to the originating payment)
      await db.insert(interCompanyTransfers).values({
        transferType: "Cash",
        fromCompanyId: companyId, toCompanyId: cfg.destCompanyId,
        transferDate: transferDate as any, amount,
        fromLedgerAccountId, toLedgerAccountId: cfg.destLedgerAccountId,
        fromVoucherId: fromVoucher.id, toVoucherId: toVoucher.id,
        description: desc,
        sourcePaymentId: sourcePaymentId ?? null,
      });
    }
  } catch (err) {
    console.error("[RentalAutoTransfer] failed:", err);
  }
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
  shopExpenseAccountName: string = "Rent Expense - Shops",
) {
  const tag = `[${module}/rental]`;

  // ── UNITS list ──
  app.get(`${urlPrefix}/units`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const unitType = (req.query.unitType as string) || "WAREHOUSE";

      await ensureMonthlyForCompany(companyId, module);

      const regularUnits = await db.select().from(propertyUnits)
        .where(and(
          eq(propertyUnits.companyId, companyId),
          eq(propertyUnits.module, module),
          eq(propertyUnits.unitType, unitType),
          eq(propertyUnits.active, true),
        ))
        .orderBy(propertyUnits.locationGroup, propertyUnits.sortOrder, propertyUnits.unitNumber);

      // When viewing SHOP type, also pull in any WAREHOUSE units that are marked as
      // "internal lease" (the company occupies its own warehouse) so they appear in both views.
      let internalWarehouseUnits: typeof regularUnits = [];
      if (unitType === "SHOP") {
        const allWarehouseUnits = await db.select().from(propertyUnits)
          .where(and(
            eq(propertyUnits.companyId, companyId),
            eq(propertyUnits.module, module),
            eq(propertyUnits.unitType, "WAREHOUSE"),
            eq(propertyUnits.active, true),
          ));
        if (allWarehouseUnits.length) {
          const internalContracts = await db.select().from(propertyContracts).where(and(
            eq(propertyContracts.companyId, companyId),
            eq(propertyContracts.module, module),
            inArray(propertyContracts.unitId, allWarehouseUnits.map(u => u.id)),
            eq(propertyContracts.status, "ACTIVE"),
            eq(propertyContracts.isInternal, true),
          ));
          const internalUnitIds = new Set(internalContracts.map(c => c.unitId));
          internalWarehouseUnits = allWarehouseUnits.filter(u => internalUnitIds.has(u.id));
        }
      }

      const units = [...regularUnits, ...internalWarehouseUnits];
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
      const totalPaidByContract = new Map<number, number>();
      if (contractIds.length > 0) {
        // Only count expectedAmount for months up to the current calendar month.
        // All paidAmount is counted regardless of month so advance payments create
        // a negative outstanding (credit) instead of silently zeroing out.
        const rows = await db.select({
          contractId: propertyMonthlyLedger.contractId,
          expected: sql<string>`COALESCE(SUM(
            CASE WHEN (
              ${propertyMonthlyLedger.year} < EXTRACT(YEAR FROM NOW())
              OR (
                ${propertyMonthlyLedger.year} = EXTRACT(YEAR FROM NOW())
                AND ${propertyMonthlyLedger.month} <= EXTRACT(MONTH FROM NOW())
              )
            ) THEN ${propertyMonthlyLedger.expectedAmount} ELSE 0 END
          ), 0)`,
          paid: sql<string>`COALESCE(SUM(${propertyMonthlyLedger.paidAmount}), 0)`,
        }).from(propertyMonthlyLedger)
          .where(inArray(propertyMonthlyLedger.contractId, contractIds))
          .groupBy(propertyMonthlyLedger.contractId);
        rows.forEach(r => {
          outstandingByContract.set(r.contractId, Number(r.expected) - Number(r.paid));
          totalPaidByContract.set(r.contractId, Number(r.paid));
        });
      }

      res.json(units.map(u => {
        const c = contractByUnit.get(u.id);
        return {
          ...u,
          contract: c ?? null,
          outstanding: c ? (outstandingByContract.get(c.id) ?? 0) : null,
          totalPaid: c ? (totalPaidByContract.get(c.id) ?? 0) : null,
        };
      }));
    } catch (e: any) {
      console.error(`${tag} units:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── CREATE unit ──
  app.post(`${urlPrefix}/units`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = insertPropertyUnitSchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(propertyUnits).values({ ...data, module } as any).returning();
      res.json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH unit ──
  app.patch(`${urlPrefix}/units/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const allowed = ["unitNumber", "size", "dimensions", "locationGroup", "notes", "sortOrder", "active"];
      const updates: any = {};
      for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
      const [updated] = await db.update(propertyUnits).set(updates)
        .where(and(eq(propertyUnits.id, id), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module)))
        .returning();
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE unit ──
  app.delete(`${urlPrefix}/units/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const [active] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, id),
        eq(propertyContracts.status, "ACTIVE"),
      ));
      if (active) return res.status(400).json({ message: "Cannot delete: unit has active contract. End contract first." });
      await db.update(propertyUnits).set({ active: false })
        .where(and(eq(propertyUnits.id, id), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── START CONTRACT ──
  app.post(`${urlPrefix}/contracts`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = insertPropertyContractSchema.parse({ ...req.body, companyId });

      const [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, data.unitId),
        eq(propertyUnits.companyId, companyId),
        eq(propertyUnits.module, module),
      ));
      if (!unit) return res.status(404).json({ message: "Unit not found" });

      const [existing] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, data.unitId),
        eq(propertyContracts.status, "ACTIVE"),
      ));
      if (existing) return res.status(400).json({ message: "Unit already has an active contract" });

      const [created] = await db.insert(propertyContracts).values({ ...data, module } as any).returning();
      await ensureMonthlyLedgerRows(created.id);
      res.json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      console.error(`${tag} contracts:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── MODIFY RENT ──
  app.patch(`${urlPrefix}/contracts/:id/rent`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const { newAmount, effectiveFrom } = z.object({
        newAmount: z.union([z.string(), z.number()]).transform(v => String(v)),
        effectiveFrom: z.enum(["current", "next"]).default("current"),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

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
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── EDIT CONTRACT INFO (tenant name + start date) ──
  app.patch(`${urlPrefix}/contracts/:id/info`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const { tenantName, startDate, guaranteeAmount, guaranteePeriod, isInternal } = z.object({
        tenantName: z.string().min(1, "Tenant name required"),
        startDate: z.string().min(1, "Start date required"),
        guaranteeAmount: z.string().optional(),
        guaranteePeriod: z.string().optional(),
        isInternal: z.boolean().optional(),
      }).parse(req.body);
      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      const contractUpdates: any = { tenantName, startDate: startDate as any };
      if (guaranteeAmount !== undefined) contractUpdates.guaranteeAmount = guaranteeAmount;
      if (guaranteePeriod !== undefined) contractUpdates.guaranteePeriod = guaranteePeriod;
      if (isInternal !== undefined) contractUpdates.isInternal = isInternal;
      await db.update(propertyContracts).set(contractUpdates).where(eq(propertyContracts.id, id));

      // Clean up ledger rows that are now before the new start date
      const newStart = new Date(startDate);
      const newStartYear = newStart.getUTCFullYear();
      const newStartMonth = newStart.getUTCMonth() + 1;

      // Delete rows before the new start date that have no payments (zero or null paidAmount)
      await db.execute(sql`
        DELETE FROM property_monthly_ledger
        WHERE contract_id = ${id}
          AND (year < ${newStartYear} OR (year = ${newStartYear} AND month < ${newStartMonth}))
          AND (paid_amount IS NULL OR paid_amount::numeric = 0)
      `);

      // Zero out expected amount for rows before the new start date that DO have payments
      // (they become pure credit entries rather than appearing as unpaid obligations)
      await db.execute(sql`
        UPDATE property_monthly_ledger
        SET expected_amount = 0
        WHERE contract_id = ${id}
          AND (year < ${newStartYear} OR (year = ${newStartYear} AND month < ${newStartMonth}))
          AND paid_amount::numeric > 0
      `);

      // Restore expected_amount for any paid months AT or AFTER the new start date
      // that were accidentally zeroed by a previous start-date change.
      // We set expected_amount = paid_amount so the month shows outstanding = $0
      // (the tenant paid what they owed; the zeroed expected was a data inconsistency).
      await db.execute(sql`
        UPDATE property_monthly_ledger
        SET expected_amount = paid_amount
        WHERE contract_id = ${id}
          AND (year > ${newStartYear} OR (year = ${newStartYear} AND month >= ${newStartMonth}))
          AND expected_amount::numeric = 0
          AND paid_amount::numeric > 0
      `);

      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── STATEMENT EXCEL EXPORT ──
  app.get(`${urlPrefix}/units/:id/statement/export`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const unitId = parseInt(req.params.id);

      const [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, unitId), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module),
      ));
      if (!unit) return res.status(404).json({ message: "Unit not found" });

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
        eq(propertyContracts.unitId, unitId),
        eq(propertyContracts.status, "ACTIVE"),
      ));
      if (!contract) return res.status(404).json({ message: "No active contract" });

      await ensureMonthlyLedgerRows(contract.id);
      const ledger = await db.select().from(propertyMonthlyLedger)
        .where(eq(propertyMonthlyLedger.contractId, contract.id))
        .orderBy(propertyMonthlyLedger.year, propertyMonthlyLedger.month);
      const payments = await db.select().from(propertyPayments)
        .where(eq(propertyPayments.contractId, contract.id))
        .orderBy(desc(propertyPayments.paymentDate));

      const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const fmtNum = (v: any) => Number(v || 0);

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Rental Management";
      wb.created = new Date();

      const ws = wb.addWorksheet("Statement");
      ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } };

      const titleFont = { bold: true, size: 14 };
      const headerFont = { bold: true, size: 10 };
      const bodyFont = { size: 10 };
      const grayFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
      const blueFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A56DB" } };
      const totalFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

      ws.columns = [
        { key: "month", width: 16 },
        { key: "expected", width: 16 },
        { key: "paid", width: 16 },
        { key: "outstanding", width: 16 },
        { key: "notes", width: 28 },
      ];

      // Title row
      const titleRow = ws.addRow(["RENTAL STATEMENT", "", "", "", ""]);
      ws.mergeCells(`A${titleRow.number}:E${titleRow.number}`);
      titleRow.getCell(1).font = { ...titleFont, color: { argb: "FFFFFFFF" } };
      titleRow.getCell(1).fill = blueFill;
      titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      titleRow.height = 28;

      // Info rows
      const addInfo = (label: string, value: string) => {
        const r = ws.addRow([label, value, "", "", ""]);
        ws.mergeCells(`B${r.number}:E${r.number}`);
        r.getCell(1).font = { bold: true, size: 10 };
        r.getCell(2).font = bodyFont;
        r.getCell(1).fill = grayFill;
        r.height = 16;
      };
      addInfo("Unit", `${unit.locationGroup} / ${unit.unitNumber}`);
      addInfo("Tenant", contract.tenantName);
      addInfo("Start Date", contract.startDate ? new Date(contract.startDate as any).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
      addInfo("Monthly Rent", `$${fmtNum(contract.rentalAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      if (contract.guaranteeAmount && Number(contract.guaranteeAmount) > 0) {
        addInfo("Guarantee", `$${fmtNum(contract.guaranteeAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      }
      ws.addRow([]);

      // Table header
      const hdr = ws.addRow(["Month", "Expected ($)", "Paid ($)", "Outstanding ($)", "Notes"]);
      hdr.eachCell(c => {
        c.font = { ...headerFont, color: { argb: "FFFFFFFF" } };
        c.fill = blueFill;
        c.alignment = { horizontal: "center" };
        c.border = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
      });
      hdr.height = 18;

      // Data rows — only count expected for months up to today so advance payments show as credit
      const nowDate = new Date();
      const nowYear = nowDate.getUTCFullYear();
      const nowMonth = nowDate.getUTCMonth() + 1;
      let totalExpected = 0, totalPaid = 0;
      for (const row of ledger) {
        const isFutureRow = row.year > nowYear || (row.year === nowYear && row.month > nowMonth);
        const exp = isFutureRow ? 0 : fmtNum(row.expectedAmount);
        const paid = fmtNum(row.paidAmount);
        const out = exp - paid;
        totalExpected += exp; totalPaid += paid;
        const monthLabel = isFutureRow ? `${monthNames[row.month]} ${row.year} (prepaid)` : `${monthNames[row.month]} ${row.year}`;
        const r = ws.addRow([monthLabel, isFutureRow ? "" : exp, paid, out, row.notes || ""]);
        r.getCell(1).font = bodyFont;
        r.getCell(2).font = bodyFont; r.getCell(2).numFmt = "#,##0.00"; r.getCell(2).alignment = { horizontal: "right" };
        r.getCell(3).font = bodyFont; r.getCell(3).numFmt = "#,##0.00"; r.getCell(3).alignment = { horizontal: "right" };
        r.getCell(4).numFmt = "#,##0.00"; r.getCell(4).alignment = { horizontal: "right" };
        r.getCell(4).font = { ...bodyFont, color: { argb: out > 0 ? "FFCC0000" : out < 0 ? "FF006600" : "FF666666" } };
        r.getCell(5).font = { ...bodyFont, color: { argb: "FF666666" } };
        r.height = 15;
      }

      // Totals row
      const balance = totalExpected - totalPaid;
      const tot = ws.addRow(["TOTALS", totalExpected, totalPaid, balance, ""]);
      tot.eachCell((c, i) => {
        c.font = { bold: true, size: 10 };
        c.fill = totalFill;
        if (i >= 2 && i <= 4) { c.numFmt = "#,##0.00"; c.alignment = { horizontal: "right" }; }
        if (i === 4) c.font = { bold: true, size: 10, color: { argb: balance > 0 ? "FFCC0000" : balance < 0 ? "FF006600" : "FF000000" } };
      });
      tot.height = 18;

      if (contract.statementNote) {
        ws.addRow([]);
        const nr = ws.addRow(["NOTE:", contract.statementNote, "", "", ""]);
        ws.mergeCells(`B${nr.number}:E${nr.number}`);
        nr.getCell(1).font = { bold: true, size: 10 };
        nr.getCell(2).font = { italic: true, size: 10 };
        nr.getCell(2).alignment = { wrapText: true, vertical: "top" };
        nr.height = Math.max(18, Math.ceil(contract.statementNote.length / 60) * 15);
      }

      if (payments.length > 0) {
        ws.addRow([]);
        const ph = ws.addRow(["PAYMENT HISTORY", "", "", "", ""]);
        ws.mergeCells(`A${ph.number}:E${ph.number}`);
        ph.getCell(1).font = { bold: true, size: 10 };
        ph.getCell(1).fill = grayFill;
        ph.height = 16;

        const ph2 = ws.addRow(["Date", "For", "Amount ($)", "Notes", ""]);
        ph2.eachCell(c => { c.font = headerFont; c.fill = grayFill; });
        ph2.height = 15;

        for (const p of payments) {
          const r = ws.addRow([
            new Date(p.paymentDate as any).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
            `${monthNames[p.forMonth]} ${p.forYear}`,
            Number(p.amount || 0),
            p.notes || "",
            "",
          ]);
          r.getCell(3).numFmt = "#,##0.00"; r.getCell(3).alignment = { horizontal: "right" };
          r.height = 15;
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      const filename = `Rental_${unit.unitNumber.replace(/\s+/g, "_")}_${contract.tenantName.replace(/\s+/g, "_")}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (e: any) {
      console.error(`${tag} statement export:`, e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── UPDATE CONTRACT NOTE ──
  app.patch(`${urlPrefix}/contracts/:id/note`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const { notes } = z.object({ notes: z.string() }).parse(req.body);
      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      await db.update(propertyContracts).set({ notes: notes || null }).where(eq(propertyContracts.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── SAVE STATEMENT NOTE ──
  app.patch(`${urlPrefix}/contracts/:id/statement-note`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const { statementNote } = z.object({ statementNote: z.string() }).parse(req.body);
      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      await db.update(propertyContracts).set({ statementNote: statementNote || null }).where(eq(propertyContracts.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── END CONTRACT ──
  app.post(`${urlPrefix}/contracts/:id/end`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const { endDate, notes } = z.object({
        endDate: z.string().min(1),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

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
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── GUARANTEE TO STATEMENT ──
  app.post(`${urlPrefix}/contracts/:id/guarantee-to-statement`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
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
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const dateStr = paymentDate || getClientDate(req);

      await db.transaction(async (tx) => {
        await tx.update(propertyContracts).set({
          guaranteePostedToStatement: true,
          guaranteePostedAmount: amount,
          notes: notes ? `${contract.notes ? contract.notes + "\n" : ""}GUARANTEE→STMT: ${amount} (${notes})` : contract.notes,
        }).where(eq(propertyContracts.id, id));

        if (cashAccountId) {
          const tenantPays = module === "ERP" || module === "FACTORY";
          if (tenantPays) {
            // Tenant perspective: company PAYS the guarantee out — Dr Security Deposits Paid (Asset) / Cr Cash
            const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
            const narration = `Guarantee paid - ${unitLabel}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `GUAR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
              voucherType: "Payment", voucherDate: dateStr as any,
              description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
            }).returning();
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: "0", creditAmount: amount, narration },
            ]);
          } else {
            // Landlord perspective: company RECEIVES the guarantee — Dr Cash / Cr Tenant Deposits (Liability)
            const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
            const narration = `Guarantee deposit - ${unitLabel}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `GUAR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
              voucherType: "Receipt", voucherDate: dateStr as any,
              description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
            }).returning();
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0", creditAmount: amount, narration },
            ]);
          }
        }
      });

      // Fire auto-transfer if configured (only for landlord receiving cash)
      if (cashAccountId && !(module === "ERP" || module === "FACTORY")) {
        await maybeRunAutoTransfer(companyId, module, cashAccountId, amount, dateStr, unitLabel, undefined, notes);
      }

      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── RESET GUARANTEE STATUS (undo "post to statement") ──
  app.delete(`${urlPrefix}/contracts/:id/guarantee-to-statement`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      await db.update(propertyContracts)
        .set({ guaranteePostedToStatement: false })
        .where(eq(propertyContracts.id, id));

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GUARANTEE TO CASH (release / apply guarantee deposit) ──
  app.post(`${urlPrefix}/contracts/:id/guarantee-to-cash`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const { amount, cashAccountId, paymentDate, notes } = z.object({
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        cashAccountId: z.number(),
        paymentDate: z.string().optional(),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const dateStr = paymentDate || getClientDate(req);

      const tenantPays = module === "ERP" || module === "FACTORY";
      let voucherId: number | null = null;
      await db.transaction(async (tx) => {
        const narration = notes
          ? `Guarantee moved to cash - ${unitLabel} - ${notes}`
          : `Guarantee moved to cash - ${unitLabel}`;
        const [v] = await tx.insert(vouchers).values({
          companyId, voucherNumber: `GUAR-CASH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
          voucherType: "Journal", voucherDate: dateStr as any,
          description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
        }).returning();
        voucherId = v.id;
        if (tenantPays) {
          // Tenant perspective: company RECOVERS the guarantee back as cash — Dr Cash / Cr Security Deposits Paid (Asset)
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: cashAccountId,   debitAmount: amount, creditAmount: "0",   narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0",   creditAmount: amount, narration },
          ]);
        } else {
          // Landlord perspective: releases deposit to tenant — Dr Tenant Deposits (Liability) / Cr Cash
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: amount, creditAmount: "0",   narration },
            { voucherId: v.id, ledgerAccountId: cashAccountId,   debitAmount: "0",   creditAmount: amount, narration },
          ]);
        }
        // Mark guarantee as paid on the contract
        await tx.update(propertyContracts)
          .set({ guaranteePostedToStatement: true, guaranteePostedAmount: amount })
          .where(eq(propertyContracts.id, id));
      });

      // Record in payments log so it's visible in cash flow / payments history
      const pd = new Date(dateStr);
      const [savedPayment] = await db.insert(propertyPayments).values({
        companyId, module, contractId: contract.id, unitId: contract.unitId,
        ledgerRowId: null, cashAccountId, voucherId,
        amount, paymentDate: dateStr as any,
        forYear: pd.getUTCFullYear(), forMonth: pd.getUTCMonth() + 1,
        notes: notes ? `[Guarantee release] ${notes}` : `[Guarantee release] ${unitLabel}`,
      }).returning();

      // Fire auto-transfer if configured — pass the payment ID so deletion can reverse both sides
      await maybeRunAutoTransfer(companyId, module, cashAccountId, amount, dateStr, unitLabel, savedPayment?.id, notes);

      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── RECORD PAYMENT ──
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
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, data.contractId),
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      await ensureMonthlyLedgerRows(contract.id);

      // Derive year/month from the payment date itself
      const pd = new Date(data.paymentDate);
      let y = pd.getUTCFullYear(), m = pd.getUTCMonth() + 1;

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));

      // ── Build monthly allocations ──────────────────────────────────────────
      // If the payment exceeds one month's rent, split it across consecutive months
      // starting from the payment date's month. Each chunk = min(remaining, rentalAmount).
      const totalAmountNum = parseFloat(data.amount);
      const rentalAmountNum = parseFloat(contract.rentalAmount as string);
      const allocations: Array<{ year: number; month: number; chunk: string }> = [];
      {
        let remaining = totalAmountNum;
        let ay = y, am = m;
        while (remaining > 0.005) {
          const chunk = rentalAmountNum > 0 ? Math.min(remaining, rentalAmountNum) : remaining;
          allocations.push({ year: ay, month: am, chunk: chunk.toFixed(2) });
          remaining = Math.round((remaining - chunk) * 100) / 100;
          am++; if (am > 12) { am = 1; ay++; }
          if (allocations.length >= 120) break; // safety cap ~10 years
        }
      }

      const payments = await db.transaction(async (tx) => {
        // Ensure a ledger row exists for every allocated month
        for (const alloc of allocations) {
          await tx.insert(propertyMonthlyLedger).values({
            companyId, module, contractId: contract.id, unitId: contract.unitId,
            year: alloc.year, month: alloc.month,
            expectedAmount: contract.rentalAmount, paidAmount: "0",
          }).onConflictDoNothing({
            target: [propertyMonthlyLedger.contractId, propertyMonthlyLedger.year, propertyMonthlyLedger.month],
          });
        }

        // Create ONE voucher for the full payment total
        let voucherId: number | null = null;
        if (data.cashAccountId) {
          const isShop = unit?.unitType === "SHOP";
          const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
          const monthSpan = allocations.length > 1
            ? `${String(allocations[0].month).padStart(2,"0")}/${allocations[0].year} – ${String(allocations[allocations.length-1].month).padStart(2,"0")}/${allocations[allocations.length-1].year}`
            : `${String(m).padStart(2,"0")}/${y}`;

          if (isShop) {
            const expenseAccountId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
            const narration = `Rent paid - ${unitLabel} - ${monthSpan}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
              voucherType: "Payment", voucherDate: data.paymentDate as any,
              description: narration, totalAmount: data.amount, currency: "USD", sourceModule: "ERP",
            }).returning();
            voucherId = v.id;
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: expenseAccountId, debitAmount: data.amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: "0", creditAmount: data.amount, narration },
            ]);
          } else {
            const incomeAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income");
            const narration = `Rent received - ${unitLabel} - ${monthSpan}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${contract.id}`,
              voucherType: "Receipt", voucherDate: data.paymentDate as any,
              description: narration, totalAmount: data.amount, currency: "USD", sourceModule: "ERP",
            }).returning();
            voucherId = v.id;
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: data.amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: incomeAccountId, debitAmount: "0", creditAmount: data.amount, narration },
            ]);
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

          const [p] = await tx.insert(propertyPayments).values({
            companyId, module, contractId: contract.id, unitId: contract.unitId,
            ledgerRowId: row.id,
            cashAccountId: data.cashAccountId ?? null,
            // All split rows share the same voucherId (one financial transaction)
            voucherId: voucherId ?? null,
            amount: alloc.chunk,
            paymentDate: data.paymentDate as any,
            forYear: alloc.year, forMonth: alloc.month,
            notes: allocations.length > 1
              ? `${data.notes ? data.notes + " | " : ""}Split from $${totalAmountNum.toFixed(2)} payment`
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

  // ── DELETE PAYMENT (full reversal) ──
  app.delete(`${urlPrefix}/payments/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const paymentId = parseInt(req.params.id);
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
          if (transfer.fromVoucherId) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, transfer.fromVoucherId));
            await tx.delete(vouchers).where(eq(vouchers.id, transfer.fromVoucherId));
          }
          if (transfer.toVoucherId) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, transfer.toVoucherId));
            await tx.delete(vouchers).where(eq(vouchers.id, transfer.toVoucherId));
          }
          await tx.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, transfer.id));
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
      const unitId = parseInt(req.params.id);

      const [unit] = await db.select().from(propertyUnits).where(and(
        eq(propertyUnits.id, unitId), eq(propertyUnits.companyId, companyId), eq(propertyUnits.module, module),
      ));
      if (!unit) return res.status(404).json({ message: "Unit not found" });

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

  // ── AUTO-TRANSFER CONFIG ───────────────────────────────────────────────────

  // GET — return current config for this company+module (or null), enriched with names
  app.get(`${urlPrefix}/auto-transfer-config`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      // Return all configs for this company+module, enriched with names
      const allCfgs = await db.select().from(rentalAutoTransferConfigs).where(and(
        eq(rentalAutoTransferConfigs.companyId, companyId),
        eq(rentalAutoTransferConfigs.module, module),
      ));

      const enriched = await Promise.all(allCfgs.map(async cfg => {
        const [destCompany] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, cfg.destCompanyId));
        const [destAccount] = await db.select({ name: ledgerAccounts.name }).from(ledgerAccounts).where(eq(ledgerAccounts.id, cfg.destLedgerAccountId));
        const sourceIds = (cfg.sourceCashAccountIds ?? []) as number[];
        let sourceAccountNames: { id: number; name: string }[] = [];
        if (sourceIds.length > 0) {
          sourceAccountNames = await db
            .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(inArray(ledgerAccounts.id, sourceIds));
        }
        return { ...cfg, destCompanyName: destCompany?.name ?? null, destAccountName: destAccount?.name ?? null, sourceAccountNames };
      }));

      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST — upsert config (insert or update on conflict)
  app.post(`${urlPrefix}/auto-transfer-config`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = z.object({
        destCompanyId: z.number().min(1),
        destLedgerAccountId: z.number().min(1),
        sourceCashAccountIds: z.array(z.number()).default([]),
        enabled: z.boolean().default(true),
      }).parse(req.body);

      // Always insert a new rule (multiple rules per company+module are supported)
      const [created] = await db.insert(rentalAutoTransferConfigs).values({
        companyId, module, ...data,
      }).returning();
      res.status(201).json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE — remove a specific auto-transfer rule by ID
  app.delete(`${urlPrefix}/auto-transfer-config/:id`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await db.delete(rentalAutoTransferConfigs).where(and(
        eq(rentalAutoTransferConfigs.id, id),
        eq(rentalAutoTransferConfigs.companyId, companyId),
      ));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
