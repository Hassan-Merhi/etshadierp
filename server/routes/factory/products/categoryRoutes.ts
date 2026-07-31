/**
 * factoryProductsRoutes: FactoryCategory endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { factoryCategories, insertFactoryCategorySchema } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

export function registerFactoryCategoryRoutes(app: Express) {
  app.get("/api/factory/categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryCategories)
        .where(and(eq(factoryCategories.companyId, companyId), isNull(factoryCategories.deletedAt)))
        .orderBy(factoryCategories.name);

      res.json(results);
    } catch (error: unknown) {
      logger.error("Error fetching factory categories:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactoryCategorySchema.parse({ ...req.body, companyId });
      const [category] = await db.insert(factoryCategories).values(parsed).returning();
      res.json(category);
    } catch (error: unknown) {
      logger.error("Error creating factory category:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.patch("/api/factory/categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [updated] = await db
        .update(factoryCategories)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factoryCategories.id, id), eq(factoryCategories.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (error: unknown) {
      logger.error("Error updating factory category:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/factory/categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [updated] = await db
        .update(factoryCategories)
        .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(factoryCategories.id, id), eq(factoryCategories.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (error: unknown) {
      logger.error("Error deleting factory category:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
