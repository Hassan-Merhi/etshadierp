/**
 * factoryCustomerProformaRoutes: FactoryCustomerProformaCrud endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { syncProformaReservations } from "../_stockReservationHelper";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import {
  factoryBaleProducts,
  customerProformas,
  customers,
  insertCustomerProformaSchema,
  proformaStockReservations,
} from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";

export function registerFactoryCustomerProformaCrudRoutes(app: Express) {
  /* Single proforma by ID — used by EditProformaV5Drawer */
  app.get("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      // Use SELECT * to avoid "column does not exist" errors when the Drizzle schema
      // has columns not yet migrated to production.
      const rawProformaRes = await db.execute(
        sql`SELECT * FROM customer_proformas WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL LIMIT 1`
      );
      const rawProformaRows: any[] = (rawProformaRes as any).rows ?? (rawProformaRes as unknown as any[]);
      if (!rawProformaRows.length) return res.status(404).json({ message: "Proforma not found" });
      const pr = rawProformaRows[0];
      const proforma = {
        id: pr.id,
        companyId: pr.company_id,
        customerId: pr.customer_id,
        name: pr.name ?? "",
        isActive: pr.is_active ?? false,
        deletedAt: pr.deleted_at ?? null,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at ?? pr.created_at,
      };
      // Raw SQL to avoid "column does not exist" when price_fixed / production_price_per_bale
      // are absent from the production DB.
      const rawLinesRes = await db.execute(sql`SELECT * FROM customer_proforma_lines WHERE proforma_id = ${id}`);
      const lines: any[] = ((rawLinesRes as any).rows ?? (rawLinesRes as unknown as any[])).map((l: any) => ({
        id: l.id,
        proformaId: l.proforma_id,
        articleCode: l.article_code ?? "",
        productName: l.product_name ?? "",
        quantity: Number(l.quantity) || 0,
        pricePerBale: l.price_per_bale ?? "0",
        productionPricePerBale: l.production_price_per_bale ?? "0",
        priceFixed: l.price_fixed ?? false,
        pricingMode: l.pricing_mode ?? "per_bale",
        pricePerKg: l.price_per_kg ?? null,
        createdAt: l.created_at,
      }));
      const articleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const weightMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const baleProds = await db
          .select({
            articleCode: factoryBaleProducts.articleCode,
            weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
            name: factoryBaleProducts.name,
          })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              inArray(factoryBaleProducts.articleCode, articleCodes as string[])
            )
          );
        baleProds.forEach((p: any) => {
          if (p.articleCode) weightMap.set(p.articleCode, p.weightPerBaleKg || "0");
        });
      }
      const enrichedLines = lines.map((l: any) => ({ ...l, weightPerBaleKg: weightMap.get(l.articleCode) || "0" }));
      res.json({ ...proforma, lines: enrichedLines });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = req.query.customerId ? parseOptionalId(req.query.customerId) : null;
      if (!customerId) return res.status(400).json({ message: "customerId is required" });

      // SELECT * to avoid explicit-column failures when the Drizzle schema has
      // columns not yet migrated to production (e.g. is_active added later).
      const rawProformasRes = await db.execute(
        sql`SELECT * FROM customer_proformas
            WHERE company_id = ${companyId}
              AND customer_id = ${customerId}
              AND deleted_at IS NULL
            ORDER BY name ASC`
      );
      const proformas: any[] = ((rawProformasRes as any).rows ?? (rawProformasRes as unknown as any[])).map(
        (r: any) => ({
          id: r.id,
          companyId: r.company_id,
          customerId: r.customer_id,
          name: r.name ?? "",
          isActive: r.is_active ?? false,
          deletedAt: r.deleted_at ?? null,
          createdAt: r.created_at,
          updatedAt: r.updated_at ?? r.created_at,
        })
      );

      const proformaIds = proformas.map((p: any) => p.id);
      let lines: any[] = [];
      if (proformaIds.length > 0) {
        // ANY(${jsArray}) generates tuple syntax ANY(($1,$2,...)) which PostgreSQL
        // rejects.  Use IN (${sql.join(...)}) which produces valid IN ($1,$2,...).
        const idList = sql.join(
          proformaIds.map((id: number) => sql`${id}`),
          sql`,`
        );
        const rawLines = await db.execute(sql`SELECT * FROM customer_proforma_lines WHERE proforma_id IN (${idList})`);
        const rawRows: any[] = (rawLines as any).rows ?? (rawLines as unknown as any[]);
        lines = rawRows.map((l: any) => ({
          id: l.id,
          proformaId: l.proforma_id,
          articleCode: l.article_code ?? "",
          productName: l.product_name ?? "",
          quantity: Number(l.quantity) || 0,
          pricePerBale: l.price_per_bale ?? "0",
          productionPricePerBale: l.production_price_per_bale ?? "0",
          priceFixed: l.price_fixed ?? false,
          createdAt: l.created_at,
        }));
      }

      // Enrich lines with weightPerBaleKg and correct productName from factoryBaleProducts
      const articleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const weightMap = new Map<string, string>();
      const nameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const baleProds = await db
          .select({
            articleCode: factoryBaleProducts.articleCode,
            weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
            name: factoryBaleProducts.name,
          })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              inArray(factoryBaleProducts.articleCode, articleCodes as string[])
            )
          );
        baleProds.forEach((p: any) => {
          if (p.articleCode) {
            weightMap.set(p.articleCode, p.weightPerBaleKg || "0");
            if (p.name) nameMap.set(p.articleCode, p.name);
          }
        });
      }

      const enrichedLines = lines.map((l: any) => ({
        ...l,
        weightPerBaleKg: weightMap.get(l.articleCode) || "0",
        productName: nameMap.get(l.articleCode) || l.productName,
      }));

      const result = proformas.map((p: any) => ({
        ...p,
        lines: enrichedLines.filter((l: any) => l.proformaId === p.id),
      }));

      res.json(result);
    } catch (error: unknown) {
      logger.error("Error fetching customer proformas:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerProformaSchema.parse({ ...req.body, companyId });

      const [duplicate] = await db
        .select({ id: customerProformas.id })
        .from(customerProformas)
        .where(
          and(
            eq(customerProformas.companyId, companyId),
            eq(customerProformas.customerId, parsed.customerId),
            eq(customerProformas.name, parsed.name)
          )
        );
      if (duplicate) {
        return res.status(409).json({
          message: `A proforma named "${parsed.name}" already exists for this customer. Please choose a different name.`,
        });
      }

      const [proforma] = await db.insert(customerProformas).values(parsed).returning();
      // Sync reservations — no lines yet, but initialises a clean slate
      await syncProformaReservations(db, companyId, proforma.id);
      res.json(proforma);
    } catch (error: unknown) {
      logger.error("Error creating customer proforma:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.put("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [existing] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Proforma not found" });

      if (req.body.name && req.body.name !== existing.name) {
        const [duplicate] = await db
          .select({ id: customerProformas.id })
          .from(customerProformas)
          .where(
            and(
              eq(customerProformas.companyId, companyId),
              eq(customerProformas.customerId, existing.customerId),
              eq(customerProformas.name, req.body.name)
            )
          );
        if (duplicate) {
          return res.status(409).json({
            message: `A proforma named "${req.body.name}" already exists for this customer. Please choose a different name.`,
          });
        }
      }

      const [updated] = await db
        .update(customerProformas)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      // Sync reservations — critical when isActive toggled (releases/restores reservation)
      await syncProformaReservations(db, companyId, id);
      res.json(updated);
    } catch (error: unknown) {
      logger.error("Error updating customer proforma:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      // Fetch proforma before deleting so we can log which customer it belongs to
      const [proformaBefore] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (proformaBefore) {
        const [custBefore] = await db
          .select({ id: customers.id, legalName: customers.legalName, deletedAt: customers.deletedAt })
          .from(customers)
          .where(eq(customers.id, proformaBefore.customerId));
        logger.info(
          `[PROFORMA DELETE] Deleting proforma id=${id} name="${proformaBefore.name}" customerId=${proformaBefore.customerId} customerName="${custBefore?.legalName}" customerDeletedAt=${custBefore?.deletedAt}`
        );
      }

      // Soft-delete: release reservations so stock returns to freeToPromise,
      // but keep proforma + lines intact for restore from Settings → Deleted Items.
      await db
        .update(customerProformas)
        .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      await syncProformaReservations(db, companyId, id);
      await db
        .delete(proformaStockReservations)
        .where(and(eq(proformaStockReservations.companyId, companyId), eq(proformaStockReservations.proformaId, id)));
      const [deleted] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));

      if (!deleted) return res.status(404).json({ message: "Proforma not found" });

      // Verify customer still exists after proforma deletion
      if (proformaBefore) {
        const [custAfter] = await db
          .select({ id: customers.id, legalName: customers.legalName, deletedAt: customers.deletedAt })
          .from(customers)
          .where(eq(customers.id, proformaBefore.customerId));
        logger.info(
          `[PROFORMA DELETE] After deletion: customerId=${proformaBefore.customerId} customerName="${custAfter?.legalName}" customerDeletedAt=${custAfter?.deletedAt}`
        );
      }

      res.json({ message: "Proforma deleted" });
    } catch (error: unknown) {
      logger.error("Error deleting customer proforma:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
