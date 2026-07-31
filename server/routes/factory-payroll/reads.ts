/**
 * factoryPayrollRoutes: FactoryPayrollRead endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { parseId } from "../../lib/parseId";
import { eq, and, asc, gte, lte, desc } from "drizzle-orm";
import { factoryWorkers, factoryPayrolls, ledgerAccounts } from "@shared/schema";

export function registerFactoryPayrollReadRoutes(app: Express, requireAuth: any, db: any) {
  app.get("/api/factory/payroll", requireAuth, async (req: any, res: any) => {
    try {
      const { companyId, startDate, endDate, status } = req.query;
      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const companyIdNum = parseInt(companyId as string, 10);
      if (isNaN(companyIdNum)) return res.status(400).json({ message: "Invalid companyId" });
      const conditions: any[] = [eq(factoryPayrolls.companyId, companyIdNum)];
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

      const formatted = results.map((r: any) => ({
        ...r.payroll,
        workerName: r.workerName,
        workerCode: r.workerCode,
        workerPosition: r.workerPosition,
        workerSalaryType: r.workerSalaryType,
        workerDepartment: r.workerDepartment,
      }));

      res.json(formatted);
    } catch (error: unknown) {
      logger.error("Error fetching payroll:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ── GET single payroll summary (for daybook detail view) ─────────────────
  app.get("/api/factory/payroll/:id/summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
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
      res.json(row);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
