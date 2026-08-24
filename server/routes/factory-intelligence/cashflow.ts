/**
 * factoryIntelligenceRoutes: FactoryCashflow endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { eq, and, gte, lte } from "drizzle-orm";
import { factoryWorkers, containerFreight, containerFreightPayments, customerOrders } from "@shared/schema";

import type { AppDb, AuthMiddleware } from "../routeBoundaryTypes";

export function registerFactoryCashflowRoutes(app: Express, requireAuth: AuthMiddleware, db: AppDb) {
  app.get("/api/factory/cashflow", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const days = parseInt(req.query.days as string) || 30;
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + days);
      const todayStr = today.toISOString().split("T")[0];
      const futureDateStr = futureDate.toISOString().split("T")[0];

      const freightEntries = await db
        .select()
        .from(containerFreight)
        .where(
          and(
            eq(containerFreight.companyId, companyId),
            gte(containerFreight.dueDate, todayStr),
            lte(containerFreight.dueDate, futureDateStr)
          )
        );

      const freightPayments = await db
        .select()
        .from(containerFreightPayments)
        .where(eq(containerFreightPayments.companyId, companyId));

      const upcomingFreight = [];
      let totalFreightOutgoing = 0;

      for (const f of freightEntries) {
        const amount = parseFloat(f.freightAmount || "0");
        const paid = freightPayments
          .filter((p) => p.containerFreightId === f.id)
          .reduce((s: number, p) => s + parseFloat(p.amount || "0"), 0);
        const remaining = amount - paid;
        if (remaining > 0.01) {
          upcomingFreight.push({
            vendorName: f.vendorName || "Unknown",
            amount: Math.round(amount * 100) / 100,
            dueDate: f.dueDate,
            remaining: Math.round(remaining * 100) / 100,
          });
          totalFreightOutgoing += remaining;
        }
      }

      const activeWorkers = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));

      const totalMonthlyPayroll = activeWorkers.reduce((s: number, w) => {
        return s + parseFloat(w.baseSalary || "0");
      }, 0);

      const payPeriods = Math.ceil(days / 30);
      const payrollEstimate = totalMonthlyPayroll * payPeriods;

      const totalOutgoing = totalFreightOutgoing + payrollEstimate;

      const pendingOrders = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.companyId, companyId), eq(customerOrders.status, "FINALIZED")));

      const expectedIncome = pendingOrders.reduce((s: number, o) => s + parseFloat(o.grandTotal || "0"), 0);

      res.json({
        upcomingFreight,
        payrollEstimate: Math.round(payrollEstimate * 100) / 100,
        totalOutgoing: Math.round(totalOutgoing * 100) / 100,
        expectedIncome: Math.round(expectedIncome * 100) / 100,
      });
    } catch (error: unknown) {
      logger.error("Error fetching cash flow forecast:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
