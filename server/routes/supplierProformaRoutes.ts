import { parseId, parseOptionalId } from "../lib/parseId";
import { logAudit } from "./_helpers";
import { Express } from "express";
import { db } from "../db";
import { eq, and, inArray, ne } from "drizzle-orm";
import ExcelJS from "exceljs";
import {
  supplierProformas,
  supplierProformaLines,
  supplierContainerLoadedItems,
  containers,
  suppliers,
  purchaseOrders,
  poLineItems,
  stockItems,
  stockItemCodeAliases,
} from "@shared/schema";

/**
 * Parse a human-entered decimal value from Excel into a PostgreSQL-safe decimal string.
 * Accepts: optional leading sign, digit groups separated by commas (thousands), optional
 * decimal point with fractional digits, optional currency prefix/suffix, and surrounding
 * whitespace.  Everything else (text, "N/A", scientific notation, etc.) returns "0".
 */
function sanitizeDecimal(v: any): string {
  const raw = String(v ?? "").trim();
  // Strip leading/trailing currency symbols and whitespace
  const stripped = raw.replace(/^[^0-9\-\(]+/, "").replace(/[^0-9\.]+$/, "");
  // Remove thousands commas: only valid when pattern is NNN,NNN,...
  const noCommas = stripped.replace(/,(?=\d{3}(?:[,.]|$))/g, "");
  // Must match: optional minus, digits, optional .digits — nothing else
  if (!/^-?\d+(\.\d+)?$/.test(noCommas)) return "0";
  const n = parseFloat(noCommas);
  if (!isFinite(n)) return "0";
  return n.toFixed(6).replace(/\.?0+$/, "") || "0";
}

/**
 * Insert proforma lines in chunks inside a single transaction so partial imports
 * never leave orphan rows when a later chunk fails.
 */
async function batchInsertProformaLines(rows: any[]) {
  // Each row has 6 columns → 6 params; PostgreSQL limit is 65535.
  // 200 rows × 6 = 1200 params — well within limits.
  const CHUNK = 200;
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(supplierProformaLines).values(rows.slice(i, i + CHUNK));
    }
  });
}

export interface AliasConflict {
  aliasCode: string;       // the alias code that is misconfigured
  aliasedToCode: string;   // stock item the alias table points it at
  aliasedToName: string;
  ownerCode: string;       // the stock item whose OWN primary code this alias code collides with
  ownerName: string;
}

/**
 * Builds the alias-code → primary-barcode lookup used to match proforma lines
 * and loaded container items to the same underlying stock item.
 *
 * Guardrail: matching here is strictly by barcode/alias-code identity — never
 * by item name similarity. An alias row is only trusted when its aliasCode is
 * not itself the OWN primary `code` of a *different* stock item. If it is,
 * that's a data-entry conflict (one item's real barcode was mistakenly
 * registered as another item's alias), which is exactly the failure mode
 * that silently swapped two items' loaded prices in the verification report.
 * Conflicting aliases are excluded from the map (the raw code is used
 * unresolved instead) and reported back in `conflicts` so the caller can
 * surface a warning instead of producing a silently wrong comparison.
 */
export async function buildAliasMap(
  companyId: number
): Promise<{ map: Map<string, string>; conflicts: AliasConflict[] }> {
  const [aliases, allItems] = await Promise.all([
    db
      .select({
        aliasCode: stockItemCodeAliases.aliasCode,
        primaryCode: stockItems.code,
        primaryName: stockItems.name,
        primaryId: stockItems.id,
      })
      .from(stockItemCodeAliases)
      .innerJoin(stockItems, eq(stockItemCodeAliases.stockItemId, stockItems.id))
      .where(eq(stockItemCodeAliases.companyId, companyId)),
    db
      .select({ id: stockItems.id, code: stockItems.code, name: stockItems.name })
      .from(stockItems)
      .where(eq(stockItems.companyId, companyId)),
  ]);

  const ownerByCodeLower = new Map(allItems.map((i) => [i.code.trim().toLowerCase(), i]));

  const map = new Map<string, string>();
  const conflicts: AliasConflict[] = [];
  for (const a of aliases) {
    const aliasLower = a.aliasCode.trim().toLowerCase();
    const owner = ownerByCodeLower.get(aliasLower);
    if (owner && owner.id !== a.primaryId) {
      conflicts.push({
        aliasCode: a.aliasCode,
        aliasedToCode: a.primaryCode,
        aliasedToName: a.primaryName,
        ownerCode: owner.code,
        ownerName: owner.name,
      });
      continue; // do not apply — leave this barcode unresolved (matches itself)
    }
    map.set(aliasLower, a.primaryCode);
  }
  return { map, conflicts };
}

export function resolveBarcode(bc: string, aliasMap: Map<string, string>): string {
  const lower = bc.toLowerCase();
  return aliasMap.get(lower) ?? bc;
}

