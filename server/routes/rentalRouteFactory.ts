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

    for (const cfg of configs) {
      // Filter: if specific source accounts are set, only fire for those
      const filterIds = (cfg.sourceCashAccountIds ?? []) as number[];
      if (filterIds.length > 0 && !filterIds.includes(fromLedgerAccountId)) continue;

      const [toCompany] = await db.select().from(companies).where(eq(companies.id, cfg.destCompanyId));
      if (!toCompany) continue;

      const toClearing = await getOrCreateClearing(cfg.destCompanyId);
      const baseDesc = `Auto rent transfer - ${unitLabel}`;
      const desc = notes ? `${baseDesc} - ${notes}` : baseDesc;
      const ts = Date.now();

      const outNarration = notes
        ? `Transfer out to ${toCompany.name} - ${notes}`
        : `Transfer out to ${toCompany.name}`;
      const inNarration = notes
        ? `Transfer in from ${fromCompany.name} - ${notes}`
        : `Transfer in from ${fromCompany.name}`;

      // Voucher in FROM company (Payment — money leaves)
      const [fromVoucher] = await db.insert(vouchers).values({
        companyId, voucherNumber: `TR-OUT-${ts}`,
        voucherType: "Payment", voucherDate: transferDate as any,
        description: `${desc} → ${toCompany.name}`, totalAmount: amount, optional: false,
      }).returning();
      await db.insert(voucherEntries).values([
        { voucherId: fromVoucher.id, ledgerAccountId: fromClearing.id, debitAmount: amount,  creditAmount: "0", narration: outNarration },
        { voucherId: fromVoucher.id, ledgerAccountId: fromLedgerAccountId, debitAmount: "0", creditAmount: amount, narration: outNarration },
      ]);

      // Voucher in TO company (Receipt — money arrives)
      const [toVoucher] = await db.insert(vouchers).values({
        companyId: cfg.destCompanyId, voucherNumber: `TR-IN-${ts + 1}`,
        voucherType: "Receipt", voucherDate: transferDate as any,
        description: notes ? `Transfer from ${fromCompany.name} - ${notes}` : `Transfer from ${fromCompany.name}`,
        totalAmount: amount, optional: false,
      }).returning();
      await db.insert(voucherEntries).values([
        { voucherId: toVoucher.id, ledgerAccountId: cfg.destLedgerAccountId, debitAmount: amount, creditAmount: "0", narration: inNarration },
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
      const { tenantName, startDate } = z.object({
        tenantName: z.string().min(1, "Tenant name required"),
        startDate: z.string().min(1, "Start date required"),
      }).parse(req.body);
      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      await db.update(propertyContracts).set({ tenantName, startDate: startDate as any }).where(eq(propertyContracts.id, id));
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

      // Fire auto-transfer if configured (same as regular payment — guarantee cash receipt triggers transfer)
      if (cashAccountId) {
        await maybeRunAutoTransfer(companyId, module, cashAccountId, amount, dateStr, unitLabel, undefined, notes);
      }

      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
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
      const dateStr = paymentDate || new Date().toISOString().slice(0, 10);

      let voucherId: number | null = null;
      await db.transaction(async (tx) => {
        const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
        const narration = notes
          ? `Guarantee moved to cash - ${unitLabel} - ${notes}`
          : `Guarantee moved to cash - ${unitLabel}`;
        const [v] = await tx.insert(vouchers).values({
          companyId, voucherNumber: `GUAR-CASH-${Date.now()}-${id}`,
          voucherType: "Journal", voucherDate: dateStr as any,
          description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
        }).returning();
        voucherId = v.id;
        // DR Tenant Deposits (clear liability) / CR Cash Account (money arrives in cash)
        await tx.insert(voucherEntries).values([
          { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: amount, creditAmount: "0", narration },
          { voucherId: v.id, ledgerAccountId: cashAccountId, debitAmount: "0", creditAmount: amount, narration },
        ]);
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
          const isShop = unit?.unitType === "SHOP";
          const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;

          if (isShop) {
            // SHOP rentals: company is paying rent OUT → Payment voucher (DR Expense / CR Cash)
            const expenseAccountId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Expense", "SHOP-RENT-EXP");
            const narration = `Rent paid - ${unitLabel} - ${String(m).padStart(2, "0")}/${y}`;
            const [v] = await tx.insert(vouchers).values({
              companyId, voucherNumber: `RENT-${Date.now()}-${contract.id}`,
              voucherType: "Payment", voucherDate: data.paymentDate as any,
              description: narration, totalAmount: data.amount, currency: "USD", sourceModule: "ERP",
            }).returning();
            voucherId = v.id;
            await tx.insert(voucherEntries).values([
              { voucherId: v.id, ledgerAccountId: expenseAccountId, debitAmount: data.amount, creditAmount: "0", narration },
              { voucherId: v.id, ledgerAccountId: data.cashAccountId, debitAmount: "0", creditAmount: data.amount, narration },
            ]);
          } else {
            // WAREHOUSE/other rentals: company is receiving rent IN → Receipt voucher (DR Cash / CR Income)
            const incomeAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC");
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

      // Fire auto-transfer if configured (outside transaction — best-effort)
      if (data.cashAccountId) {
        const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
        await maybeRunAutoTransfer(companyId, module, data.cashAccountId, data.amount, data.paymentDate, unitLabel, payment.id, data.notes);
      }

      res.json(payment);
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

        // 2. Soft-delete the linked payment voucher (entries stay for audit)
        if (payment.voucherId) {
          await tx.execute(sql`
            UPDATE vouchers SET deleted_at = NOW() WHERE id = ${payment.voucherId}
          `);
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
