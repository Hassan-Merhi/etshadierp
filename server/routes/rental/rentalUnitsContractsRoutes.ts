import type { Express } from "express";
import { getCompanyId, findOrCreateLedgerAccount, maybeRunAutoTransfer, ensureMonthlyLedgerRows, findEarliestOutstandingMonth, type RentalModule } from "./_rentalShared";
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

export function registerRentalUnitsContractsRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
  shopExpenseAccountName: string = "Rent Expense - Shops",
) {
  const tag = `[${module}/rental]`;

  app.get(`${urlPrefix}/units`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const unitType = (req.query.unitType as string) || "WAREHOUSE";

      await ensureMonthlyForCompany(companyId, module);

      // For ERP/FACTORY SHOP view: silently post any pending rent accruals on page load.
      // All due rows are combined into ONE journal voucher per run.
      // Fire-and-forget (errors are logged but do not block the response).
      if ((module === "ERP" || module === "FACTORY") && unitType === "SHOP") {
        postRentAccrualForCompany(companyId, shopExpenseAccountName, module, incomeAccountName).catch(e =>
          console.warn(`${tag} page-load accrual failed:`, e.message?.split("\n")[0]));
      }

      const regularUnits = await db.select().from(propertyUnits)
        .where(and(
          eq(propertyUnits.companyId, companyId),
          eq(propertyUnits.module, module),
          eq(propertyUnits.unitType, unitType),
          eq(propertyUnits.active, true),
        ))
        .orderBy(
          propertyUnits.locationGroup,
          propertyUnits.sortOrder,
          sql`NULLIF(regexp_replace(${propertyUnits.unitNumber}, '[^0-9]', '', 'g'), '')::bigint nulls last`,
          propertyUnits.unitNumber,
        );

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
      const guaranteeAppliedByContract = new Map<number, number>();
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

        // Sum payments tagged [Guarantee applied] to compute remaining guarantee
        const appliedRows = await db.select({
          contractId: propertyPayments.contractId,
          total: sql<string>`COALESCE(SUM(${propertyPayments.amount}), 0)`,
        }).from(propertyPayments)
          .where(and(
            inArray(propertyPayments.contractId, contractIds),
            sql`${propertyPayments.notes} LIKE '%[Guarantee applied]%'`,
          ))
          .groupBy(propertyPayments.contractId);
        appliedRows.forEach(r => guaranteeAppliedByContract.set(r.contractId, Number(r.total)));
      }

      const ownedResults = units.map(u => {
        const c = contractByUnit.get(u.id);
        const appliedAsRent = c ? (guaranteeAppliedByContract.get(c.id) ?? 0) : 0;
        const guaranteeRemaining = c
          ? Math.max(0, parseFloat(String(c.guaranteeAmount || "0")) - appliedAsRent)
          : null;
        return {
          ...u,
          contract: c ?? null,
          outstanding: c ? (outstandingByContract.get(c.id) ?? 0) : null,
          totalPaid: c ? (totalPaidByContract.get(c.id) ?? 0) : null,
          guaranteeRemaining,
          isShared: false,
          ownerCompanyName: null as string | null,
        };
      });

      // ── Shared contracts: contracts from OTHER companies that link to this company ──
      // Wrapped in its own try/catch — if the column hasn't been migrated yet this
      // gracefully returns [] so owned units always load.
      let sharedResults: typeof ownedResults = [];
      try {
        // Shared contracts (rented FROM another company) always appear in the Shops view only.
        // The owner may classify the unit differently in their system, so we ignore unitType
        // and pin shared units to the SHOP view to avoid them leaking into Warehouses.
        if (unitType === "SHOP") {
        const sharedContracts = await db.select().from(propertyContracts).where(and(
          eq(propertyContracts.linkedCompanyId, companyId),
          eq(propertyContracts.status, "ACTIVE"),
        ));

        if (sharedContracts.length > 0) {
          const sharedUnitIds = sharedContracts.map(c => c.unitId);
          // No unitType filter — show all shared contracts in the Shops view regardless of
          // how the owner classified the unit in their own system.
          const sharedUnits = await db.select().from(propertyUnits)
            .where(inArray(propertyUnits.id, sharedUnitIds));
          const sharedUnitMap = new Map(sharedUnits.map(u => [u.id, u]));

          const sharedContractIds = sharedContracts.map(c => c.id);
          const sharedLedgerRows = await db.select({
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
            .where(inArray(propertyMonthlyLedger.contractId, sharedContractIds))
            .groupBy(propertyMonthlyLedger.contractId);
          const sharedOutstanding = new Map<number, number>();
          const sharedPaid = new Map<number, number>();
          sharedLedgerRows.forEach(r => {
            sharedOutstanding.set(r.contractId, Number(r.expected) - Number(r.paid));
            sharedPaid.set(r.contractId, Number(r.paid));
          });

          // Fetch owner company names
          const ownerCompanyIds = [...new Set(sharedContracts.map(c => c.companyId))];
          const ownerCompanies = await db.select({ id: companies.id, name: companies.name })
            .from(companies)
            .where(inArray(companies.id, ownerCompanyIds));
          const ownerNameMap = new Map(ownerCompanies.map(c => [c.id, c.name]));

          // Sum [Guarantee applied] payments for shared contracts
          const sharedGuaranteeApplied = new Map<number, number>();
          const sharedAppliedRows = await db.select({
            contractId: propertyPayments.contractId,
            total: sql<string>`COALESCE(SUM(${propertyPayments.amount}), 0)`,
          }).from(propertyPayments)
            .where(and(
              inArray(propertyPayments.contractId, sharedContractIds),
              sql`${propertyPayments.notes} LIKE '%[Guarantee applied]%'`,
            ))
            .groupBy(propertyPayments.contractId);
          sharedAppliedRows.forEach(r => sharedGuaranteeApplied.set(r.contractId, Number(r.total)));

          sharedResults = sharedContracts.map(c => {
            const u = sharedUnitMap.get(c.unitId);
            if (!u) return null;
            const appliedAsRent = sharedGuaranteeApplied.get(c.id) ?? 0;
            const guaranteeRemaining = Math.max(0, parseFloat(String(c.guaranteeAmount || "0")) - appliedAsRent);
            return {
              ...u,
              contract: c,
              outstanding: sharedOutstanding.get(c.id) ?? 0,
              totalPaid: sharedPaid.get(c.id) ?? 0,
              guaranteeRemaining,
              isShared: true,
              ownerCompanyName: ownerNameMap.get(c.companyId) ?? null,
            };
          }).filter(Boolean) as typeof ownedResults;
        }
        } // end if (unitType === "SHOP")
      } catch (sharedErr: any) {
        // Column may not exist yet in production — owned units still load fine
        console.warn(`${tag} shared-units skipped:`, sharedErr.message?.split("\n")[0]);
      }

      res.json([...ownedResults, ...sharedResults]);
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
      await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "create", tableName: "property_units", recordId: created.id, recordIdentifier: created.unitNumber || String(created.id), changes: { unitNumber: { old: null, new: created.unitNumber } } });
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
      await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "create", tableName: "property_contracts", recordId: created.id, recordIdentifier: `Contract#${created.id} Unit#${created.unitId}`, changes: { unitId: { old: null, new: created.unitId }, rentalAmount: { old: null, new: created.rentalAmount }, startDate: { old: null, new: created.startDate } } });
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { tenantName, startDate, guaranteeAmount, guaranteePeriod, isInternal, linkedCompanyId } = z.object({
        tenantName: z.string().min(1, "Tenant name required"),
        startDate: z.string().min(1, "Start date required"),
        guaranteeAmount: z.string().optional(),
        guaranteePeriod: z.string().optional(),
        isInternal: z.boolean().optional(),
        linkedCompanyId: z.number().nullable().optional(),
      }).parse(req.body);
      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      const contractUpdates: any = { tenantName, startDate: startDate as any };
      if (guaranteeAmount !== undefined) contractUpdates.guaranteeAmount = guaranteeAmount;
      if (guaranteePeriod !== undefined) contractUpdates.guaranteePeriod = guaranteePeriod;
      if (isInternal !== undefined) contractUpdates.isInternal = isInternal;
      if (linkedCompanyId !== undefined) contractUpdates.linkedCompanyId = linkedCompanyId;
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
      const unitId = parseId(req.params.id);
      if (unitId === null) return res.status(400).json({ message: "Invalid id" });

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
      const allPaymentsExport = await db.select().from(propertyPayments)
        .where(eq(propertyPayments.contractId, contract.id))
        .orderBy(desc(propertyPayments.paymentDate));
      const payments = allPaymentsExport.filter(
        p => p.ledgerRowId !== null && !(p.notes ?? "").includes("[Guarantee release]"),
      );
      const guaranteePaymentsExport = allPaymentsExport.filter(
        p => p.ledgerRowId === null || (p.notes ?? "").includes("[Guarantee release]"),
      );

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

      const addPaymentSection = (title: string, rows: typeof payments) => {
        if (rows.length === 0) return;
        ws.addRow([]);
        const ph = ws.addRow([title, "", "", "", ""]);
        ws.mergeCells(`A${ph.number}:E${ph.number}`);
        ph.getCell(1).font = { bold: true, size: 10 };
        ph.getCell(1).fill = grayFill;
        ph.height = 16;

        const ph2 = ws.addRow(["Date", "For", "Amount ($)", "Notes", ""]);
        ph2.eachCell(c => { c.font = headerFont; c.fill = grayFill; });
        ph2.height = 15;

        for (const p of rows) {
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
      };

      addPaymentSection("RENT PAYMENT HISTORY", payments);
      addPaymentSection("GUARANTEE / DEPOSIT ACTIVITY", guaranteePaymentsExport);

      const filename = `Rental_${unit.unitNumber.replace(/\s+/g, "_")}_${contract.tenantName.replace(/\s+/g, "_")}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      res.end();
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { endDate, notes, refundGuarantee, refundAmount, refundCashAccountId, refundNotes } = z.object({
        endDate: z.string().min(1),
        notes: z.string().optional(),
        refundGuarantee: z.boolean().optional().default(false),
        refundAmount: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
        refundCashAccountId: z.number().nullable().optional(),
        refundNotes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id), eq(propertyContracts.companyId, companyId), eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const tenantPays = module === "ERP" || module === "FACTORY";

      await db.transaction(async (tx) => {
        await tx.update(propertyContracts).set({
          status: "ENDED", endDate: endDate as any,
          notes: notes ? `${contract.notes ? contract.notes + "\n" : ""}END: ${notes}` : contract.notes,
        }).where(eq(propertyContracts.id, id));

        const end = new Date(endDate);
        const ey = end.getUTCFullYear(), em = end.getUTCMonth() + 1;
        await tx.execute(sql`
          DELETE FROM property_monthly_ledger
          WHERE contract_id = ${id} AND paid_amount = 0
            AND ((year > ${ey}) OR (year = ${ey} AND month > ${em}))
        `);

        // ── Optional: refund remaining guarantee to tenant ──
        if (refundGuarantee && refundAmount && parseFloat(refundAmount) > 0) {
          const amt = refundAmount;
          const dateStr = endDate;
          const narration = refundNotes
            ? `Guarantee refund on departure - ${unitLabel} - ${refundNotes}`
            : `Guarantee refund on departure - ${unitLabel}`;

          if (refundCashAccountId) {
            if (tenantPays) {
              // Tenant gets guarantee back: Dr Security Deposits Paid (asset↓) / Cr Cash (we return money)
              // Actually: landlord returns money to tenant — Dr Cash reversal: Cr Cash / Dr Sec Dep Paid
              // We PAID the guarantee as an asset (Sec Dep Paid debit). Refund: Dr Cash received back / Cr Sec Dep Paid cleared
              const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
              const [v] = await tx.insert(vouchers).values({
                companyId, voucherNumber: `GUAR-REFUND-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
                voucherType: "Receipt", voucherDate: dateStr as any,
                description: narration, totalAmount: amt, currency: contract.currency || "USD", sourceModule: "ERP",
              }).returning();
              await tx.insert(voucherEntries).values([
                { voucherId: v.id, ledgerAccountId: refundCashAccountId, debitAmount: amt,  creditAmount: "0",  narration },
                { voucherId: v.id, ledgerAccountId: depositAccountId,    debitAmount: "0",  creditAmount: amt, narration },
              ]);
            } else {
              // Landlord returns deposit to departing tenant: Dr Tenant Deposits (liability↓) / Cr Cash (we pay out)
              const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
              const [v] = await tx.insert(vouchers).values({
                companyId, voucherNumber: `GUAR-REFUND-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
                voucherType: "Payment", voucherDate: dateStr as any,
                description: narration, totalAmount: amt, currency: contract.currency || "USD", sourceModule: "ERP",
              }).returning();
              await tx.insert(voucherEntries).values([
                { voucherId: v.id, ledgerAccountId: depositAccountId,    debitAmount: amt,  creditAmount: "0",  narration },
                { voucherId: v.id, ledgerAccountId: refundCashAccountId, debitAmount: "0",  creditAmount: amt, narration },
              ]);
            }
          }

          // Record in payments log as a guarantee activity (ledgerRowId: null so it shows in guarantee section)
          await tx.insert(propertyPayments).values({
            companyId, module, contractId: contract.id, unitId: contract.unitId,
            ledgerRowId: null,
            cashAccountId: refundCashAccountId ?? null,
            voucherId: null,
            amount: amt,
            paymentDate: dateStr as any,
            forYear: new Date(dateStr).getUTCFullYear(),
            forMonth: new Date(dateStr).getUTCMonth() + 1,
            notes: `[Guarantee refund] ${narration}`,
          });
        }
      });

      await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "update", tableName: "property_contracts", recordId: id, recordIdentifier: `Contract#${id}`, changes: { status: { old: "ACTIVE", new: "ENDED" }, endDate: { old: null, new: endDate } } });
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
              description: narration, totalAmount: amount, currency: contract.currency || "USD", sourceModule: "ERP",
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
              description: narration, totalAmount: amount, currency: contract.currency || "USD", sourceModule: "ERP",
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
          // Landlord perspective: deposit moves into cash — Dr Cash / Cr Tenant Deposits (Liability)
          // Auto-transfer then debits Transfer Clearing and credits Cash, netting the cashbox to zero.
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: cashAccountId,   debitAmount: amount, creditAmount: "0",   narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0",   creditAmount: amount, narration },
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

  // ── APPLY GUARANTEE AS RENT ──
  // No cash changes hands — Dr Tenant Deposits (or Sec Dep Paid) / Cr Rent Income (or Rent Expense)
  app.post(`${urlPrefix}/contracts/:id/guarantee-to-rent`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const { amount, paymentDate, notes } = z.object({
        amount: z.union([z.string(), z.number()]).transform(v => String(v)),
        paymentDate: z.string().min(1),
        notes: z.string().optional(),
      }).parse(req.body);

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id),
        eq(propertyContracts.companyId, companyId),
        eq(propertyContracts.module, module),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      await ensureMonthlyLedgerRows(contract.id);

      const pd = new Date(paymentDate);
      const y = pd.getUTCFullYear(), m = pd.getUTCMonth() + 1;
      const totalAmountNum = parseFloat(amount);
      const rentalAmountNum = parseFloat(contract.rentalAmount as string);

      const [unit] = await db.select().from(propertyUnits).where(eq(propertyUnits.id, contract.unitId));
      const unitLabel = unit ? `${unit.locationGroup}/${unit.unitNumber}` : `Unit#${contract.unitId}`;
      const isShop = unit?.unitType === "SHOP";
      const tenantPays = module === "ERP" || module === "FACTORY";

      const allocations = await buildAllocations(contract.id, y, m, totalAmountNum, rentalAmountNum);
      if (!allocations.length) return res.status(400).json({ message: "No outstanding rent to apply the guarantee to for that period." });

      await db.transaction(async (tx) => {
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

        const monthSpan = allocations.length > 1
          ? `${String(allocations[0].month).padStart(2,"0")}/${allocations[0].year} – ${String(allocations[allocations.length-1].month).padStart(2,"0")}/${allocations[allocations.length-1].year}`
          : `${String(m).padStart(2,"0")}/${y}`;
        const narration = notes
          ? `Guarantee applied to rent - ${unitLabel} - ${monthSpan} - ${notes}`
          : `Guarantee applied to rent - ${unitLabel} - ${monthSpan}`;

        // Journal: no cash account involved
        let voucherId: number;
        if (tenantPays && isShop) {
          // Tenant/shop pays rent: Dr Rent Expense - Shops (expense↑) / Cr Security Deposits Paid (asset↓)
          const expenseAccountId = await findOrCreateLedgerAccount(tx, companyId, shopExpenseAccountName, "Indirect Expense", "SHOP-RENT-EXP");
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
          const [v] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `GUAR-RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
            voucherType: "Journal",
            voucherDate: paymentDate as any,
            description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
          }).returning();
          voucherId = v.id;
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: expenseAccountId,  debitAmount: amount, creditAmount: "0",  narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId,  debitAmount: "0",  creditAmount: amount, narration },
          ]);
        } else if (tenantPays) {
          // Non-shop tenant: Dr Rent Expense / Cr Security Deposits Paid
          const expenseAccountId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Indirect Expense", "RENT-EXP");
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Security Deposits Paid", "Asset", "SEC-DEP-PAID");
          const [v] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `GUAR-RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
            voucherType: "Journal",
            voucherDate: paymentDate as any,
            description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
          }).returning();
          voucherId = v.id;
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: expenseAccountId, debitAmount: amount, creditAmount: "0",  narration },
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: "0", creditAmount: amount, narration },
          ]);
        } else {
          // Landlord: Dr Tenant Deposits (liability↓) / Cr Rent Income (income↑)
          const depositAccountId = await findOrCreateLedgerAccount(tx, companyId, "Tenant Deposits", "Liability", "TENANT-DEP");
          const incomeAccId = await findOrCreateLedgerAccount(tx, companyId, incomeAccountName, "Income", "RENT-INC", "Indirect Income");
          const [v] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `GUAR-RENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${id}`,
            voucherType: "Journal",
            voucherDate: paymentDate as any,
            description: narration, totalAmount: amount, currency: "USD", sourceModule: "ERP",
          }).returning();
          voucherId = v.id;
          await tx.insert(voucherEntries).values([
            { voucherId: v.id, ledgerAccountId: depositAccountId, debitAmount: amount, creditAmount: "0",  narration },
            { voucherId: v.id, ledgerAccountId: incomeAccId,      debitAmount: "0",  creditAmount: amount, narration },
          ]);
        }

        // Create one payment row per allocated month and update ledger
        for (const alloc of allocations) {
          const [row] = await tx.select().from(propertyMonthlyLedger).where(and(
            eq(propertyMonthlyLedger.contractId, contract.id),
            eq(propertyMonthlyLedger.year, alloc.year),
            eq(propertyMonthlyLedger.month, alloc.month),
          ));
          await tx.insert(propertyPayments).values({
            companyId, module, contractId: contract.id, unitId: contract.unitId,
            ledgerRowId: row.id,
            cashAccountId: null,
            voucherId,
            amount: alloc.chunk,
            paymentDate: paymentDate as any,
            forYear: alloc.year, forMonth: alloc.month,
            notes: allocations.length > 1
              ? `[Guarantee applied] ${narration} | Split from ${amount}`
              : `[Guarantee applied] ${narration}`,
          }).returning();
          await tx.execute(sql`
            UPDATE property_monthly_ledger SET paid_amount = paid_amount + ${alloc.chunk}::numeric WHERE id = ${row.id}
          `);
        }

        // guarantee_posted_amount is only managed by "Post to Statement" / "Move to Cash".
        // Applied-as-rent amounts are tracked via payment records ([Guarantee applied] notes).
      });

      res.json({ ok: true, allocations });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors.map((err: any) => err.message).join(", ") });
      res.status(500).json({ message: e.message });
    }
  });

  // ── UNDO GUARANTEE APPLIED AS RENT ──
  // Reverses every "[Guarantee applied]" payment on a contract: restores ledger
  // paid_amounts, soft-deletes accounting vouchers, removes inter-company
  // transfers, and resets the contract's guaranteePostedAmount.
  app.post(`${urlPrefix}/contracts/:id/undo-guarantee-as-rent`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [contract] = await db.select().from(propertyContracts).where(and(
        eq(propertyContracts.id, id),
        eq(propertyContracts.companyId, companyId),
      ));
      if (!contract) return res.status(404).json({ message: "Contract not found" });

      // Find all guarantee-applied payments for this contract
      const appliedPayments = await db.select().from(propertyPayments).where(and(
        eq(propertyPayments.contractId, id),
        eq(propertyPayments.companyId, companyId),
        sql`${propertyPayments.notes} LIKE '%[Guarantee applied]%'`,
      ));

      if (appliedPayments.length === 0) {
        return res.json({ ok: true, reversed: 0, message: "No guarantee-applied payments found" });
      }

      let totalReversed = 0;

      await db.transaction(async tx => {
        for (const payment of appliedPayments) {
          // 1. Reverse the monthly ledger paid_amount
          if (payment.ledgerRowId) {
            await tx.execute(sql`
              UPDATE property_monthly_ledger
              SET paid_amount = GREATEST(0, paid_amount - ${payment.amount}::numeric)
              WHERE id = ${payment.ledgerRowId}
            `);
          }

          // 2. Soft-delete the voucher only if no other payment shares it
          if (payment.voucherId) {
            const siblings = await tx.select({ id: propertyPayments.id })
              .from(propertyPayments)
              .where(and(
                eq(propertyPayments.voucherId, payment.voucherId),
                sql`${propertyPayments.id} != ${payment.id}`,
              ));
            if (siblings.length === 0) {
              await tx.execute(sql`UPDATE vouchers SET deleted_at = NOW() WHERE id = ${payment.voucherId}`);
            }
          }

          // 3. Reverse any auto-transfers created for this payment
          const linkedTransfers = await tx.select()
            .from(interCompanyTransfers)
            .where(eq(interCompanyTransfers.sourcePaymentId, payment.id));
          for (const transfer of linkedTransfers) {
            await tx.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, transfer.id));
            if (transfer.fromVoucherId) {
              await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, transfer.fromVoucherId));
              await tx.delete(vouchers).where(eq(vouchers.id, transfer.fromVoucherId));
            }
            if (transfer.toVoucherId) {
              await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, transfer.toVoucherId));
              await tx.delete(vouchers).where(eq(vouchers.id, transfer.toVoucherId));
            }
          }

          // 4. Delete the payment row
          await tx.delete(propertyPayments).where(eq(propertyPayments.id, payment.id));
          totalReversed++;
        }

        // guarantee_posted_amount is only managed by "Post to Statement" / "Move to Cash".
        // Applied-as-rent amounts are tracked via payment records ([Guarantee applied] notes).
      });

      res.json({ ok: true, reversed: totalReversed });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── RECORD PAYMENT ──
}
