import type { Express, Request } from "express";

import { requireAuth, requireRole } from "../../auth";
import { db, pool } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  CompanyAccessError,
  getAccessibleCompanyIds,
  resolveAuthorizedCompanyId,
  sendCompanyAccessError,
} from "../../security/companyAccessBoundary";
import { storage } from "../../storage";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";

function disableSessionResponseCaching(res: { setHeader: (name: string, value: string) => void }) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Cookie");
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function registerCompanyAccessRoutes(app: Express) {
  app.get("/api/companies", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      const accessible = await getAccessibleCompanyIds(req.user.id);
      const allCompanies = await storage.getAllCompanies();
      res.json(allCompanies.filter((company) => accessible.has(Number(company.id))));
    } catch (error: unknown) {
      if (error instanceof CompanyAccessError) return sendCompanyAccessError(res, error);
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/user/companies", requireAuth, async (req, res) => {
    disableSessionResponseCaching(res);
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      if (req.user.role === "Developer") {
        const allCompanies = await storage.getAllCompanies();
        return res.json(
          allCompanies.map((company) => ({
            id: -1,
            userId: req.user!.id,
            companyId: company.id,
            role: "Developer",
            assignedLocationId: null,
            cashAccountId: null,
            posStation: null,
            canSellNegativeStock: true,
            daybookEditDays: 9999,
            canAccessCustomers: true,
            createdAt: new Date(),
            companyCode: company.code,
            companyName: company.name,
            companyActive: company.active,
            companyType: company.companyType || "erp",
          }))
        );
      }

      const { rows } = await pool.query(
        `SELECT
           ucr.id,
           ucr.user_id                  AS "userId",
           ucr.company_id               AS "companyId",
           ucr.role,
           ucr.assigned_location_id     AS "assignedLocationId",
           ucr.cash_account_id          AS "cashAccountId",
           ucr.pos_station              AS "posStation",
           ucr.can_sell_negative_stock  AS "canSellNegativeStock",
           ucr.daybook_edit_days        AS "daybookEditDays",
           ucr.can_access_customers     AS "canAccessCustomers",
           ucr.can_delete_records       AS "canDeleteRecords",
           ucr.pos_view_only            AS "posViewOnly",
           ucr.created_at               AS "createdAt",
           c.code                       AS "companyCode",
           c.name                       AS "companyName",
           c.active                     AS "companyActive",
           COALESCE(c.company_type, 'erp') AS "companyType"
         FROM user_company_roles ucr
         INNER JOIN companies c ON c.id = ucr.company_id
         WHERE ucr.user_id = $1
         ORDER BY c.name`,
        [req.user.id]
      );
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/companies", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      res.status(201).json(await storage.createCompany(req.body));
    } catch (error: unknown) {
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/companies/:id", requireAuth, async (req, res) => {
    try {
      const companyId = await resolveAuthorizedCompanyId(req, req.params.id);
      const company = await storage.getCompanyById(companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });
      res.json(company);
    } catch (error: unknown) {
      if (error instanceof CompanyAccessError) return sendCompanyAccessError(res, error);
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.patch("/api/companies/:id", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = await resolveAuthorizedCompanyId(req, req.params.id);
      res.json(await storage.updateCompany(companyId, req.body));
    } catch (error: unknown) {
      if (error instanceof CompanyAccessError) return sendCompanyAccessError(res, error);
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/companies/:id", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = await resolveAuthorizedCompanyId(req, req.params.id);
      await storage.deleteCompany(companyId);
      res.json({ message: "Company deleted successfully" });
    } catch (error: unknown) {
      if (error instanceof CompanyAccessError) return sendCompanyAccessError(res, error);
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/auth/session-company", requireAuth, (req, res) => {
    disableSessionResponseCaching(res);
    res.json({ companyId: req.session.currentCompanyId ?? null });
  });

  app.post("/api/auth/set-company", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ message: "Company ID is required" });
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });

      let userRole = await storage.getUserCompanyRole(req.user.id, companyId);
      if (!userRole) {
        if (req.user.role === "Developer") {
          userRole = {
            id: -1,
            userId: req.user.id,
            companyId,
            role: "Developer",
            assignedLocationId: null,
            posStation: null,
            cashAccountId: null,
            canSellNegativeStock: true,
            posViewOnly: false,
            daybookEditDays: 9999,
            canAccessCustomers: true,
            canDeleteRecords: true,
            createdAt: new Date(),
          };
        } else {
          return res.status(403).json({ message: "You don't have access to this company" });
        }
      }

      const [companyRow] = await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      req.session.currentCompanyId = companyId;
      delete req.session.factoryCompanyId;
      req.session.currentRole = userRole.role;
      req.session.currentLocationId = userRole.assignedLocationId;
      req.session.currentPOSStation = userRole.posStation;
      req.session.cashAccountId = userRole.cashAccountId;
      req.session.canSellNegativeStock = userRole.canSellNegativeStock;
      req.session.posViewOnly = userRole.posViewOnly ?? false;
      req.session.daybookEditDays = userRole.daybookEditDays;
      req.session.canAccessCustomers = userRole.canAccessCustomers;
      req.session.canDeleteRecords = userRole.canDeleteRecords;
      req.session.currentCompanyName = companyRow?.name ?? null;

      try {
        await saveSession(req);
      } catch (error: unknown) {
        logger.error("Error saving session:", { error });
        return res.status(500).json({ message: "Failed to save session" });
      }

      res.json({ message: "Company set successfully", companyId });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
