import type { Express } from "express";

import { requireAuth, requireRole } from "../../auth";
import { db, pool } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { storage } from "../../storage";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";

export function registerCompanyAccessRoutes(app: Express) {
  app.get("/api/companies", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.getAllCompanies());
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/user/companies", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      if (req.user.role === "Developer") {
        const allCompanies = await storage.getAllCompanies();
        return res.json(
          allCompanies.map((company: any) => ({
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
          })),
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
        [req.user.id],
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
      const company = await storage.getCompanyById(parseInt(req.params.id));
      if (!company) return res.status(404).json({ message: "Company not found" });
      res.json(company);
    } catch (error: unknown) {
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.patch("/api/companies/:id", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      res.json(await storage.updateCompany(parseInt(req.params.id), req.body));
    } catch (error: unknown) {
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/companies/:id", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      await storage.deleteCompany(parseInt(req.params.id));
      res.json({ message: "Company deleted successfully" });
    } catch (error: unknown) {
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/auth/session-company", requireAuth, (req, res) => {
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

      req.session.currentCompanyId = companyId;
      delete (req.session as any).factoryCompanyId;
      req.session.currentRole = userRole.role;
      req.session.currentLocationId = userRole.assignedLocationId;
      req.session.currentPOSStation = userRole.posStation;
      req.session.cashAccountId = userRole.cashAccountId;
      req.session.canSellNegativeStock = userRole.canSellNegativeStock;
      (req.session as any).posViewOnly = (userRole as any).posViewOnly ?? false;
      req.session.daybookEditDays = userRole.daybookEditDays;
      req.session.canAccessCustomers = userRole.canAccessCustomers;
      req.session.canDeleteRecords = userRole.canDeleteRecords;

      db.select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1)
        .then((rows) => {
          (req.session as any).currentCompanyName = rows[0]?.name || null;
        })
        .catch(() => {});

      req.session.save((error) => {
        if (error) {
          logger.error("Error saving session:", { error });
          return res.status(500).json({ message: "Failed to save session" });
        }
        res.json({ message: "Company set successfully", companyId });
      });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
