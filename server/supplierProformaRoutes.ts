import { Express } from "express";
import { db } from "./db";
import { eq, and, inArray } from "drizzle-orm";
import {
  supplierProformas,
  supplierProformaLines,
  supplierContainerLoadedItems,
  containers,
  suppliers,
} from "@shared/schema";

export function registerSupplierProformaRoutes(app: Express, requireAuth: any) {

  app.get("/api/suppliers/:supplierId/proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseInt(req.params.supplierId);
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
      const proformaId = parseInt(req.params.proformaId);
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
      const supplierId = parseInt(req.params.supplierId);
      const { reference, notes, lines } = req.body;
      const [proforma] = await db.insert(supplierProformas).values({
        companyId, supplierId, reference: reference || "Untitled", notes: notes || null,
      }).returning();
      if (lines && Array.isArray(lines) && lines.length > 0) {
        const lineValues = lines.map((l: any) => ({
          proformaId: proforma.id,
          barcode: l.barcode || "",
          itemName: l.itemName || "",
          qty: parseInt(l.qty) || 0,
          weightPerBale: l.weightPerBale || "0",
          pricePerBale: l.pricePerBale || "0",
        }));
        await db.insert(supplierProformaLines).values(lineValues);
      }
      const allLines = await db.select().from(supplierProformaLines).where(eq(supplierProformaLines.proformaId, proforma.id));
      res.json({ ...proforma, lines: allLines });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/suppliers/:supplierId/proformas/:proformaId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseInt(req.params.proformaId);
      const { reference, notes } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (reference !== undefined) updates.reference = reference;
      if (notes !== undefined) updates.notes = notes;
      const [updated] = await db.update(supplierProformas).set(updates)
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
      const proformaId = parseInt(req.params.proformaId);
      await db.delete(supplierProformaLines).where(eq(supplierProformaLines.proformaId, proformaId));
      await db.delete(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/suppliers/:supplierId/proformas/:proformaId/lines", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parseInt(req.params.proformaId);
      const [proforma] = await db.select().from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(403).json({ message: "Access denied" });
      const { barcode, itemName, qty, weightPerBale, pricePerBale } = req.body;
      const [line] = await db.insert(supplierProformaLines).values({
        proformaId, barcode: barcode || "", itemName: itemName || "",
        qty: parseInt(qty) || 0, weightPerBale: weightPerBale || "0", pricePerBale: pricePerBale || "0",
      }).returning();
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
      const lineId = parseInt(req.params.lineId);
      const [line] = await db.select().from(supplierProformaLines).where(eq(supplierProformaLines.id, lineId));
      if (!line) return res.status(404).json({ message: "Line not found" });
      const [proforma] = await db.select().from(supplierProformas)
        .where(and(eq(supplierProformas.id, line.proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(403).json({ message: "Access denied" });
      const updates: any = {};
      if (req.body.barcode !== undefined) updates.barcode = req.body.barcode;
      if (req.body.itemName !== undefined) updates.itemName = req.body.itemName;
      if (req.body.qty !== undefined) updates.qty = parseInt(req.body.qty) || 0;
      if (req.body.weightPerBale !== undefined) updates.weightPerBale = req.body.weightPerBale;
      if (req.body.pricePerBale !== undefined) updates.pricePerBale = req.body.pricePerBale;
      const [updated] = await db.update(supplierProformaLines).set(updates)
        .where(eq(supplierProformaLines.id, lineId)).returning();
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
      const lineId = parseInt(req.params.lineId);
      const [line] = await db.select().from(supplierProformaLines).where(eq(supplierProformaLines.id, lineId));
      if (!line) return res.status(404).json({ message: "Line not found" });
      const [proforma] = await db.select().from(supplierProformas)
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
      const proformaId = parseInt(req.params.proformaId);
      const [proforma] = await db.select().from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(403).json({ message: "Access denied" });
      const { lines } = req.body;
      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "No lines to import" });
      }
      const lineValues = lines.map((l: any) => ({
        proformaId,
        barcode: String(l.barcode || l.Barcode || "").trim(),
        itemName: String(l.itemName || l["Item Name"] || "").trim(),
        qty: parseInt(l.qty || l.Qty || 0) || 0,
        weightPerBale: String(l.weightPerBale || l["Weight per Bale"] || "0"),
        pricePerBale: String(l.pricePerBale || l["Price per Bale"] || "0"),
      }));
      await db.insert(supplierProformaLines).values(lineValues);
      await db.update(supplierProformas).set({ updatedAt: new Date() }).where(eq(supplierProformas.id, proformaId));
      const allLines = await db.select().from(supplierProformaLines).where(eq(supplierProformaLines.proformaId, proformaId));
      res.json({ imported: lineValues.length, lines: allLines });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const verifyContainerOwnership = async (containerId: number, companyId: number) => {
    const [container] = await db.select().from(containers).where(and(eq(containers.id, containerId), eq(containers.companyId, companyId)));
    return !!container;
  };

  app.get("/api/containers/:containerId/loaded-items", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseInt(req.params.containerId);
      if (!await verifyContainerOwnership(containerId, companyId)) return res.status(403).json({ message: "Access denied" });
      const items = await db.select().from(supplierContainerLoadedItems)
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
      const containerId = parseInt(req.params.containerId);
      if (!await verifyContainerOwnership(containerId, companyId)) return res.status(403).json({ message: "Access denied" });
      const { barcode, itemName, qty, weightPerBale, pricePerBale } = req.body;
      const [item] = await db.insert(supplierContainerLoadedItems).values({
        containerId, barcode: barcode || "", itemName: itemName || null,
        qty: parseInt(qty) || 0, weightPerBale: weightPerBale || null, pricePerBale: pricePerBale || null,
      }).returning();
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/container-loaded-items/:itemId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const itemId = parseInt(req.params.itemId);
      const [item] = await db.select().from(supplierContainerLoadedItems).where(eq(supplierContainerLoadedItems.id, itemId));
      if (!item) return res.status(404).json({ message: "Item not found" });
      if (!await verifyContainerOwnership(item.containerId, companyId)) return res.status(403).json({ message: "Access denied" });
      const updates: any = {};
      if (req.body.barcode !== undefined) updates.barcode = req.body.barcode;
      if (req.body.itemName !== undefined) updates.itemName = req.body.itemName;
      if (req.body.qty !== undefined) updates.qty = parseInt(req.body.qty) || 0;
      if (req.body.weightPerBale !== undefined) updates.weightPerBale = req.body.weightPerBale;
      if (req.body.pricePerBale !== undefined) updates.pricePerBale = req.body.pricePerBale;
      const [updated] = await db.update(supplierContainerLoadedItems).set(updates)
        .where(eq(supplierContainerLoadedItems.id, itemId)).returning();
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/container-loaded-items/:itemId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const itemId = parseInt(req.params.itemId);
      const [item] = await db.select().from(supplierContainerLoadedItems).where(eq(supplierContainerLoadedItems.id, itemId));
      if (!item) return res.status(404).json({ message: "Item not found" });
      if (!await verifyContainerOwnership(item.containerId, companyId)) return res.status(403).json({ message: "Access denied" });
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
      const containerId = parseInt(req.params.containerId);
      if (!await verifyContainerOwnership(containerId, companyId)) return res.status(403).json({ message: "Access denied" });
      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items to import" });
      }
      const values = items.map((l: any) => ({
        containerId,
        barcode: String(l.barcode || l.Barcode || "").trim(),
        itemName: String(l.itemName || l["Item Name"] || "").trim() || null,
        qty: parseInt(l.qty || l.Qty || 0) || 0,
        weightPerBale: l.weightPerBale || l["Weight per Bale"] || null,
        pricePerBale: l.pricePerBale || l["Price per Bale"] || null,
      }));
      await db.insert(supplierContainerLoadedItems).values(values);
      const allItems = await db.select().from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.containerId, containerId));
      res.json({ imported: values.length, items: allItems });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/suppliers/:supplierId/containers/:containerId/verification-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseInt(req.params.supplierId);
      const containerId = parseInt(req.params.containerId);
      const proformaId = parseInt(req.query.proformaId as string);
      if (!proformaId) return res.status(400).json({ message: "proformaId query param required" });

      const [proforma] = await db.select().from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const proformaLines = await db.select().from(supplierProformaLines)
        .where(eq(supplierProformaLines.proformaId, proformaId));

      const loadedItems = await db.select().from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.containerId, containerId));

      const proformaByBarcode = new Map<string, any>();
      for (const line of proformaLines) {
        const bc = (line.barcode || "").trim();
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
        const bc = (item.barcode || "").trim();
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
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/suppliers/:supplierId/containers/:containerId/verification-export.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseInt(req.params.supplierId);
      const containerId = parseInt(req.params.containerId);
      const proformaId = parseInt(req.query.proformaId as string);
      if (!proformaId) return res.status(400).json({ message: "proformaId required" });

      const [proforma] = await db.select().from(supplierProformas)
        .where(and(eq(supplierProformas.id, proformaId), eq(supplierProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const [container] = await db.select().from(containers).where(eq(containers.id, containerId));
      const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));

      const proformaLinesList = await db.select().from(supplierProformaLines)
        .where(eq(supplierProformaLines.proformaId, proformaId));
      const loadedItemsList = await db.select().from(supplierContainerLoadedItems)
        .where(eq(supplierContainerLoadedItems.containerId, containerId));

      const proformaByBarcode = new Map<string, any>();
      for (const line of proformaLinesList) {
        const bc = (line.barcode || "").trim();
        if (proformaByBarcode.has(bc)) { proformaByBarcode.get(bc).qty += line.qty; }
        else { proformaByBarcode.set(bc, { ...line, qty: line.qty, weightPerBale: parseFloat(line.weightPerBale || "0"), pricePerBale: parseFloat(line.pricePerBale || "0") }); }
      }
      const loadedByBarcode = new Map<string, any>();
      for (const item of loadedItemsList) {
        const bc = (item.barcode || "").trim();
        if (loadedByBarcode.has(bc)) { loadedByBarcode.get(bc).qty += item.qty; }
        else { loadedByBarcode.set(bc, { ...item, qty: item.qty, weightPerBale: parseFloat(item.weightPerBale || "0"), pricePerBale: parseFloat(item.pricePerBale || "0") }); }
      }

      const allBarcodes = new Set([...proformaByBarcode.keys(), ...loadedByBarcode.keys()]);
      const overloaded: any[] = [];
      const lessLoaded: any[] = [];
      const notRequested: any[] = [];
      const priceDiffs: any[] = [];

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
        const loadedValueTotal = loadedQty * (loadPrice || expPrice);

        if (expectedQty === 0 && loadedQty > 0) {
          notRequested.push({ barcode, itemName, qty: loadedQty, totalWeight: loadedWeightTotal, totalValue: loadedValueTotal });
        } else if (loadedQty > expectedQty) {
          overloaded.push({ barcode, itemName, qty: loadedQty, expectedQty, totalWeight: loadedWeightTotal, totalValue: loadedValueTotal });
        } else if (loadedQty < expectedQty) {
          lessLoaded.push({ barcode, itemName, qty: loadedQty, expectedQty, totalWeight: loadedWeightTotal, totalValue: loadedValueTotal });
        }
        if (expPrice && loadPrice && Math.abs(loadPrice - expPrice) >= 0.01) {
          priceDiffs.push({ barcode, itemName, proformaPrice: expPrice, loadedPrice: loadPrice, qty: loadedQty, totalDiff: (loadPrice - expPrice) * loadedQty });
        }
      }

      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Verification");

      const boldFont = { bold: true, size: 12 };
      const headerFont = { bold: true, size: 10 };

      sheet.addRow(["Supplier:", supplier?.legalName || `ID ${supplierId}`]).font = boldFont;
      sheet.addRow(["Container:", container?.containerNumber || `ID ${containerId}`]).font = boldFont;
      sheet.addRow(["Proforma:", proforma.reference]).font = boldFont;
      sheet.addRow(["Generated:", new Date().toLocaleString()]).font = boldFont;
      sheet.addRow([]);

      const addSection = (title: string, items: any[], columns: string[], dataFn: (item: any) => any[]) => {
        const titleRow = sheet.addRow([title]);
        titleRow.font = { bold: true, size: 11 };
        const headerRow = sheet.addRow(columns);
        headerRow.font = headerFont;
        if (items.length === 0) {
          sheet.addRow(["None"]);
        } else {
          for (const item of items) {
            sheet.addRow(dataFn(item));
          }
        }
        sheet.addRow([]);
      };

      addSection("A) Overloaded", overloaded,
        ["Item", "Barcode", "Loaded Qty", "Expected Qty", "Total Weight", "Total Value"],
        (i) => [i.itemName, i.barcode, i.qty, i.expectedQty, parseFloat(i.totalWeight.toFixed(3)), parseFloat(i.totalValue.toFixed(2))]
      );
      addSection("B) Less Loaded", lessLoaded,
        ["Item", "Barcode", "Loaded Qty", "Expected Qty", "Total Weight", "Total Value"],
        (i) => [i.itemName, i.barcode, i.qty, i.expectedQty, parseFloat(i.totalWeight.toFixed(3)), parseFloat(i.totalValue.toFixed(2))]
      );
      addSection("C) Loaded Not Requested", notRequested,
        ["Item", "Barcode", "Qty", "Total Weight", "Total Value"],
        (i) => [i.itemName, i.barcode, i.qty, parseFloat(i.totalWeight.toFixed(3)), parseFloat(i.totalValue.toFixed(2))]
      );
      addSection("D) Different Pricing per Bale", priceDiffs,
        ["Item", "Barcode", "Proforma Price", "Loaded Price", "Qty", "Total Difference"],
        (i) => [i.itemName, i.barcode, parseFloat(i.proformaPrice.toFixed(2)), parseFloat(i.loadedPrice.toFixed(2)), i.qty, parseFloat(i.totalDiff.toFixed(2))]
      );

      sheet.columns.forEach((col: any) => { col.width = 18; });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=verification_${containerId}_${proformaId}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Export error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
