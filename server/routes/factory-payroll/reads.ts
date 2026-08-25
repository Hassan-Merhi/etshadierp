/**
 * factoryPayrollRoutes: FactoryPayrollRead endpoints.
 *
 * Production-bonus proposals are refreshed only for DRAFT payroll periods.
 * APPROVED/PAID payrolls are read-only historical records and are never given
 * newly-created bonus proposals retroactively.
 */
import type { Database } from "../../db";
import type { Express, Request, Response, RequestHandler } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { parseId } from "../../lib/parseId";
import { eq, and, asc, gte, lte, desc } from "drizzle-orm";
import { factoryWorkers, factoryPayrolls, ledgerAccounts } from "@shared/schema";

import {
  attachProductionBonusesToPayroll,
  getProductionBonusTotalsForPayrollIds,
  prepareProductionBonusesForPayroll,
  syncProductionBonusProposalsForPeriod,
} from "../../services/payroll/productionBonusPayrollService";

const emptyTotals = () => ({
  approved: 0,
  pending: 0,
  rejected: 0,
  totalSuggested: 0,
  pendingCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
});

export function registerFactoryPayrollReadRoutes(app: Express, requireAuth: RequestHandler, db: Database) {
  app.get("/api/factory/payroll", requireAuth, async (req: Request, res: Response) => {
    try {
      const { companyId, startDate, endDate, status } = req.query;
      if (!companyId) return res.status(400).json({ message: "companyId is required" });

      const companyIdNum = parseInt(companyId as string, 10);
      if (isNaN(companyIdNum)) return res.status(400).json({ message: "Invalid companyId" });
      const conditions = [eq(factoryPayrolls.companyId, companyIdNum)];
      if (startDate) conditions.push(gte(factoryPayrolls.periodStart, startDate as string));
      if (endDate) conditions.push(lte(factoryPayrolls.periodEnd, endDate as string));
      if (status) conditions.push(eq(factoryPayrolls.status, status as string));

      const results = await db
        .select({
          payroll: factoryPayrolls,
          workerName: factoryWorkers.fullName,
          workerCode: factoryWorkers.employeeCode,
          workerPosition: factoryWorkers.position,
          workerSalaryType: factoryWorkers.salaryType,
          workerDepartment: factoryWorkers.department,
        })
        .from(factoryPayrolls)
        .leftJoin(factoryWorkers, eq(factoryPayrolls.workerId, factoryWorkers.id))
        .where(and(...conditions))
        .orderBy(asc(factoryWorkers.fullName), desc(factoryPayrolls.periodStart));

      // Refresh proposals only where at least one payroll in the result is DRAFT.
      // This makes historical APPROVED/PAID reads side-effect free.
      const periodKeys = new Set<string>();
      for (const result of results) {
        if (result.payroll.status !== "DRAFT") continue;
        const key = `${result.payroll.periodStart}:${result.payroll.periodEnd}`;
        if (periodKeys.has(key)) continue;
        periodKeys.add(key);
        await syncProductionBonusProposalsForPeriod(
          db,
          companyIdNum,
          result.payroll.periodStart,
          result.payroll.periodEnd
        );
      }
      for (const result of results) {
        if (result.payroll.status === "DRAFT") await attachProductionBonusesToPayroll(db, result.payroll.id);
      }

      const bonusTotals = await getProductionBonusTotalsForPayrollIds(
        db,
        results.map((result) => result.payroll.id)
      );
      const formatted = results.map((r) => {
        const production = bonusTotals.get(r.payroll.id) ?? emptyTotals();
        const totalBonuses = Number(r.payroll.bonuses ?? 0);
        return {
          ...r.payroll,
          workerName: r.workerName,
          workerCode: r.workerCode,
          workerPosition: r.workerPosition,
          workerSalaryType: r.workerSalaryType,
          workerDepartment: r.workerDepartment,
          productionBonus: production.approved.toFixed(2),
          pendingProductionBonus: production.pending.toFixed(2),
          rejectedProductionBonus: production.rejected.toFixed(2),
          suggestedProductionBonus: production.totalSuggested.toFixed(2),
          productionBonusPendingCount: production.pendingCount,
          productionBonusApprovedCount: production.approvedCount,
          productionBonusRejectedCount: production.rejectedCount,
          otherBonuses: Math.max(0, totalBonuses - production.approved).toFixed(2),
        };
      });

      res.json(formatted);
    } catch (error: unknown) {
      logger.error("Error fetching payroll", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/payroll/:id/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [row] = await db
        .select({
          id: factoryPayrolls.id,
          workerId: factoryPayrolls.workerId,
          periodStart: factoryPayrolls.periodStart,
          periodEnd: factoryPayrolls.periodEnd,
          baseSalary: factoryPayrolls.baseSalary,
          baleEarnings: factoryPayrolls.baleEarnings,
          kgEarnings: factoryPayrolls.kgEarnings,
          overtimePay: factoryPayrolls.overtimePay,
          bonuses: factoryPayrolls.bonuses,
          transport: factoryPayrolls.transport,
          deductions: factoryPayrolls.deductions,
          advances: factoryPayrolls.advances,
          netSalary: factoryPayrolls.netSalary,
          balesCount: factoryPayrolls.balesCount,
          kgProcessed: factoryPayrolls.kgProcessed,
          overtimeHours: factoryPayrolls.overtimeHours,
          presentDays: factoryPayrolls.presentDays,
          absentDays: factoryPayrolls.absentDays,
          totalWorkingDays: factoryPayrolls.totalWorkingDays,
          status: factoryPayrolls.status,
          cashAccountId: factoryPayrolls.cashAccountId,
          paidAt: factoryPayrolls.paidAt,
          notes: factoryPayrolls.notes,
          workerName: factoryWorkers.fullName,
          workerCode: factoryWorkers.employeeCode,
          workerPosition: factoryWorkers.position,
          cashAccountName: ledgerAccounts.name,
        })
        .from(factoryPayrolls)
        .leftJoin(factoryWorkers, eq(factoryPayrolls.workerId, factoryWorkers.id))
        .leftJoin(ledgerAccounts, eq(factoryPayrolls.cashAccountId, ledgerAccounts.id))
        .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)));

      if (!row) return res.status(404).json({ message: "Payroll not found" });
      if (row.status === "DRAFT") await prepareProductionBonusesForPayroll(db, id);
      const production = (await getProductionBonusTotalsForPayrollIds(db, [id])).get(id) ?? emptyTotals();
      res.json({
        ...row,
        productionBonus: production.approved.toFixed(2),
        pendingProductionBonus: production.pending.toFixed(2),
        rejectedProductionBonus: production.rejected.toFixed(2),
        suggestedProductionBonus: production.totalSuggested.toFixed(2),
        otherBonuses: Math.max(0, Number(row.bonuses ?? 0) - production.approved).toFixed(2),
      });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