export function registerSupplierProformaRoutes(app: Express, requireAuth: any) {
  app.get("/api/suppliers/:supplierId/proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseId(req.params.supplierId);
      if (supplierId === null) return res.status(400).json({ message: "Invalid id" });
      const proformas = await db
        .select()
        .from(supplierProformas)
        .where(and(eq(supplierProformas.companyId, companyId), eq(supplierProformas.supplierId, supplierId)));
      res.json(proformas);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/suppliers/:supplierId/proformas/:proformaId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseId(req.params.proformaId);
      if (proformaId === null) return res.status(400).json({ message: "Invalid id" });
      const [proforma] = await db
        .select()
        .from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });
      const lines = await db
        .select()
        .from(supplierProformaLines)
        .where(eq(supplierProformaLines.proformaId, proformaId));
      res.json({ ...proforma, lines });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/suppliers/:supplierId/proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseId(req.params.supplierId);
      if (supplierId === null) return res.status(400).json({ message: "Invalid id" });
      const { reference, notes, lines } = req.body;
      const [proforma] = await db
        .insert(supplierProformas)
        .values({
          companyId,
          supplierId,
          reference: reference || "Untitled",
          notes: notes || null,
        })
        .returning();
      if (lines && Array.isArray(lines) && lines.length > 0) {
        // Resolve alias codes to primary stock-item codes so that proforma lines
        // are always stored with the canonical code regardless of what code the
        // supplier's packing-list used.
        const { map: aliasMap } = await buildAliasMap(companyId);
        const lineValues = lines.map((l: any) => ({
          proformaId: proforma.id,
          barcode: resolveBarcode(String(l.barcode || "").trim(), aliasMap),
          itemName: String(l.itemName || "").trim(),
          qty: parseInt(l.qty) || 0,
          weightPerBale: sanitizeDecimal(l.weightPerBale),
          pricePerBale: sanitizeDecimal(l.pricePerBale),
        }));
        await batchInsertProformaLines(lineValues);
      }
      const allLines = await db
        .select()
        .from(supplierProformaLines)
        .where(eq(supplierProformaLines.proformaId, proforma.id));
      await logAudit({
        userId: (req as any).session.userId!,
        username: (req as any).session.username || "unknown",
        companyId,
        action: "create",
        tableName: "supplier_proformas",
        recordId: proforma.id,
        recordIdentifier: proforma.reference || `Proforma#${proforma.id}`,
        changes: { supplierId: { old: null, new: supplierId }, reference: { old: null, new: proforma.reference } },
      });
      res.json({ ...proforma, lines: allLines });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/suppliers/:supplierId/proformas/:proformaId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseId(req.params.proformaId);
      if (proformaId === null) return res.status(400).json({ message: "Invalid id" });
      const { reference, notes } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (reference !== undefined) updates.reference = reference;
      if (notes !== undefined) updates.notes = notes;
      const [updated] = await db
        .update(supplierProformas)
        .set(updates)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Proforma not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/suppliers/:supplierId/proformas/:proformaId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseId(req.params.proformaId);
      if (proformaId === null) return res.status(400).json({ message: "Invalid id" });
      await db.delete(supplierProformaLines).where(eq(supplierProformaLines.proformaId, proformaId));
      await db
        .delete(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      await logAudit({
        userId: (req as any).session.userId!,
        username: (req as any).session.username || "unknown",
        companyId,
        action: "delete",
        tableName: "supplier_proformas",
        recordId: proformaId,
        recordIdentifier: `Proforma#${proformaId}`,
        changes: { deleted: { old: false, new: true } },
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/suppliers/:supplierId/proformas/:proformaId/lines", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseId(req.params.proformaId);
      if (proformaId === null) return res.status(400).json({ message: "Invalid id" });
      const [proforma] = await db
        .select()
        .from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(403).json({ message: "Access denied" });
      const { barcode, itemName, qty, weightPerBale, pricePerBale } = req.body;
      const [line] = await db
        .insert(supplierProformaLines)
        .values({
          proformaId,
          barcode: barcode || "",
          itemName: itemName || "",
          qty: parseInt(qty) || 0,
          weightPerBale: weightPerBale || "0",
          pricePerBale: pricePerBale || "0",
        })
        .returning();
      await db.update(supplierProformas).set({ updatedAt: new Date() }).where(eq(supplierProformas.id, proformaId));
      res.json(line);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/supplier-proforma-lines/:lineId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const lineId = parseId(req.params.lineId);
      if (lineId === null) return res.status(400).json({ message: "Invalid id" });
      const [line] = await db.select().from(supplierProformaLines).where(eq(supplierProformaLines.id, lineId));
      if (!line) return res.status(404).json({ message: "Line not found" });
      const [proforma] = await db
        .select()
        .from(supplierProformas)
        .where(and(eq(supplierProformas.id, line.proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(403).json({ message: "Access denied" });
      const updates: any = {};
      if (req.body.barcode !== undefined) updates.barcode = req.body.barcode;
      if (req.body.itemName !== undefined) updates.itemName = req.body.itemName;
      if (req.body.qty !== undefined) updates.qty = parseInt(req.body.qty) || 0;
      if (req.body.weightPerBale !== undefined) updates.weightPerBale = req.body.weightPerBale;
      if (req.body.pricePerBale !== undefined) updates.pricePerBale = req.body.pricePerBale;
      const [updated] = await db
        .update(supplierProformaLines)
        .set(updates)
        .where(eq(supplierProformaLines.id, lineId))
        .returning();
      await db.update(supplierProformas).set({ updatedAt: new Date() }).where(eq(supplierProformas.id, proforma.id));
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/supplier-proforma-lines/:lineId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const lineId = parseId(req.params.lineId);
      if (lineId === null) return res.status(400).json({ message: "Invalid id" });
      const [line] = await db.select().from(supplierProformaLines).where(eq(supplierProformaLines.id, lineId));
      if (!line) return res.status(404).json({ message: "Line not found" });
      const [proforma] = await db
        .select()
        .from(supplierProformas)
        .where(and(eq(supplierProformas.id, line.proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(403).json({ message: "Access denied" });
      await db.delete(supplierProformaLines).where(eq(supplierProformaLines.id, lineId));
      await db.update(supplierProformas).set({ updatedAt: new Date() }).where(eq(supplierProformas.id, proforma.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/suppliers/:supplierId/proformas/:proformaId/import-lines", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseId(req.params.proformaId);
      if (proformaId === null) return res.status(400).json({ message: "Invalid id" });
      const [proforma] = await db
        .select()
        .from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(403).json({ message: "Access denied" });
      const { lines } = req.body;
      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "No lines to import" });
      }
      // Resolve alias codes to primary stock-item codes at import time so that
      // items imported with different (supplier) codes are stored canonically.
      const { map: aliasMap } = await buildAliasMap(companyId);
      const lineValues = lines.map((l: any) => ({
        proformaId,
        barcode: resolveBarcode(String(l.barcode || l.Barcode || "").trim(), aliasMap),
        itemName: String(l.itemName || l["Item Name"] || "").trim(),
        qty: parseInt(l.qty ?? l.Qty ?? 0) || 0,
        weightPerBale: sanitizeDecimal(l.weightPerBale ?? l["Weight per Bale"]),
        pricePerBale: sanitizeDecimal(l.pricePerBale ?? l["Price per Bale"]),
      }));
      await batchInsertProformaLines(lineValues);
      await db.update(supplierProformas).set({ updatedAt: new Date() }).where(eq(supplierProformas.id, proformaId));
      const allLines = await db
        .select()
        .from(supplierProformaLines)
        .where(eq(supplierProformaLines.proformaId, proformaId));
      res.json({ imported: lineValues.length, lines: allLines });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const verifyContainerOwnership = async (containerId: number, companyId: number) => {
    const [container] = await db
      .select()
      .from(containers)
      .where(and(eq(containers.id, containerId), eq(containers.companyId, companyId)));
    return !!container;
  };

  app.get("/api/containers/:containerId/loaded-items", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.containerId);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      if (!(await verifyContainerOwnership(containerId, companyId)))
        return res.status(403).json({ message: "Access denied" });
      const items = await db
        .select()
        .from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.containerId, containerId));
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/containers/:containerId/loaded-items", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.containerId);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      if (!(await verifyContainerOwnership(containerId, companyId)))
        return res.status(403).json({ message: "Access denied" });
      const { barcode, itemName, qty, weightPerBale, pricePerBale } = req.body;
      // Resolve alias code → primary stock-item code before saving so that
      // items entered with supplier/alias codes match the proforma correctly.
      const { map: aliasMap } = await buildAliasMap(companyId);
      const resolvedBarcode = resolveBarcode(String(barcode ?? "").trim(), aliasMap);
      const [item] = await db
        .insert(supplierContainerLoadedItems)
        .values({
          containerId,
          barcode: resolvedBarcode,
          itemName: itemName || null,
          qty: parseInt(qty) || 0,
          weightPerBale: weightPerBale || null,
          pricePerBale: pricePerBale || null,
        })
        .returning();
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/container-loaded-items/:itemId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const itemId = parseId(req.params.itemId);
      if (itemId === null) return res.status(400).json({ message: "Invalid id" });
      const [item] = await db
        .select()
        .from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.id, itemId));
      if (!item) return res.status(404).json({ message: "Item not found" });
      if (!(await verifyContainerOwnership(item.containerId, companyId)))
        return res.status(403).json({ message: "Access denied" });
      const updates: any = {};
      if (req.body.barcode !== undefined) updates.barcode = req.body.barcode;
      if (req.body.itemName !== undefined) updates.itemName = req.body.itemName;
      if (req.body.qty !== undefined) updates.qty = parseInt(req.body.qty) || 0;
      if (req.body.weightPerBale !== undefined) updates.weightPerBale = req.body.weightPerBale;
      if (req.body.pricePerBale !== undefined) updates.pricePerBale = req.body.pricePerBale;
      const [updated] = await db
        .update(supplierContainerLoadedItems)
        .set(updates)
        .where(eq(supplierContainerLoadedItems.id, itemId))
        .returning();
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/container-loaded-items/:itemId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const itemId = parseId(req.params.itemId);
      if (itemId === null) return res.status(400).json({ message: "Invalid id" });
      const [item] = await db
        .select()
        .from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.id, itemId));
      if (!item) return res.status(404).json({ message: "Item not found" });
      if (!(await verifyContainerOwnership(item.containerId, companyId)))
        return res.status(403).json({ message: "Access denied" });
      await db.delete(supplierContainerLoadedItems).where(eq(supplierContainerLoadedItems.id, itemId));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/containers/:containerId/import-loaded-items", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.containerId);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      if (!(await verifyContainerOwnership(containerId, companyId)))
        return res.status(403).json({ message: "Access denied" });
      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items to import" });
      }
      // Resolve alias codes → primary stock-item codes before saving so that
      // items imported with different (supplier) codes match the proforma.
      const { map: aliasMap } = await buildAliasMap(companyId);
      const values = items.map((l: any) => ({
        containerId,
        barcode: resolveBarcode(String(l.barcode || l.Barcode || "").trim(), aliasMap),
        itemName: String(l.itemName || l["Item Name"] || "").trim() || null,
        qty: parseInt(l.qty || l.Qty || 0) || 0,
        weightPerBale: l.weightPerBale || l["Weight per Bale"] || null,
        pricePerBale: l.pricePerBale || l["Price per Bale"] || null,
      }));
      await db.insert(supplierContainerLoadedItems).values(values);
      const allItems = await db
        .select()
        .from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.containerId, containerId));
      res.json({ imported: values.length, items: allItems });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/containers/:containerId/auto-populate-loaded-items", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.containerId);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      if (!(await verifyContainerOwnership(containerId, companyId)))
        return res.status(403).json({ message: "Access denied" });

      const existingItems = await db
        .select()
        .from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.containerId, containerId));
      if (existingItems.length > 0) {
        return res
          .status(400)
          .json({ message: "Container already has loaded items. Clear them first to re-populate." });
      }

      const pos = await db.select().from(purchaseOrders).where(eq(purchaseOrders.containerId, containerId));

      if (pos.length === 0) {
        return res.status(400).json({ message: "No purchase orders found for this container" });
      }

      const poIds = pos.map((po) => po.id);
      const lineItems = await db
        .select({
          stockItemCode: stockItems.code,
          itemName: poLineItems.itemName,
          quantity: poLineItems.quantity,
          rate: poLineItems.rate,
          stockItemId: poLineItems.stockItemId,
        })
        .from(poLineItems)
        .leftJoin(stockItems, eq(poLineItems.stockItemId, stockItems.id))
        .where(inArray(poLineItems.poId, poIds));

      if (lineItems.length === 0) {
        return res.status(400).json({ message: "No line items found in purchase orders" });
      }

      const itemsWithBarcode = lineItems.filter((item: any) => item.stockItemCode && item.stockItemCode.trim() !== "");
      const skippedCount = lineItems.length - itemsWithBarcode.length;

      if (itemsWithBarcode.length === 0) {
        return res.status(400).json({
          message: `All ${lineItems.length} PO items are missing barcodes (stock item codes). Cannot auto-populate.`,
        });
      }

      const values = itemsWithBarcode.map((item: any) => ({
        containerId,
        barcode: item.stockItemCode.trim(),
        itemName: item.itemName || null,
        qty: Math.round(parseFloat(item.quantity || "0")),
        weightPerBale: null as string | null,
        pricePerBale: item.rate || null,
      }));

      await db.insert(supplierContainerLoadedItems).values(values);
      const allItems = await db
        .select()
        .from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.containerId, containerId));
      res.json({ imported: values.length, skipped: skippedCount, items: allItems });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get(
    "/api/suppliers/:supplierId/containers/:containerId/verification-summary",
    requireAuth,
    async (req: any, res: any) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const supplierId = parseId(req.params.supplierId);
        if (supplierId === null) return res.status(400).json({ message: "Invalid id" });
        const containerId = parseId(req.params.containerId);
        if (containerId === null) return res.status(400).json({ message: "Invalid id" });
        const proformaId = parseOptionalId(req.query.proformaId);
        if (!proformaId) return res.status(400).json({ message: "proformaId query param required" });

        if (!(await verifyContainerOwnership(containerId, companyId)))
          return res.status(403).json({ message: "Access denied" });

        const [proforma] = await db
          .select()
          .from(supplierProformas)
          .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
        if (!proforma) return res.status(404).json({ message: "Proforma not found" });

        const proformaLines = await db
          .select()
          .from(supplierProformaLines)
          .where(eq(supplierProformaLines.proformaId, proformaId));

        const loadedItems = await db
          .select()
          .from(supplierContainerLoadedItems)
          .where(eq(supplierContainerLoadedItems.containerId, containerId));

        const { map: aliasMap, conflicts: allAliasConflicts } = await buildAliasMap(companyId);

        // Only surface conflicts relevant to barcodes actually present in this
        // proforma/container pair, so unrelated stale conflicts elsewhere in
        // the company don't spam every verification screen.
        const relevantRawCodes = new Set([
          ...proformaLines.map((l) => (l.barcode || "").trim().toLowerCase()),
          ...loadedItems.map((i) => (i.barcode || "").trim().toLowerCase()),
        ]);
        const aliasConflicts = allAliasConflicts.filter((c) =>
          relevantRawCodes.has(c.aliasCode.trim().toLowerCase())
        );

        const proformaByBarcode = new Map<string, any>();
        for (const line of proformaLines) {
          const bc = resolveBarcode((line.barcode || "").trim(), aliasMap);
          if (proformaByBarcode.has(bc)) {
            const existing = proformaByBarcode.get(bc);
            existing.qty += line.qty;
          } else {
            proformaByBarcode.set(bc, {
              barcode: bc,
              itemName: line.itemName,
              qty: line.qty,
              weightPerBale: parseFloat(line.weightPerBale || "0"),
              pricePerBale: parseFloat(line.pricePerBale || "0"),
            });
          }
        }

        const loadedByBarcode = new Map<string, any>();
        for (const item of loadedItems) {
          const bc = resolveBarcode((item.barcode || "").trim(), aliasMap);
          if (loadedByBarcode.has(bc)) {
            const existing = loadedByBarcode.get(bc);
            existing.qty += item.qty;
          } else {
            loadedByBarcode.set(bc, {
              barcode: bc,
              itemName: item.itemName || "",
              qty: item.qty,
              weightPerBale: parseFloat(item.weightPerBale || "0"),
              pricePerBale: parseFloat(item.pricePerBale || "0"),
            });
          }
        }

        const allBarcodes = new Set([...proformaByBarcode.keys(), ...loadedByBarcode.keys()]);
        const comparison: any[] = [];

        for (const barcode of allBarcodes) {
          const exp = proformaByBarcode.get(barcode);
          const loaded = loadedByBarcode.get(barcode);

          const expectedQty = exp?.qty || 0;
          const loadedQty = loaded?.qty || 0;
          const expectedWeightPerBale = exp?.weightPerBale || 0;
          const loadedWeightPerBale = loaded?.weightPerBale || 0;
          const expectedPricePerBale = exp?.pricePerBale || 0;
          const loadedPricePerBale = loaded?.pricePerBale || 0;

          const expectedWeightTotal = expectedQty * expectedWeightPerBale;
          const loadedWeightTotal = loadedQty * (loadedWeightPerBale || expectedWeightPerBale);

          const expectedTotalValue = expectedQty * expectedPricePerBale;
          const loadedTotalValue = loadedQty * (loadedPricePerBale || expectedPricePerBale);

          let statusQty: string;
          if (expectedQty === 0 && loadedQty > 0) statusQty = "LOADED_NOT_IN_PROFORMA";
          else if (expectedQty > 0 && loadedQty === 0) statusQty = "MISSING_FROM_LOADED";
          else if (loadedQty > expectedQty) statusQty = "OVER_LOADED";
          else if (loadedQty < expectedQty && loadedQty > 0) statusQty = "UNDER_LOADED";
          else statusQty = "MATCH";

          let priceStatus: string;
          const priceDiffPerBale = loadedPricePerBale - expectedPricePerBale;
          if (!expectedPricePerBale || !loadedPricePerBale) priceStatus = "PRICE_UNKNOWN";
          else if (Math.abs(priceDiffPerBale) < 0.01) priceStatus = "PRICE_MATCH";
          else priceStatus = "PRICE_DIFF";

          const totalPriceDiff = priceDiffPerBale * loadedQty;

          comparison.push({
            barcode,
            itemName: exp?.itemName || loaded?.itemName || barcode,
            expectedQty,
            loadedQty,
            expectedWeightPerBale,
            loadedWeightPerBale,
            expectedWeightTotal,
            loadedWeightTotal,
            expectedPricePerBale,
            loadedPricePerBale,
            expectedTotalValue,
            loadedTotalValue,
            statusQty,
            priceStatus,
            priceDiffPerBale,
            totalPriceDiff,
          });
        }

        res.json({
          proforma: { id: proforma.id, reference: proforma.reference },
          containerId,
          supplierId,
          comparison,
          proformaLines,
          loadedItems,
          aliasConflicts,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.get(
    "/api/suppliers/:supplierId/containers/:containerId/verification-export.xlsx",
    requireAuth,
    async (req: any, res: any) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const supplierId = parseId(req.params.supplierId);
        if (supplierId === null) return res.status(400).json({ message: "Invalid id" });
        const containerId = parseId(req.params.containerId);
        if (containerId === null) return res.status(400).json({ message: "Invalid id" });
        const proformaId = parseOptionalId(req.query.proformaId);
        if (!proformaId) return res.status(400).json({ message: "proformaId required" });

        if (!(await verifyContainerOwnership(containerId, companyId)))
          return res.status(403).json({ message: "Access denied" });

        const [proforma] = await db
          .select()
          .from(supplierProformas)
          .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
        if (!proforma) return res.status(404).json({ message: "Proforma not found" });

        const [container] = await db.select().from(containers).where(eq(containers.id, containerId));
        const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));

        const proformaLinesList = await db
          .select()
          .from(supplierProformaLines)
          .where(eq(supplierProformaLines.proformaId, proformaId));
        const loadedItemsList = await db
          .select()
          .from(supplierContainerLoadedItems)
          .where(eq(supplierContainerLoadedItems.containerId, containerId));

        const { map: aliasMap } = await buildAliasMap(companyId);

        const proformaByBarcode = new Map<string, any>();
        for (const line of proformaLinesList) {
          const bc = resolveBarcode((line.barcode || "").trim(), aliasMap);
          if (proformaByBarcode.has(bc)) {
            proformaByBarcode.get(bc).qty += line.qty;
          } else {
            proformaByBarcode.set(bc, {
              ...line,
              qty: line.qty,
              weightPerBale: parseFloat(line.weightPerBale || "0"),
              pricePerBale: parseFloat(line.pricePerBale || "0"),
            });
          }
        }
        const loadedByBarcode = new Map<string, any>();
        for (const item of loadedItemsList) {
          const bc = resolveBarcode((item.barcode || "").trim(), aliasMap);
          if (loadedByBarcode.has(bc)) {
            loadedByBarcode.get(bc).qty += item.qty;
          } else {
            loadedByBarcode.set(bc, {
              ...item,
              qty: item.qty,
              weightPerBale: parseFloat(item.weightPerBale || "0"),
              pricePerBale: parseFloat(item.pricePerBale || "0"),
            });
          }
        }

        const allBarcodes = new Set([...proformaByBarcode.keys(), ...loadedByBarcode.keys()]);
        const overloaded: any[] = [];
        const lessLoaded: any[] = [];
        const notRequested: any[] = [];
        const priceDiffs: any[] = [];
        const fullComparison: any[] = [];

        for (const barcode of allBarcodes) {
          const exp = proformaByBarcode.get(barcode);
          const loaded = loadedByBarcode.get(barcode);
          const expectedQty = exp?.qty || 0;
          const loadedQty = loaded?.qty || 0;
          const expPrice = exp?.pricePerBale || 0;
          const loadPrice = loaded?.pricePerBale || 0;
          const expWeight = exp?.weightPerBale || 0;
          const loadWeight = loaded?.weightPerBale || expWeight;
          const itemName = exp?.itemName || loaded?.itemName || barcode;
          const loadedWeightTotal = loadedQty * loadWeight;
          const expectedWeightTotal = expectedQty * expWeight;
          const loadedValueTotal = loadedQty * (loadPrice || expPrice);
          const expectedValueTotal = expectedQty * expPrice;
          const qtyDiff = loadedQty - expectedQty;

          let status = "OK";
          if (expectedQty === 0 && loadedQty > 0) status = "NOT REQUESTED";
          else if (expectedQty > 0 && loadedQty === 0) status = "MISSING";
          else if (loadedQty > expectedQty) status = "OVERLOADED";
          else if (loadedQty < expectedQty) status = "SHORT";

          fullComparison.push({
            barcode,
            itemName,
            expectedQty,
            loadedQty,
            qtyDiff,
            expPrice,
            loadPrice,
            priceDiff: loadPrice - expPrice,
            expWeight,
            loadWeight,
            expectedWeightTotal,
            loadedWeightTotal,
            expectedValueTotal,
            loadedValueTotal,
            status,
          });

          if (expectedQty === 0 && loadedQty > 0) {
            notRequested.push({
              barcode,
              itemName,
              qty: loadedQty,
              totalWeight: loadedWeightTotal,
              totalValue: loadedValueTotal,
            });
          } else if (loadedQty > expectedQty) {
            overloaded.push({
              barcode,
              itemName,
              qty: loadedQty,
              expectedQty,
              excess: loadedQty - expectedQty,
              totalWeight: loadedWeightTotal,
              totalValue: loadedValueTotal,
            });
          } else if (loadedQty < expectedQty) {
            lessLoaded.push({
              barcode,
              itemName,
              qty: loadedQty,
              expectedQty,
              short: expectedQty - loadedQty,
              totalWeight: loadedWeightTotal,
              totalValue: loadedValueTotal,
            });
          }
          if (expPrice && loadPrice && Math.abs(loadPrice - expPrice) >= 0.01) {
            priceDiffs.push({
              barcode,
              itemName,
              proformaPrice: expPrice,
              loadedPrice: loadPrice,
              diff: loadPrice - expPrice,
              qty: loadedQty,
              totalDiff: (loadPrice - expPrice) * loadedQty,
            });
          }
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "ERP POS System";
        workbook.created = new Date();

        const colors = {
          headerBg: "1F4E79",
          headerFont: "FFFFFF",
          overloadedBg: "FCE4EC",
          overloadedBorder: "C62828",
          shortBg: "FFF3E0",
          shortBorder: "E65100",
          notRequestedBg: "FFF9C4",
          notRequestedBorder: "F57F17",
          priceDiffBg: "E3F2FD",
          priceDiffBorder: "1565C0",
          okBg: "E8F5E9",
          summaryBg: "F5F5F5",
          titleBg: "263238",
          titleFont: "FFFFFF",
        };

        const thinBorder: any = {
          top: { style: "thin", color: { argb: "BDBDBD" } },
          left: { style: "thin", color: { argb: "BDBDBD" } },
          bottom: { style: "thin", color: { argb: "BDBDBD" } },
          right: { style: "thin", color: { argb: "BDBDBD" } },
        };

        const addStyledSheet = (
          name: string,
          sectionTitle: string,
          sectionColor: string,
          columns: { header: string; key: string; width: number; numFmt?: string }[],
          data: any[],
          statusColorFn?: (row: any) => string | null
        ) => {
          const sheet = workbook.addWorksheet(name);

          const titleRow = sheet.addRow([`${sectionTitle}`]);
          titleRow.font = { bold: true, size: 14, color: { argb: colors.titleFont } };
          titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.titleBg } };
          titleRow.height = 30;
          titleRow.alignment = { vertical: "middle", horizontal: "left" };
          sheet.mergeCells(1, 1, 1, columns.length);

          const infoData = [
            ["Supplier", supplier?.legalName || `ID ${supplierId}`],
            ["Container", container?.containerNumber || `ID ${containerId}`],
            ["Proforma", proforma.reference],
            ["Date", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })],
            ["Total Items", String(data.length)],
          ];
          for (const [label, value] of infoData) {
            const r = sheet.addRow([label, value]);
            r.getCell(1).font = { bold: true, size: 10, color: { argb: "616161" } };
            r.getCell(2).font = { size: 10 };
          }
          sheet.addRow([]);

          const headerRowNum = sheet.rowCount + 1;
          const headerRow = sheet.addRow(columns.map((c) => c.header));
          headerRow.height = 24;
          headerRow.eachCell((cell: any) => {
            cell.font = { bold: true, size: 10, color: { argb: colors.headerFont } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectionColor } };
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
            cell.border = thinBorder;
          });

          columns.forEach((col, i) => {
            sheet.getColumn(i + 1).width = col.width;
            if (col.numFmt) sheet.getColumn(i + 1).numFmt = col.numFmt;
          });

          if (data.length === 0) {
            const emptyRow = sheet.addRow(["No items"]);
            sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, columns.length);
            emptyRow.getCell(1).alignment = { horizontal: "center" };
            emptyRow.getCell(1).font = { italic: true, color: { argb: "9E9E9E" } };
          } else {
            for (let i = 0; i < data.length; i++) {
              const item = data[i];
              const values = columns.map((c) => item[c.key]);
              const dataRow = sheet.addRow(values);
              const rowBg = statusColorFn ? statusColorFn(item) : i % 2 === 0 ? null : "F5F5F5";
              dataRow.eachCell((cell: any) => {
                cell.border = thinBorder;
                cell.alignment = { vertical: "middle" };
                if (rowBg) {
                  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
                }
              });
            }

            sheet.addRow([]);
            const totalRow = sheet.addRow([
              "TOTAL",
              "",
              ...columns.slice(2).map((c) => {
                const sum = data.reduce(
                  (s: number, item: any) => s + (typeof item[c.key] === "number" ? item[c.key] : 0),
                  0
                );
                return sum;
              }),
            ]);
            totalRow.font = { bold: true, size: 10 };
            totalRow.eachCell((cell: any) => {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.summaryBg } };
              cell.border = {
                top: { style: "double", color: { argb: "424242" } },
                bottom: { style: "double", color: { argb: "424242" } },
                left: thinBorder.left,
                right: thinBorder.right,
              };
            });
          }

          sheet.autoFilter = {
            from: { row: headerRowNum, column: 1 },
            to: { row: headerRowNum, column: columns.length },
          };
          return sheet;
        };

        addStyledSheet(
          "Full Comparison",
          "Container Verification - Full Comparison",
          colors.headerBg,
          [
            { header: "Barcode", key: "barcode", width: 18 },
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Expected Qty", key: "expectedQty", width: 14, numFmt: "#,##0" },
            { header: "Loaded Qty", key: "loadedQty", width: 14, numFmt: "#,##0" },
            { header: "Qty Diff", key: "qtyDiff", width: 12, numFmt: "+#,##0;-#,##0;0" },
            { header: "Proforma Price", key: "expPrice", width: 14, numFmt: "#,##0.00" },
            { header: "Loaded Price", key: "loadPrice", width: 14, numFmt: "#,##0.00" },
            { header: "Price Diff", key: "priceDiff", width: 12, numFmt: "+#,##0.00;-#,##0.00;0" },
            { header: "Status", key: "status", width: 16 },
          ],
          fullComparison,
          (item: any) => {
            if (item.status === "OVERLOADED") return colors.overloadedBg;
            if (item.status === "SHORT" || item.status === "MISSING") return colors.shortBg;
            if (item.status === "NOT REQUESTED") return colors.notRequestedBg;
            return null;
          }
        );

        addStyledSheet(
          "Overloaded",
          `Overloaded Items (${overloaded.length})`,
          colors.overloadedBorder,
          [
            { header: "Barcode", key: "barcode", width: 18 },
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Expected Qty", key: "expectedQty", width: 14, numFmt: "#,##0" },
            { header: "Loaded Qty", key: "qty", width: 14, numFmt: "#,##0" },
            { header: "Excess", key: "excess", width: 12, numFmt: "#,##0" },
            { header: "Total Weight", key: "totalWeight", width: 14, numFmt: "#,##0.000" },
            { header: "Total Value", key: "totalValue", width: 14, numFmt: "#,##0.00" },
          ],
          overloaded
        );

        addStyledSheet(
          "Less Loaded",
          `Less Loaded / Missing (${lessLoaded.length})`,
          colors.shortBorder,
          [
            { header: "Barcode", key: "barcode", width: 18 },
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Expected Qty", key: "expectedQty", width: 14, numFmt: "#,##0" },
            { header: "Loaded Qty", key: "qty", width: 14, numFmt: "#,##0" },
            { header: "Short", key: "short", width: 12, numFmt: "#,##0" },
            { header: "Total Weight", key: "totalWeight", width: 14, numFmt: "#,##0.000" },
            { header: "Total Value", key: "totalValue", width: 14, numFmt: "#,##0.00" },
          ],
          lessLoaded
        );

        addStyledSheet(
          "Not Requested",
          `Loaded But Not Requested (${notRequested.length})`,
          colors.notRequestedBorder,
          [
            { header: "Barcode", key: "barcode", width: 18 },
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Qty", key: "qty", width: 14, numFmt: "#,##0" },
            { header: "Total Weight", key: "totalWeight", width: 14, numFmt: "#,##0.000" },
            { header: "Total Value", key: "totalValue", width: 14, numFmt: "#,##0.00" },
          ],
          notRequested
        );

        addStyledSheet(
          "Price Differences",
          `Price Differences (${priceDiffs.length})`,
          colors.priceDiffBorder,
          [
            { header: "Barcode", key: "barcode", width: 18 },
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Proforma Price", key: "proformaPrice", width: 14, numFmt: "#,##0.00" },
            { header: "Loaded Price", key: "loadedPrice", width: 14, numFmt: "#,##0.00" },
            { header: "Diff/Bale", key: "diff", width: 12, numFmt: "+#,##0.00;-#,##0.00;0" },
            { header: "Qty", key: "qty", width: 10, numFmt: "#,##0" },
            { header: "Total Diff", key: "totalDiff", width: 14, numFmt: "+#,##0.00;-#,##0.00;0" },
          ],
          priceDiffs
        );

        const summarySheet = workbook.addWorksheet("Summary");
        const sumTitleRow = summarySheet.addRow(["Verification Summary"]);
        sumTitleRow.font = { bold: true, size: 16, color: { argb: colors.titleFont } };
        sumTitleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.titleBg } };
        sumTitleRow.height = 36;
        sumTitleRow.alignment = { vertical: "middle", horizontal: "center" };
        summarySheet.mergeCells(1, 1, 1, 3);

        summarySheet.addRow([]);
        const infoRows = [
          ["Supplier", supplier?.legalName || ""],
          ["Container", container?.containerNumber || ""],
          ["Proforma", proforma.reference],
          ["Date", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })],
        ];
        for (const [label, value] of infoRows) {
          const r = summarySheet.addRow([label, value]);
          r.getCell(1).font = { bold: true, size: 11 };
          r.getCell(2).font = { size: 11 };
        }
        summarySheet.addRow([]);

        const summaryData = [
          ["Category", "Count", "Color"],
          ["Total Items Compared", fullComparison.length, colors.headerBg],
          ["Overloaded", overloaded.length, colors.overloadedBorder],
          ["Less Loaded / Missing", lessLoaded.length, colors.shortBorder],
          ["Not Requested", notRequested.length, colors.notRequestedBorder],
          ["Price Differences", priceDiffs.length, colors.priceDiffBorder],
          ["OK (Matched)", fullComparison.filter((c) => c.status === "OK").length, "2E7D32"],
        ];

        const sumHeaderRow = summarySheet.addRow([summaryData[0][0], summaryData[0][1]]);
        sumHeaderRow.eachCell((cell: any) => {
          cell.font = { bold: true, size: 11, color: { argb: colors.headerFont } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.headerBg } };
          cell.border = thinBorder;
          cell.alignment = { horizontal: "center" };
        });

        for (let i = 1; i < summaryData.length; i++) {
          const [label, count, color] = summaryData[i];
          const r = summarySheet.addRow([label, count]);
          r.getCell(1).font = { bold: true, size: 11 };
          r.getCell(1).border = thinBorder;
          r.getCell(2).font = { bold: true, size: 14, color: { argb: color as string } };
          r.getCell(2).alignment = { horizontal: "center" };
          r.getCell(2).border = thinBorder;
          r.height = 22;
        }

        summarySheet.getColumn(1).width = 28;
        summarySheet.getColumn(2).width = 18;

        workbook.worksheets.forEach((ws: any, idx: number) => {
          if (idx > 0) return;
        });

        const safeSupplier = (supplier?.legalName || "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
        const safeContainer = (container?.containerNumber || String(containerId)).replace(/[^a-zA-Z0-9]/g, "");
        const fileName = `Verification ${safeSupplier} ${safeContainer}.xlsx`;
        const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Length", xlsBuffer.byteLength);
        res.end(xlsBuffer);
      } catch (error: any) {
        console.error("Export error:", error);
        if (!res.headersSent) res.status(500).json({ message: error.message });
      }
    }
  );

  app.get(
    "/api/suppliers/:supplierId/containers/:containerId/verification-summary-export.xlsx",
    requireAuth,
    async (req: any, res: any) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const supplierId = parseId(req.params.supplierId);
        if (supplierId === null) return res.status(400).json({ message: "Invalid id" });
        const containerId = parseId(req.params.containerId);
        if (containerId === null) return res.status(400).json({ message: "Invalid id" });
        const proformaId = parseOptionalId(req.query.proformaId);
        if (!proformaId) return res.status(400).json({ message: "proformaId required" });

        if (!(await verifyContainerOwnership(containerId, companyId)))
          return res.status(403).json({ message: "Access denied" });

        const [proforma] = await db
          .select()
          .from(supplierProformas)
          .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
        if (!proforma) return res.status(404).json({ message: "Proforma not found" });

        const [container] = await db.select().from(containers).where(eq(containers.id, containerId));
        const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));

        const proformaLinesList = await db
          .select()
          .from(supplierProformaLines)
          .where(eq(supplierProformaLines.proformaId, proformaId));
        const loadedItemsList = await db
          .select()
          .from(supplierContainerLoadedItems)
          .where(eq(supplierContainerLoadedItems.containerId, containerId));

        const { map: aliasMap } = await buildAliasMap(companyId);

        const proformaByBarcode = new Map<string, any>();
        for (const line of proformaLinesList) {
          const bc = resolveBarcode((line.barcode || "").trim(), aliasMap);
          if (proformaByBarcode.has(bc)) {
            proformaByBarcode.get(bc).qty += line.qty;
          } else {
            proformaByBarcode.set(bc, {
              ...line,
              qty: line.qty,
              weightPerBale: parseFloat(line.weightPerBale || "0"),
              pricePerBale: parseFloat(line.pricePerBale || "0"),
            });
          }
        }
        const loadedByBarcode = new Map<string, any>();
        for (const item of loadedItemsList) {
          const bc = resolveBarcode((item.barcode || "").trim(), aliasMap);
          if (loadedByBarcode.has(bc)) {
            loadedByBarcode.get(bc).qty += item.qty;
          } else {
            loadedByBarcode.set(bc, {
              ...item,
              qty: item.qty,
              weightPerBale: parseFloat(item.weightPerBale || "0"),
              pricePerBale: parseFloat(item.pricePerBale || "0"),
            });
          }
        }

        const allBarcodes = new Set([...proformaByBarcode.keys(), ...loadedByBarcode.keys()]);
        const overloaded: any[] = [];
        const lessLoaded: any[] = [];
        const notRequested: any[] = [];
        const priceDiffs: any[] = [];
        const fullComparison: any[] = [];

        for (const barcode of allBarcodes) {
          const exp = proformaByBarcode.get(barcode);
          const loaded = loadedByBarcode.get(barcode);
          const expectedQty = exp?.qty || 0;
          const loadedQty = loaded?.qty || 0;
          const expPrice = exp?.pricePerBale || 0;
          const loadPrice = loaded?.pricePerBale || 0;
          const expWeight = exp?.weightPerBale || 0;
          const loadWeight = loaded?.weightPerBale || expWeight;
          const itemName = exp?.itemName || loaded?.itemName || barcode;
          const loadedWeightTotal = loadedQty * loadWeight;
          const expectedWeightTotal = expectedQty * expWeight;
          const loadedValueTotal = loadedQty * (loadPrice || expPrice);
          const expectedValueTotal = expectedQty * expPrice;
          const qtyDiff = loadedQty - expectedQty;

          let status = "OK";
          if (expectedQty === 0 && loadedQty > 0) status = "NOT REQUESTED";
          else if (expectedQty > 0 && loadedQty === 0) status = "MISSING";
          else if (loadedQty > expectedQty) status = "OVERLOADED";
          else if (loadedQty < expectedQty) status = "SHORT";

          fullComparison.push({
            barcode,
            itemName,
            expectedQty,
            loadedQty,
            qtyDiff,
            expPrice,
            loadPrice,
            priceDiff: loadPrice - expPrice,
            expWeight,
            loadWeight,
            expectedWeightTotal,
            loadedWeightTotal,
            expectedValueTotal,
            loadedValueTotal,
            status,
          });

          if (expectedQty === 0 && loadedQty > 0) {
            notRequested.push({ itemName, qty: loadedQty });
          } else if (loadedQty > expectedQty) {
            overloaded.push({ itemName, qty: loadedQty });
          } else if (loadedQty < expectedQty) {
            lessLoaded.push({ itemName, qty: -(expectedQty - loadedQty) });
          }
          if (expPrice && loadPrice && Math.abs(loadPrice - expPrice) >= 0.01) {
            const kgDiff =
              expWeight && loadWeight && Math.abs(loadWeight - expWeight) >= 0.001 ? loadWeight - expWeight : null;
            priceDiffs.push({ itemName, kgDiff, itemPriceDiff: loadPrice - expPrice });
          }
        }

        const wb = new ExcelJS.Workbook();
        wb.creator = "ERP POS System";
        wb.created = new Date();
        const sheet = wb.addWorksheet("Comparison");

        const sc = {
          headerBg: "1F4E79",
          headerFont: "FFFFFF",
          overloadedBg: "FCE4EC",
          shortBg: "FFF3E0",
          notRequestedBg: "FFF9C4",
          overloadedBorder: "C62828",
          shortBorder: "E65100",
          notRequestedBorder: "F57F17",
          priceDiffBorder: "1565C0",
          titleBg: "263238",
          titleFont: "FFFFFF",
          summaryBg: "F5F5F5",
        };
        const sThin: any = {
          top: { style: "thin", color: { argb: "BDBDBD" } },
          left: { style: "thin", color: { argb: "BDBDBD" } },
          bottom: { style: "thin", color: { argb: "BDBDBD" } },
          right: { style: "thin", color: { argb: "BDBDBD" } },
        };
        const dblBorder: any = {
          top: { style: "double", color: { argb: "424242" } },
          bottom: { style: "double", color: { argb: "424242" } },
          left: sThin.left,
          right: sThin.right,
        };

        type ColDef = { header: string; key: string; width: number; numFmt?: string };

        const addBlock = (
          title: string,
          sectionColor: string,
          columns: ColDef[],
          data: any[],
          statusColorFn?: (row: any) => string | null,
          includeAutoFilter = false
        ) => {
          const numCols = columns.length;

          const titleRow = sheet.addRow([title]);
          titleRow.height = 30;
          titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: sc.titleFont } };
          titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: sc.titleBg } };
          titleRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
          if (numCols > 1) sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, numCols);

          const infoData: [string, string][] = [
            ["Supplier", supplier?.legalName || `ID ${supplierId}`],
            ["Container", container?.containerNumber || `ID ${containerId}`],
            ["Proforma", proforma.reference],
            ["Date", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })],
            ["Total Items", String(data.length)],
          ];
          for (const [label, value] of infoData) {
            const r = sheet.addRow([label, value]);
            r.getCell(1).font = { bold: true, size: 10, color: { argb: "616161" } };
            r.getCell(2).font = { size: 10 };
          }
          sheet.addRow([]);

          const headerRowNum = sheet.rowCount + 1;
          const headerRow = sheet.addRow(columns.map((c) => c.header));
          headerRow.height = 24;
          headerRow.eachCell((cell: any) => {
            cell.font = { bold: true, size: 10, color: { argb: sc.headerFont } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectionColor } };
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
            cell.border = sThin;
          });

          columns.forEach((col, i) => {
            const c = sheet.getColumn(i + 1);
            if (!c.width || (c.width as number) < col.width) c.width = col.width;
            if (col.numFmt) c.numFmt = col.numFmt;
          });

          if (data.length === 0) {
            const emptyRow = sheet.addRow(["No items"]);
            if (numCols > 1) sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, numCols);
            emptyRow.getCell(1).alignment = { horizontal: "center" };
            emptyRow.getCell(1).font = { italic: true, color: { argb: "9E9E9E" } };
          } else {
            for (let i = 0; i < data.length; i++) {
              const item = data[i];
              const values = columns.map((c) => item[c.key]);
              const dataRow = sheet.addRow(values);
              const rowBg = statusColorFn ? statusColorFn(item) : i % 2 !== 0 ? sc.summaryBg : null;
              dataRow.eachCell((cell: any) => {
                cell.border = sThin;
                cell.alignment = { vertical: "middle" };
                if (rowBg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
              });
            }

            sheet.addRow([]);
            const totalValues = columns.map((c, i) => {
              if (i === 0) return "TOTAL";
              const sum = data.reduce(
                (s: number, item: any) => s + (typeof item[c.key] === "number" ? item[c.key] : 0),
                0
              );
              return typeof data[0]?.[c.key] === "number" ? sum : "";
            });
            const totalRow = sheet.addRow(totalValues);
            totalRow.font = { bold: true, size: 10 };
            totalRow.eachCell((cell: any, colN: number) => {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sc.summaryBg } };
              cell.border = dblBorder;
              const col = columns[colN - 1];
              if (col?.numFmt) cell.numFmt = col.numFmt;
            });
          }

          if (includeAutoFilter) {
            sheet.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: numCols } };
          }
          sheet.addRow([]);
        };

        addBlock(
          "Container Verification - Full Comparison",
          sc.headerBg,
          [
            { header: "Barcode", key: "barcode", width: 18 },
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Expected Qty", key: "expectedQty", width: 14, numFmt: "#,##0" },
            { header: "Loaded Qty", key: "loadedQty", width: 14, numFmt: "#,##0" },
            { header: "Qty Diff", key: "qtyDiff", width: 12, numFmt: "+#,##0;-#,##0;0" },
            { header: "Proforma Price", key: "expPrice", width: 14, numFmt: "#,##0.00" },
            { header: "Loaded Price", key: "loadPrice", width: 14, numFmt: "#,##0.00" },
            { header: "Price Diff", key: "priceDiff", width: 12, numFmt: "+#,##0.00;-#,##0.00;0" },
            { header: "Status", key: "status", width: 16 },
          ],
          fullComparison,
          (item: any) => {
            if (item.status === "OVERLOADED") return sc.overloadedBg;
            if (item.status === "SHORT" || item.status === "MISSING") return sc.shortBg;
            if (item.status === "NOT REQUESTED") return sc.notRequestedBg;
            return null;
          },
          true
        );

        addBlock(
          "Less Loaded",
          sc.shortBorder,
          [
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Qty", key: "qty", width: 14, numFmt: "#,##0" },
          ],
          lessLoaded
        );

        addBlock(
          "Over Loaded",
          sc.overloadedBorder,
          [
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Qty", key: "qty", width: 14, numFmt: "#,##0" },
          ],
          overloaded
        );

        addBlock(
          "Loaded Not Requested",
          sc.notRequestedBorder,
          [
            { header: "Item Name", key: "itemName", width: 28 },
            { header: "Qty", key: "qty", width: 14, numFmt: "#,##0" },
          ],
          notRequested
        );

        const hasKgDiff = priceDiffs.some((r) => r.kgDiff != null);
        const priceDiffCols: ColDef[] = hasKgDiff
          ? [
              { header: "Item Name", key: "itemName", width: 28 },
              { header: "KG Diff", key: "kgDiff", width: 14, numFmt: "#,##0.00" },
              { header: "Item Price Diff", key: "itemPriceDiff", width: 16, numFmt: "#,##0.00" },
            ]
          : [
              { header: "Item Name", key: "itemName", width: 28 },
              { header: "Item Price Diff", key: "itemPriceDiff", width: 16, numFmt: "#,##0.00" },
            ];
        addBlock("Price Diff", sc.priceDiffBorder, priceDiffCols, priceDiffs);

        const safeSupplierS = (supplier?.legalName || "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
        const safeContainerS = (container?.containerNumber || String(containerId)).replace(/[^a-zA-Z0-9]/g, "");
        const summaryFileName = `Verification Summary ${safeSupplierS} ${safeContainerS}.xlsx`;
        const xlsBuffer2 = Buffer.from(await wb.xlsx.writeBuffer());
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${summaryFileName}"`);
        res.setHeader("Content-Length", xlsBuffer2.byteLength);
        res.end(xlsBuffer2);
      } catch (error: any) {
        console.error("Summary export error:", error);
        if (!res.headersSent) res.status(500).json({ message: error.message });
      }
    }
  );

  // ── Pretty Excel export for a single proforma ──────────────────────────────
  app.get("/api/suppliers/:supplierId/proformas/:proformaId/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseId(req.params.proformaId);
      const sid = parseId(req.params.supplierId);
      if (!proformaId || !sid) return res.status(400).json({ message: "Invalid id" });

      const [proforma] = await db
        .select()
        .from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const lines = await db
        .select()
        .from(supplierProformaLines)
        .where(eq(supplierProformaLines.proformaId, proformaId));
      const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, sid));

      // ── Workbook ───────────────────────────────────────────────────────────
      const wb = new ExcelJS.Workbook();
      wb.creator = "HMD ERP";
      wb.created = new Date();

      const ws = wb.addWorksheet("Proforma", {
        pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });

      // 8 columns: #, Barcode, Item Name, Qty, Weight/Bale, Price/Bale, Total Weight, Total Value
      const NUM_COLS = 8;
      ws.columns = [
        { width: 5 }, // #
        { width: 16 }, // Barcode
        { width: 34 }, // Item Name
        { width: 10 }, // Qty
        { width: 14 }, // Weight/Bale (kg)
        { width: 14 }, // Price/Bale
        { width: 16 }, // Total Weight
        { width: 16 }, // Total Value
      ];

      // Colour palette
      const C = {
        navy: "FF0D1F3C",
        blue: "FF1A4A8A",
        blueMid: "FF2563B0",
        headerText: "FFFFFFFF",
        altRow: "FFD6E4F7",
        whiteRow: "FFFFFFFF",
        totalBg: "FF0F3422",
        totalText: "FFFFFFFF",
        subtleBg: "FFEEF4FC",
        notesBg: "FFFFF8E6",
        colLabel: "FFBBCFE8",
        borderCol: "FFB0C4DE",
      };

      const thin = (c = C.borderCol) => ({ style: "thin" as const, color: { argb: c } });
      const medium = (c = C.navy) => ({ style: "medium" as const, color: { argb: c } });
      const allBorder = (t = thin(), m?: any) => ({
        top: m ?? t,
        bottom: m ?? t,
        left: t,
        right: t,
      });

      // ── Row 1 — title banner ───────────────────────────────────────────────
      ws.mergeCells(1, 1, 1, NUM_COLS);
      const r1 = ws.getRow(1);
      r1.height = 40;
      const t1 = ws.getCell("A1");
      t1.value = "SUPPLIER PROFORMA";
      t1.font = { bold: true, size: 18, color: { argb: C.headerText }, name: "Calibri" };
      t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
      t1.alignment = { horizontal: "center", vertical: "middle" };

      // ── Row 2 — supplier | reference ──────────────────────────────────────
      ws.mergeCells(2, 1, 2, 4);
      ws.mergeCells(2, 5, 2, NUM_COLS);
      ws.getRow(2).height = 24;
      const suppCell = ws.getCell(2, 1);
      suppCell.value = `Supplier: ${supplier?.legalName || `#${sid}`}`;
      suppCell.font = { bold: true, size: 11, color: { argb: C.navy } };
      suppCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.subtleBg } };
      suppCell.alignment = { vertical: "middle", indent: 1 };
      const refCell = ws.getCell(2, 5);
      refCell.value = `Reference: ${proforma.reference}`;
      refCell.font = { bold: true, size: 11, color: { argb: C.navy } };
      refCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.subtleBg } };
      refCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };

      // ── Row 3 — date | item count ─────────────────────────────────────────
      ws.mergeCells(3, 1, 3, 4);
      ws.mergeCells(3, 5, 3, NUM_COLS);
      ws.getRow(3).height = 18;
      const dateStr = new Date(proforma.createdAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
      const dateCell = ws.getCell(3, 1);
      dateCell.value = `Date: ${dateStr}`;
      dateCell.font = { size: 9, italic: true, color: { argb: "FF555566" } };
      dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F8FE" } };
      dateCell.alignment = { vertical: "middle", indent: 1 };
      const cntCell = ws.getCell(3, 5);
      cntCell.value = `${lines.length} line items`;
      cntCell.font = { size: 9, italic: true, color: { argb: "FF555566" } };
      cntCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F8FE" } };
      cntCell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };

      // ── Row 4 — notes (optional) ──────────────────────────────────────────
      let nextRowIdx = 4;
      if (proforma.notes) {
        ws.mergeCells(4, 1, 4, NUM_COLS);
        ws.getRow(4).height = 18;
        const nc = ws.getCell(4, 1);
        nc.value = `Notes: ${proforma.notes}`;
        nc.font = { size: 9, italic: true, color: { argb: "FF444444" } };
        nc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.notesBg } };
        nc.alignment = { vertical: "middle", indent: 1, wrapText: true };
        nextRowIdx = 5;
      }

      // ── Blank spacer ──────────────────────────────────────────────────────
      ws.getRow(nextRowIdx).height = 8;
      nextRowIdx++;

      // ── Column header row ─────────────────────────────────────────────────
      const hdrRowNum = nextRowIdx;
      const headers = [
        "#",
        "Barcode",
        "Item Name",
        "Qty",
        "Wt / Bale (kg)",
        "Price / Bale",
        "Total Weight",
        "Total Value",
      ];
      const hdrRow = ws.getRow(hdrRowNum);
      hdrRow.values = headers;
      hdrRow.height = 30;
      hdrRow.eachCell((cell: any, col: number) => {
        cell.font = { bold: true, size: 10, color: { argb: C.headerText } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blueMid } };
        cell.alignment = {
          horizontal: col <= 3 ? "left" : "right",
          vertical: "middle",
          indent: col === 1 ? 0 : 1,
        };
        cell.border = {
          top: medium(),
          bottom: medium(),
          left: thin(),
          right: thin(),
        };
      });
      nextRowIdx++;

      // ── Data rows ─────────────────────────────────────────────────────────
      let totQty = 0,
        totWeightKg = 0,
        totValue = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const qty = Number(line.qty) || 0;
        const wt = parseFloat(line.weightPerBale || "0");
        const price = parseFloat(line.pricePerBale || "0");
        const lineWt = qty * wt;
        const lineVal = qty * price;
        totQty += qty;
        totWeightKg += lineWt;
        totValue += lineVal;

        const row = ws.getRow(nextRowIdx);
        row.values = [i + 1, line.barcode, line.itemName, qty, wt, price, lineWt, lineVal];
        row.height = 20;

        const isAlt = i % 2 === 1;
        const rowBg = isAlt ? C.altRow : C.whiteRow;

        row.eachCell((cell: any, col: number) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
          cell.border = allBorder();
          cell.alignment = {
            horizontal: col <= 3 ? "left" : "right",
            vertical: "middle",
            indent: col === 1 ? 0 : 1,
          };
          if (col === 1) {
            cell.font = { size: 9, color: { argb: "FF8899AA" } };
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }
          if (col === 2) {
            cell.font = { name: "Courier New", size: 9 };
          }
          if (col === 4) cell.numFmt = "#,##0";
          if (col === 5) cell.numFmt = "#,##0.##";
          if (col === 6) cell.numFmt = "#,##0.00";
          if (col === 7) cell.numFmt = "#,##0.##";
          if (col === 8) cell.numFmt = "#,##0.00";
        });

        nextRowIdx++;
      }

      // ── Total row ─────────────────────────────────────────────────────────
      const totalRow = ws.getRow(nextRowIdx);
      totalRow.values = ["", "", "TOTAL", totQty, "", "", totWeightKg, totValue];
      totalRow.height = 28;
      totalRow.eachCell((cell: any, col: number) => {
        cell.font = { bold: true, size: 11, color: { argb: C.totalText } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.totalBg } };
        cell.border = { top: medium(), bottom: medium(), left: thin(), right: thin() };
        cell.alignment = {
          horizontal: col <= 3 ? (col === 3 ? "left" : "center") : "right",
          vertical: "middle",
          indent: col === 3 ? 1 : 0,
        };
        if (col === 4) cell.numFmt = "#,##0";
        if (col === 7) cell.numFmt = "#,##0.##";
        if (col === 8) cell.numFmt = "#,##0.00";
      });

      // ── Autofilter + freeze ────────────────────────────────────────────────
      ws.autoFilter = { from: { row: hdrRowNum, column: 1 }, to: { row: hdrRowNum, column: NUM_COLS } };
      ws.views = [{ state: "frozen", xSplit: 0, ySplit: hdrRowNum }];

      // ── Send ──────────────────────────────────────────────────────────────
      const safeRef = (proforma.reference || "proforma").replace(/[^a-zA-Z0-9 \-_]/g, "").trim();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${safeRef}.xlsx"`);
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      res.end(buf);
    } catch (error: any) {
      console.error("Proforma export error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Star / unstar a proforma ──────────────────────────────────────────────
  // PATCH /api/suppliers/:supplierId/proformas/:proformaId/star
  // Toggles the starred state. Only one proforma per supplier+company can be
  // starred at a time — starring a new one automatically unstarches the old one.
  app.patch("/api/suppliers/:supplierId/proformas/:proformaId/star", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseId(req.params.supplierId);
      const proformaId = parseId(req.params.proformaId);
      if (supplierId === null || proformaId === null) return res.status(400).json({ message: "Invalid id" });

      const [current] = await db
        .select({ id: supplierProformas.id, isStarred: supplierProformas.isStarred })
        .from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!current) return res.status(404).json({ message: "Proforma not found" });

      const newStarred = !current.isStarred;

      if (newStarred) {
        // Unstar all other proformas for this supplier+company first
        await db
          .update(supplierProformas)
          .set({ isStarred: false })
          .where(
            and(
              eq(supplierProformas.companyId, companyId),
              eq(supplierProformas.supplierId, supplierId),
              ne(supplierProformas.id, proformaId)
            )
          );
      }

      const [updated] = await db
        .update(supplierProformas)
        .set({ isStarred: newStarred })
        .where(eq(supplierProformas.id, proformaId))
        .returning();

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
