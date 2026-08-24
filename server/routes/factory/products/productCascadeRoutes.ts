/**
 * factoryProductsRoutes: FactoryProductCascade endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { parseId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { factoryBaleProducts, factoryBales } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export function registerFactoryProductCascadeRoutes(app: Express) {
  app.post("/api/factory/bale-products/:id/cascade-update", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const {
        name,
        weightPerBaleKg,
        articleCode,
        description,
        categoryId,
        productionPrice,
        sellingPrice,
        labelDesignColor,
      } = req.body;

      const [existing] = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)));

      if (!existing) return res.status(404).json({ message: "Product not found" });

      // If name is being changed, verify it isn't already taken (case-insensitive)
      if (name !== undefined && name.trim().toLowerCase() !== existing.name.toLowerCase()) {
        const [nameConflict] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              sql`LOWER(${factoryBaleProducts.name}) = LOWER(${name.trim()})`,
              sql`${factoryBaleProducts.id} != ${id}`
            )
          );
        if (nameConflict) {
          return res.status(400).json({ message: `A product named "${name.trim()}" already exists` });
        }
      }

      // If article code is being changed, verify it isn't already taken by another product
      if (articleCode !== undefined && articleCode !== existing.articleCode) {
        const [conflict] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              eq(factoryBaleProducts.articleCode, articleCode),
              sql`${factoryBaleProducts.id} != ${id}`
            )
          );
        if (conflict) {
          return res.status(400).json({ message: `Article code "${articleCode}" is already used by another product` });
        }
      }

      // Only admins/owners/developers may change the label design color
      if (labelDesignColor !== undefined) {
        const userRole = req.user?.role || "";
        if (!["Admin", "Owner", "Developer"].includes(userRole)) {
          return res.status(403).json({ message: "Only administrators can change the label design color" });
        }
      }

      const productUpdate = { updatedAt: new Date() };
      if (name !== undefined) productUpdate.name = name;
      if (weightPerBaleKg !== undefined) productUpdate.weightPerBaleKg = weightPerBaleKg;
      if (articleCode !== undefined) productUpdate.articleCode = articleCode;
      if (description !== undefined) productUpdate.description = description;
      if (categoryId !== undefined) productUpdate.categoryId = categoryId;
      if (productionPrice !== undefined && productionPrice !== "")
        productUpdate.productionPrice = String(parseFloat(productionPrice) || 0);
      if (sellingPrice !== undefined && sellingPrice !== "")
        productUpdate.sellingPrice = String(parseFloat(sellingPrice) || 0);
      if (labelDesignColor !== undefined) productUpdate.labelDesignColor = labelDesignColor || null;

      const [updatedProduct] = await db
        .update(factoryBaleProducts)
        .set(productUpdate)
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)))
        .returning();

      const baleUpdate = {};
      if (name !== undefined && name !== existing.name) baleUpdate.productName = name;
      if (weightPerBaleKg !== undefined && weightPerBaleKg !== existing.weightPerBaleKg)
        baleUpdate.weightKg = weightPerBaleKg;
      if (articleCode !== undefined && articleCode !== existing.articleCode) baleUpdate.articleCode = articleCode;

      let balesUpdated = 0;
      if (Object.keys(baleUpdate).length > 0) {
        baleUpdate.updatedAt = new Date();
        const result = await db
          .update(factoryBales)
          .set(baleUpdate)
          .where(and(eq(factoryBales.productId, id), eq(factoryBales.companyId, companyId)));
        balesUpdated = result.rowCount ?? 0;
      }

      res.json({ product: updatedProduct, balesUpdated });
    } catch (error: unknown) {
      logger.error("Error cascade updating bale product:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });
}
