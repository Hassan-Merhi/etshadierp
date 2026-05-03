import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockGroupArchives, stockItemCodeAliases,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerSales,
  containerCharges, containerTrackingImportRowSchema, updateContainerTrackingSchema,
  bankAccounts, fixedAssets, insertBankAccountSchema, insertFixedAssetSchema,
  insertStockGroupSchema, insertStockItemSchema, insertStockItemCodeAliasSchema,
  insertContainerSchema, offloadRequestSchema,
  purchaseOrders, poLineItems, insertContainerSaleSchema,
  vouchers, voucherEntries, salesItems, suppliers, customers,
  locations, employees, userLocations, auditLog, interCompanyTransfers,
  insertInterCompanyTransferSchema, FEATURE_KEYS,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";

// ──────────────────────────────────────────────────────────────────────────────
// Inter-company sync helper
// When a subsidiary PO is edited (amount or container number), the matching
// INTERCO-PARENT-{poNumber} voucher in the parent company must also be updated.
// ──────────────────────────────────────────────────────────────────────────────
async function syncIntercoParentVoucher(
  tx: any,
  poNumber: string,
  newAmount: number,
): Promise<void> {
  try {
    const parentCompanyId = await storage.getParentCompanyId();
    if (!parentCompanyId) return;

    // Find the INTERCO-PARENT voucher for this PO in the parent company
    const [parentVoucher] = await tx
      .select({ id: vouchers.id })
      .from(vouchers)
      .where(
        and(
          eq(vouchers.companyId, parentCompanyId),
          like(vouchers.voucherNumber, `INTERCO-PARENT-${poNumber}-%`),
        ),
      )
      .limit(1);

    if (!parentVoucher) return;

    // Update parent voucher total
    await tx
      .update(vouchers)
      .set({ totalAmount: newAmount.toFixed(2) })
      .where(eq(vouchers.id, parentVoucher.id));

    // Update all entries on this parent voucher (both DR and CR sides)
    const parentEntries = await tx
      .select()
      .from(voucherEntries)
      .where(eq(voucherEntries.voucherId, parentVoucher.id));

    for (const entry of parentEntries) {
      if (parseFloat(entry.debitAmount || "0") > 0) {
        await tx
          .update(voucherEntries)
          .set({ debitAmount: newAmount.toFixed(2) })
          .where(eq(voucherEntries.id, entry.id));
      } else if (parseFloat(entry.creditAmount || "0") > 0) {
        await tx
          .update(voucherEntries)
          .set({ creditAmount: newAmount.toFixed(2) })
          .where(eq(voucherEntries.id, entry.id));
      }
    }
  } catch (err) {
    console.error("[syncIntercoParentVoucher] Error syncing parent INTERCO voucher:", err);
  }
}

export function registerContainerRoutes(app: Express) {
  app.get("/api/containers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const containers = await storage.getAllContainers(
        req.session.currentCompanyId,
      );
      res.json(containers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get active containers (not sold)
  app.get("/api/containers/active", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const containers = await storage.getActiveContainers(
        req.session.currentCompanyId,
      );
      res.json(containers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get sold containers with full details
  app.get("/api/containers/sold", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const soldContainers = await storage.getSoldContainers(
        req.session.currentCompanyId,
      );
      res.json(soldContainers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update container tracking fields (OTW tracking)
  app.patch("/api/containers/:id/tracking", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }
      
      // Validate request body with Zod schema
      const parseResult = updateContainerTrackingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Invalid tracking data", 
          errors: parseResult.error.errors 
        });
      }
      
      const {
        shopName,
        eta,
        etaSource,
        transporter,
        transportFee,
        numberPlate,
        trackingLocation,
        borderDate,
        offloadDate,
        agent,
        dutyFee,
        docReceived,
        trackingDescription,
      } = parseResult.data;
      
      const updateData: any = {};
      if (shopName !== undefined) updateData.shopName = shopName;
      if (eta !== undefined) updateData.eta = eta || null;
      if (etaSource !== undefined) updateData.etaSource = etaSource;
      if (transporter !== undefined) updateData.transporter = transporter;
      if (transportFee !== undefined) updateData.transportFee = transportFee || null;
      if (numberPlate !== undefined) updateData.numberPlate = numberPlate;
      if (trackingLocation !== undefined) updateData.trackingLocation = trackingLocation;
      if (borderDate !== undefined) updateData.borderDate = borderDate || null;
      if (offloadDate !== undefined) updateData.offloadDate = offloadDate || null;
      if (agent !== undefined) updateData.agent = agent;
      if (dutyFee !== undefined) updateData.dutyFee = dutyFee || null;
      if (docReceived !== undefined) updateData.docReceived = docReceived;
      if (trackingDescription !== undefined) updateData.trackingDescription = trackingDescription;
      
      await db
        .update(containers)
        .set(updateData)
        .where(and(
          eq(containers.id, id),
          eq(containers.companyId, req.session.currentCompanyId)
        ));
      
      const [updated] = await db
        .select()
        .from(containers)
        .where(and(
          eq(containers.id, id),
          eq(containers.companyId, req.session.currentCompanyId)
        ))
        .limit(1);
      
      if (!updated) {
        return res.status(404).json({ message: "Container not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update container number
  app.patch("/api/containers/:id/number", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid container ID" });
      const { containerNumber } = req.body;
      if (!containerNumber || !String(containerNumber).trim()) {
        return res.status(400).json({ message: "Container number is required" });
      }
      const newNumber = String(containerNumber).trim().toUpperCase();
      const [existing] = await db
        .select({ id: containers.id })
        .from(containers)
        .where(and(eq(containers.companyId, companyId), eq(containers.containerNumber, newNumber)))
        .limit(1);
      if (existing && existing.id !== id) {
        return res.status(409).json({ message: `Container number "${newNumber}" is already in use` });
      }
      const [updated] = await db
        .update(containers)
        .set({ containerNumber: newNumber })
        .where(and(eq(containers.id, id), eq(containers.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Container not found" });

      // ── Inter-company sync: update the description of INTERCO-PARENT vouchers in the parent
      //    company so the new container number is reflected there too ──
      try {
        const parentCompanyId = await storage.getParentCompanyId();
        if (parentCompanyId) {
          const containerPOs = await db
            .select({ poNumber: purchaseOrders.poNumber })
            .from(purchaseOrders)
            .where(and(eq(purchaseOrders.containerId, id), eq(purchaseOrders.companyId, companyId)));

          for (const po of containerPOs) {
            const [parentVoucher] = await db
              .select({ id: vouchers.id, description: vouchers.description })
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, parentCompanyId),
                  like(vouchers.voucherNumber, `INTERCO-PARENT-${po.poNumber}-%`),
                ),
              )
              .limit(1);

            if (!parentVoucher) continue;

            // The admin-created description format is "{oldContainerNumber} {supplierName}"
            // Update only if the description starts with a container-number-like token
            if (parentVoucher.description) {
              const parts = parentVoucher.description.split(" ");
              // Heuristic: if the first word looks like a container number (alphanumeric, may contain dashes)
              // and is NOT "Inter-company", replace it with the new container number
              if (parts[0] && parts[0] !== "Inter-company") {
                parts[0] = newNumber;
                const newDesc = parts.join(" ");
                await db
                  .update(vouchers)
                  .set({ description: newDesc })
                  .where(eq(vouchers.id, parentVoucher.id));
              }
            }
          }
        }
      } catch (syncErr) {
        console.error("[container number sync] Error updating INTERCO-PARENT voucher descriptions:", syncErr);
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk import container tracking from Excel data
  app.post("/api/containers/tracking/import", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data provided" });
      }
      
      let updated = 0;
      let notFound = 0;
      const errors: string[] = [];
      
      for (const row of rows) {
        try {
          const parseResult = containerTrackingImportRowSchema.safeParse(row);
          if (!parseResult.success) {
            errors.push(`Invalid row data for ${row.containerNumber || 'unknown'}`);
            continue;
          }
          
          const data = parseResult.data;
          const containerNumber = data.containerNumber?.trim();
          if (!containerNumber) {
            errors.push("Missing container number in row");
            continue;
          }
          
          // Find container by number
          const [container] = await db
            .select()
            .from(containers)
            .where(and(
              eq(containers.containerNumber, containerNumber),
              eq(containers.companyId, req.session.currentCompanyId!)
            ))
            .limit(1);
          
          if (!container) {
            notFound++;
            errors.push(`Container not found: ${containerNumber}`);
            continue;
          }
          
          // Normalise any date string to YYYY-MM-DD; return null for invalid values
          const normDate = (v: any): string | null => {
            if (!v) return null;
            if (v instanceof Date) {
              if (isNaN(v.getTime())) return null;
              const y = v.getFullYear();
              const m = String(v.getMonth() + 1).padStart(2, "0");
              const d = String(v.getDate()).padStart(2, "0");
              return `${y}-${m}-${d}`;
            }
            const s = String(v).trim();
            if (!s || s === "[object Object]") return null;
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
            // MM/DD/YY or MM/DD/YYYY
            const sl = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
            if (sl) {
              const [, mo, dy, yr] = sl;
              const fullYr = yr.length === 2 ? (parseInt(yr) >= 50 ? `19${yr}` : `20${yr}`) : yr;
              return `${fullYr}-${mo.padStart(2,"0")}-${dy.padStart(2,"0")}`;
            }
            const parsed = new Date(s);
            if (!isNaN(parsed.getTime())) {
              const y = parsed.getFullYear();
              const m = String(parsed.getMonth() + 1).padStart(2, "0");
              const d = String(parsed.getDate()).padStart(2, "0");
              return `${y}-${m}-${d}`;
            }
            return null;
          };

          // Sanitise numeric cell values — reject "[object Object]" strings that can come from ExcelJS
          const normNum = (v: any): string | null => {
            if (v === null || v === undefined || v === "") return null;
            const s = String(v).trim();
            if (!s || s === "[object Object]") return null;
            const n = parseFloat(s.replace(/,/g, ""));
            return isNaN(n) ? null : String(n);
          };

          // Build update object
          const updateData: any = {};
          if (data.shopName && String(data.shopName) !== "[object Object]") updateData.shopName = String(data.shopName);
          const etaDate = normDate(data.eta);
          if (etaDate) updateData.eta = etaDate;
          if (data.transporter && String(data.transporter) !== "[object Object]") updateData.transporter = String(data.transporter);
          const tFee = normNum(data.transportFee);
          if (tFee !== null) updateData.transportFee = tFee;
          if (data.numberPlate && String(data.numberPlate) !== "[object Object]") updateData.numberPlate = String(data.numberPlate);
          if (data.trackingLocation && String(data.trackingLocation) !== "[object Object]") updateData.trackingLocation = String(data.trackingLocation);
          const borderDateVal = normDate(data.borderDate);
          if (borderDateVal) updateData.borderDate = borderDateVal;
          const offloadDateVal = normDate(data.offloadDate);
          if (offloadDateVal) updateData.offloadDate = offloadDateVal;
          if (data.agent && String(data.agent) !== "[object Object]") updateData.agent = String(data.agent);
          const dFee = normNum(data.dutyFee);
          if (dFee !== null) updateData.dutyFee = dFee;
          if (data.docReceived !== undefined) {
            updateData.docReceived = data.docReceived === true || data.docReceived === "Yes" || data.docReceived === "yes" || data.docReceived === "YES" || data.docReceived === "TRUE" || data.docReceived === "true";
          }
          if (data.trackingDescription && String(data.trackingDescription) !== "[object Object]") updateData.trackingDescription = String(data.trackingDescription);
          
          if (Object.keys(updateData).length > 0) {
            await db
              .update(containers)
              .set(updateData)
              .where(eq(containers.id, container.id));
            updated++;
          }
        } catch (rowError: any) {
          errors.push(`Error processing ${row.containerNumber || 'unknown'}: ${rowError.message}`);
        }
      }
      
      res.json({
        success: true,
        updated,
        notFound,
        total: rows.length,
        errors: errors.slice(0, 10), // Return first 10 errors
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Fetch container ETA from external tracking API (optional - requires CONTAINER_TRACKING_API_KEY)
  app.post("/api/containers/:id/fetch-eta", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }
      
      // Get the container
      const [container] = await db
        .select()
        .from(containers)
        .where(and(
          eq(containers.id, id),
          eq(containers.companyId, req.session.currentCompanyId)
        ))
        .limit(1);
      
      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }
      
      const apiKey = process.env.CONTAINER_TRACKING_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ 
          message: "Container tracking API not configured. Add CONTAINER_TRACKING_API_KEY to enable auto ETA updates.",
          needsSetup: true
        });
      }
      
      // Try to fetch from Terminal49 or similar API
      // For now, return a message that the feature requires setup
      // In production, this would call the actual API
      try {
        // Example: Terminal49 API call
        // const response = await fetch(`https://api.terminal49.com/v2/containers/${container.containerNumber}`, {
        //   headers: { 'Authorization': `Token ${apiKey}` }
        // });
        // const data = await response.json();
        // const eta = data.pod_eta;
        
        // For now, simulate the response
        return res.json({
          message: "Container tracking API integration requires Terminal49 or similar API key",
          containerNumber: container.containerNumber,
          currentEta: container.eta,
          etaSource: container.etaSource,
          instructions: "Set CONTAINER_TRACKING_API_KEY secret with your Terminal49 API key to enable auto ETA updates"
        });
      } catch (apiError: any) {
        return res.status(502).json({ 
          message: "Failed to fetch from tracking API", 
          error: apiError.message 
        });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get POs for a container (for viewing details from dashboard)
  app.get("/api/containers/:id/purchase-orders", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const containerId = parseInt(req.params.id);
      if (isNaN(containerId)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }

      const container = await storage.getContainerById(containerId);
      
      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }

      // Verify user has access to this container's company
      const userCompanyRoles = await storage.getUserCompaniesWithRoles(userId);
      const hasAccess = userCompanyRoles.some(r => r.companyId === container.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const supplier = await storage.getSupplierById(container.supplierId);
      const purchaseOrders = await storage.getPurchaseOrdersByContainer(containerId);

      // Batch-fetch all line items and stock items in 2 queries instead of N*M
      const poIds = purchaseOrders.map(po => po.id);
      const [allLineItems, allStockItems] = poIds.length > 0 ? await Promise.all([
        db.select().from(poLineItems).where(inArray(poLineItems.purchaseOrderId, poIds)).execute(),
        db.select({ id: stockItems.id, code: stockItems.code, name: stockItems.name })
          .from(stockItems)
          .where(inArray(stockItems.id,
            [...new Set((await db.select({ id: poLineItems.stockItemId }).from(poLineItems)
              .where(inArray(poLineItems.purchaseOrderId, poIds)).execute())
              .map(r => r.id).filter(Boolean) as number[])]
          )).execute(),
      ]) : [[], []];

      const stockItemMap = new Map(allStockItems.map(s => [s.id, s]));
      const lineItemsByPO = new Map<number, typeof allLineItems>();
      for (const li of allLineItems) {
        const arr = lineItemsByPO.get(li.purchaseOrderId!) || [];
        arr.push(li);
        lineItemsByPO.set(li.purchaseOrderId!, arr);
      }

      const posWithItems = purchaseOrders.map(po => {
        const lineItemsForPO = lineItemsByPO.get(po.id) || [];
        const itemsWithNames = lineItemsForPO.map(item => {
          const stockItem = item.stockItemId ? stockItemMap.get(item.stockItemId) : null;
          return {
            stockItemCode: stockItem?.code || "",
            stockItemName: stockItem?.name || item.itemName,
            quantity: item.quantity,
            rate: item.rate,
            lineTotal: item.lineTotal,
          };
        });
        return {
          id: po.id,
          poNumber: po.poNumber,
          currency: po.currency,
          itemsTotal: po.itemsTotal,
          freight: po.freight,
          surcharge: po.surcharge,
          fumigation: po.fumigation,
          documentCharges: po.documentCharges,
          discount: po.discount,
          otherCharges: po.otherCharges,
          status: po.status,
          lineItems: itemsWithNames,
        };
      });

      res.json({
        container: {
          id: container.id,
          containerNumber: container.containerNumber,
          status: container.status,
          importDate: container.importDate,
          grandTotal: container.grandTotal,
        },
        supplier: supplier ? { id: supplier.id, legalName: supplier.legalName } : null,
        purchaseOrders: posWithItems,
      });
    } catch (error) {
      console.error("Error fetching container POs:", error);
      res.status(500).json({ message: "Failed to fetch purchase orders" });
    }
  });
  // Export single container with all details (JSON)
  app.get("/api/containers/:id/export", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const containerId = parseInt(req.params.id);
      const container = await storage.getContainerById(containerId);
      
      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }

      const supplier = await storage.getSupplierById(container.supplierId);
      const purchaseOrders = await storage.getPurchaseOrdersByContainer(containerId);

      // Batch-fetch all PO line items and offload items in parallel
      const poIds = purchaseOrders.map(po => po.id);
      const [[offloadRecord], allPoLineItems] = await Promise.all([
        db.select().from(containerOffloads).where(eq(containerOffloads.containerId, containerId)).limit(1).execute(),
        poIds.length > 0 ? db.select().from(poLineItems).where(inArray(poLineItems.poId, poIds)).execute() : [],
      ]);

      const poStockIds = [...new Set(allPoLineItems.map(li => li.stockItemId).filter(Boolean) as number[])];
      const [offloadItems, poStockRows] = await Promise.all([
        offloadRecord ? db.select().from(containerOffloadItems).where(eq(containerOffloadItems.offloadId, offloadRecord.id)).execute() : [],
        poStockIds.length > 0 ? db.select({ id: stockItems.id, code: stockItems.code, name: stockItems.name }).from(stockItems).where(inArray(stockItems.id, poStockIds)).execute() : [],
      ]);

      const offloadStockIds = [...new Set(offloadItems.map(i => i.stockItemId).filter(Boolean) as number[])];
      const offloadStockRows = offloadStockIds.length > 0
        ? await db.select({ id: stockItems.id, code: stockItems.code, name: stockItems.name }).from(stockItems).where(inArray(stockItems.id, offloadStockIds)).execute()
        : [];

      const stockMap = new Map([...poStockRows, ...offloadStockRows].map(s => [s.id, s]));
      const lineItemsByPO = new Map<number, typeof allPoLineItems>();
      for (const li of allPoLineItems) {
        const arr = lineItemsByPO.get(li.poId!) || [];
        arr.push(li);
        lineItemsByPO.set(li.poId!, arr);
      }

      const posWithItems = purchaseOrders.map(po => {
        const lineItemsForPO = lineItemsByPO.get(po.id) || [];
        return {
          poNumber: po.poNumber,
          currency: po.currency,
          itemsTotal: po.itemsTotal,
          freight: po.freight,
          surcharge: po.surcharge,
          fumigation: po.fumigation,
          documentCharges: po.documentCharges,
          discount: po.discount,
          otherCharges: po.otherCharges,
          status: po.status,
          lineItems: lineItemsForPO.map(item => {
            const stockItem = item.stockItemId ? stockMap.get(item.stockItemId) : null;
            return { stockItemCode: stockItem?.code || "", stockItemName: stockItem?.name || item.itemName, quantity: item.quantity, rate: item.rate, lineTotal: item.lineTotal };
          }),
        };
      });

      let offloadDetails = null;
      if (offloadRecord) {
        const location = await storage.getLocationById(offloadRecord.locationId);
        offloadDetails = {
          locationName: location?.name || "",
          duties: offloadRecord.duties,
          officeCharges: offloadRecord.officeCharges,
          transferCharges: offloadRecord.transferCharges,
          transportFees: offloadRecord.transportFees,
          totalCharges: offloadRecord.totalCharges,
          totalBales: offloadRecord.totalBales,
          additionalCostPerBale: offloadRecord.additionalCostPerBale,
          offloadedAt: offloadRecord.offloadedAt,
          offloadItems: offloadItems.map(item => {
            const stockItem = item.stockItemId ? stockMap.get(item.stockItemId) : null;
            return { stockItemCode: stockItem?.code || "", stockItemName: stockItem?.name || "", quantity: item.quantity, rate: item.rate, totalValue: item.totalValue };
          }),
        };
      }

      const exportData = {
        exportDate: new Date().toISOString(),
        container: {
          containerNumber: container.containerNumber,
          supplierName: supplier?.legalName || "",
          status: container.status,
          importDate: container.importDate,
          itemsTotal: container.itemsTotal,
          chargesTotal: container.chargesTotal,
          grandTotal: container.grandTotal,
          itemName: container.itemName,
          ratePerKg: container.ratePerKg,
          totalKg: container.totalKg,
        },
        purchaseOrders: posWithItems,
        offload: offloadDetails,
      };

      res.json(exportData);
    } catch (error: any) {
      console.error("Container export error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export all containers as Excel (one sheet per container)
  app.get("/api/containers/export-all", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const allContainers = await storage.getAllContainers(req.session.currentCompanyId);
      const workbook = createWorkbook();

      for (const container of allContainers) {
        const supplier = await storage.getSupplierById(container.supplierId);
        const purchaseOrders = await storage.getPurchaseOrdersByContainer(container.id);
        
        const sheetData: any[][] = [];
        
        sheetData.push(["CONTAINER DETAILS"]);
        sheetData.push(["Container Number", container.containerNumber]);
        sheetData.push(["Supplier", supplier?.legalName || ""]);
        sheetData.push(["Status", container.status]);
        sheetData.push(["Import Date", container.importDate]);
        sheetData.push(["Items Total", container.itemsTotal]);
        sheetData.push(["Charges Total", container.chargesTotal]);
        sheetData.push(["Grand Total", container.grandTotal]);
        if (container.itemName) {
          sheetData.push(["Manual Item", container.itemName]);
          sheetData.push(["Rate/Kg", container.ratePerKg]);
          sheetData.push(["Total Kg", container.totalKg]);
        }
        sheetData.push([]);

        for (const po of purchaseOrders) {
          sheetData.push(["PURCHASE ORDER: " + po.poNumber]);
          sheetData.push(["Currency", po.currency]);
          sheetData.push(["Items Total", po.itemsTotal]);
          sheetData.push(["Freight", po.freight]);
          sheetData.push(["Surcharge", po.surcharge]);
          sheetData.push(["Fumigation", po.fumigation]);
          sheetData.push(["Document Charges", po.documentCharges]);
          sheetData.push(["Discount", po.discount]);
          sheetData.push(["Other Charges", po.otherCharges]);
          sheetData.push([]);

          const lineItems = await storage.getLineItemsByPO(po.id);
          if (lineItems.length > 0) {
            sheetData.push(["Stock Code", "Item Name", "Quantity", "Rate", "Line Total"]);
            for (const item of lineItems) {
              const stockItem = item.stockItemId ? await storage.getStockItemById(item.stockItemId) : null;
              sheetData.push([
                stockItem?.code || "",
                stockItem?.name || item.itemName,
                item.quantity,
                item.rate,
                item.lineTotal,
              ]);
            }
            sheetData.push([]);
          }
        }

        const [offloadRecord] = await db
          .select()
          .from(containerOffloads)
          .where(eq(containerOffloads.containerId, container.id))
          .limit(1);
        if (offloadRecord) {
          const location = await storage.getLocationById(offloadRecord.locationId);
          sheetData.push(["OFFLOAD DETAILS"]);
          sheetData.push(["Location", location?.name || ""]);
          sheetData.push(["Duties", offloadRecord.duties]);
          sheetData.push(["Office Charges", offloadRecord.officeCharges]);
          sheetData.push(["Transfer Charges", offloadRecord.transferCharges]);
          sheetData.push(["Transport Fees", offloadRecord.transportFees]);
          sheetData.push(["Total Charges", offloadRecord.totalCharges]);
          sheetData.push(["Total Bales", offloadRecord.totalBales]);
          sheetData.push(["Additional Cost/Bale", offloadRecord.additionalCostPerBale]);
          sheetData.push(["Offloaded At", offloadRecord.offloadedAt?.toISOString() || ""]);
          sheetData.push([]);

          const offloadItems = await db
            .select()
            .from(containerOffloadItems)
            .where(eq(containerOffloadItems.offloadId, offloadRecord.id));
          
          if (offloadItems.length > 0) {
            sheetData.push(["OFFLOAD ITEMS"]);
            sheetData.push(["Stock Code", "Item Name", "Quantity", "Rate", "Total Value"]);
            for (const item of offloadItems) {
              const stockItem = await storage.getStockItemById(item.stockItemId);
              sheetData.push([
                stockItem?.code || "",
                stockItem?.name || "",
                item.quantity,
                item.rate,
                item.totalValue,
              ]);
            }
          }
        }

        const sheetName = container.containerNumber
          .replace(/[\\/*?:\[\]]/g, "_")
          .substring(0, 31);
        aoaToSheet(workbook, sheetData, sheetName);
      }

      const buffer = await writeWorkbook(workbook);
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="containers_export_${getClientDate(req)}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Container export-all error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Create a manual container
  app.post("/api/containers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const data = insertContainerSchema.parse({
        ...req.body,
        companyId: req.session.currentCompanyId,
      });

      // Extract manual container cost data from request body (not in base schema)
      const itemName = req.body.itemName?.trim();
      const ratePerKg = req.body.ratePerKg ? parseFloat(req.body.ratePerKg) : 0;
      const totalKg = req.body.totalKg ? parseFloat(req.body.totalKg) : 0;
      const hasManualCostData = itemName && ratePerKg > 0 && totalKg > 0;

      // Validate supplier required for manual containers with cost data
      if (hasManualCostData && !data.supplierId) {
        return res.status(400).json({ 
          message: "Supplier is required for manual containers with cost information" 
        });
      }

      const container = await storage.createContainer(data);

      // If this is a manual container with cost information, create a purchase voucher
      if (hasManualCostData) {
        try {
          const totalAmount = ratePerKg * totalKg;
          const voucherDate = data.importDate || getClientDate(req);

          // Get or create PURCHASES ledger account
          let purchasesAccount = await storage.getLedgerAccountByCode(
            "PURCHASES",
            req.session.currentCompanyId,
          );
          if (!purchasesAccount) {
            purchasesAccount = await storage.createLedgerAccount({
              companyId: req.session.currentCompanyId,
              code: "PURCHASES",
              name: "Purchases",
              accountType: "Expense",
              openingBalance: "0",
              openingBalanceSide: "Dr",
              active: true,
            });
          }

          // Create purchase voucher
          const voucher = await storage.createVoucher({
            companyId: req.session.currentCompanyId,
            currency: "USD",
            voucherNumber: `CONT-${container.containerNumber}-${Date.now()}`,
            voucherType: "Purchase",
            voucherDate: voucherDate,
            description: `Container ${container.containerNumber} - ${itemName}`,
            totalAmount: totalAmount.toFixed(2),
            optional: false,
            sourceModule: "ERP",
          });

          // Debit: Purchases account (Expense increases)
          await storage.createVoucherEntry({
            voucherId: voucher.id,
            ledgerAccountId: purchasesAccount.id,
            debitAmount: totalAmount.toFixed(2),
            creditAmount: "0",
            narration: `Container ${container.containerNumber} - ${itemName} (${totalKg}kg @ $${ratePerKg}/kg)`,
          });

          // Credit: Supplier account (Accounts Payable increases)
          await storage.createVoucherEntry({
            voucherId: voucher.id,
            supplierId: data.supplierId,
            debitAmount: "0",
            creditAmount: totalAmount.toFixed(2),
            narration: `Container ${container.containerNumber} - ${itemName} (${totalKg}kg @ $${ratePerKg}/kg)`,
          });
        } catch (voucherError: any) {
          // Rollback: Delete container if voucher creation fails
          await storage.deleteContainer(container.id);
          throw new Error(`Failed to create purchase voucher: ${voucherError.message}`);
        }
      }

      res.status(201).json(container);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: error.errors 
        });
      }
      return res.status(500).json({ message: error.message });
    }
  });

  // Get container details with POs, line items, and charges
  app.get(
    "/api/containers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const containerId = parseInt(req.params.id);
        const container = await storage.getContainerById(containerId);

        if (!container) {
          return res.status(404).json({ message: "Container not found" });
        }

        const pos = await storage.getPurchaseOrdersByContainer(containerId);
        const charges = await storage.getChargesByContainer(containerId);

        // Get line items for all POs
        const allLineItems = await Promise.all(
          pos.map((po) => storage.getLineItemsByPO(po.id)),
        );

        const posWithItems = pos.map((po, index) => ({
          ...po,
          items: allLineItems[index],
        }));

        res.json({
          container,
          pos: posWithItems,
          charges,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Offload container to location
  app.post(
    "/api/containers/:id/offload",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const containerId = parseInt(req.params.id);

        // Validate request body
        const validation = offloadRequestSchema.safeParse(req.body);
        if (!validation.success) {
          return res.status(400).json({
            message: "Validation failed",
            errors: validation.error.errors,
          });
        }

        const {
          locationId,
          offloadDate,
          duties,
          dutiesAccountId,
          officeCharges,
          officeChargesAccountId,
          officeChargesCashAccountId,
          transferCharges,
          transportFees,
          transportAccountId,
          additionalCharges = [],
          inventoryCostCorrections = [],
        } = validation.data;

        // Validate container exists
        const container = await storage.getContainerById(containerId);
        if (!container) {
          return res.status(404).json({ message: "Container not found" });
        }

        // Check if this is an edit (container already offloaded)
        const isEdit = container.status === "OFFLOADED";
        
        if (isEdit) {
          // For edits, first reverse the existing offload
          const [existingOffload] = await db
            .select()
            .from(containerOffloads)
            .where(eq(containerOffloads.containerId, containerId))
            .limit(1);

          if (existingOffload) {
            // Reverse inventory changes + delete old records atomically.
            // Prefer stored containerOffloadItems (exact quantities that were actually offloaded)
            // to avoid discrepancies when PO line items were edited after the original offload.
            const storedOffloadItems = await db
              .select()
              .from(containerOffloadItems)
              .where(eq(containerOffloadItems.offloadId, existingOffload.id));

            await db.transaction(async (tx) => {
              if (storedOffloadItems.length > 0) {
                for (const offloadItem of storedOffloadItems) {
                  await reverseInventoryByExactValue(
                    tx,
                    existingOffload.locationId,
                    offloadItem.stockItemId,
                    parseFloat(offloadItem.quantity),
                    parseFloat(offloadItem.totalValue),
                  );
                }
              } else {
                const pos = await storage.getPurchaseOrdersByContainer(containerId);
                const allLineItems: any[] = [];
                for (const po of pos) {
                  const lineItems = await storage.getLineItemsByPO(po.id);
                  allLineItems.push(...lineItems);
                }
                const legacyAdditionalCost = parseFloat(existingOffload.additionalCostPerBale || "0");
                const legacyItemsMap = new Map<number, { totalQuantity: number; weightedRateSum: number }>();
                for (const item of allLineItems) {
                  const stockItemId = item.stockItemId;
                  if (!stockItemId || stockItemId === 0) continue;
                  const quantity = parseFloat(item.quantity);
                  const rate = parseFloat(item.rate || "0");
                  if (legacyItemsMap.has(stockItemId)) {
                    const existing = legacyItemsMap.get(stockItemId)!;
                    existing.totalQuantity += quantity;
                    existing.weightedRateSum += rate * quantity;
                  } else {
                    legacyItemsMap.set(stockItemId, { totalQuantity: quantity, weightedRateSum: rate * quantity });
                  }
                }
                for (const [stockItemId, data] of Array.from(legacyItemsMap)) {
                  const estimatedValue = data.weightedRateSum + data.totalQuantity * legacyAdditionalCost;
                  await reverseInventoryByExactValue(
                    tx,
                    existingOffload.locationId,
                    stockItemId,
                    data.totalQuantity,
                    estimatedValue,
                  );
                }
              }

              // Delete stored offload items so they don't persist after reversal
              await tx
                .delete(containerOffloadItems)
                .where(eq(containerOffloadItems.offloadId, existingOffload.id));

              const containerDescPattern = `%container ${container.containerNumber}%`;
              const oldVouchers = await tx
                .select()
                .from(vouchers)
                .where(
                  and(
                    eq(vouchers.companyId, container.companyId),
                    sql`LOWER(${vouchers.description}) LIKE LOWER(${containerDescPattern})`,
                    sql`(
                      ${vouchers.voucherNumber} LIKE 'DUTY-%' OR
                      ${vouchers.voucherNumber} LIKE 'OFFICE-%' OR
                      ${vouchers.voucherNumber} LIKE 'TRANS-%' OR
                      ${vouchers.voucherNumber} LIKE 'CHG-%' OR
                      ${vouchers.voucherNumber} LIKE 'XFER-%'
                    )`,
                  ),
                );

              for (const voucher of oldVouchers) {
                await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));
                await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
              }

              await tx.delete(containerOffloads).where(eq(containerOffloads.id, existingOffload.id));
            });
          }

          // Set status back to OTW so offloadContainer can proceed
          await storage.updateContainer(containerId, { status: "OTW" });
        }

        // Perform offload
        const offload = await storage.offloadContainer(
          containerId,
          locationId,
          duties,
          dutiesAccountId,
          officeCharges,
          officeChargesAccountId,
          officeChargesCashAccountId,
          transferCharges,
          transportFees,
          transportAccountId,
          additionalCharges,
          offloadDate || getClientDate(req),
          inventoryCostCorrections,
        );

        res.json(offload);
      } catch (error: any) {
        console.error("Container offload error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Reverse container offload (Admin, Owner, or Manager)
  app.post(
    "/api/containers/:id/reverse-offload",
    requireAuth,
    requireRole("Admin", "Owner", "Manager"),
    async (req, res) => {
      try {
        const containerId = parseInt(req.params.id);
        if (isNaN(containerId)) {
          return res.status(400).json({ message: "Invalid container ID" });
        }

        // Get container
        const container = await storage.getContainerById(containerId);
        if (!container) {
          return res.status(404).json({ message: "Container not found" });
        }

        // Verify container belongs to current company
        if (container.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({
            message: "Access denied: Container belongs to a different company",
          });
        }

        // Check if container is offloaded
        if (container.status !== "OFFLOADED") {
          return res
            .status(400)
            .json({ message: "Container is not offloaded" });
        }

        // Get offload record (may not exist for old offloads)
        const [offloadRecord] = await db
          .select()
          .from(containerOffloads)
          .where(eq(containerOffloads.containerId, containerId))
          .limit(1);

        // If no offload record exists, just change status back and return
        if (!offloadRecord) {
          await db
            .update(containers)
            .set({ status: "OTW" })
            .where(eq(containers.id, containerId));
          
          return res.json({ 
            message: "Container status reversed to OTW (no offload record to clean up)" 
          });
        }

        await db.transaction(async (tx) => {
          // Try to get stored offload items first (new approach - exact values)
          const storedOffloadItems = await tx
            .select()
            .from(containerOffloadItems)
            .where(eq(containerOffloadItems.offloadId, offloadRecord.id));

          // Use stored offload items if available (lossless reversal)
          if (storedOffloadItems.length > 0) {
            for (const offloadItem of storedOffloadItems) {
              await reverseInventoryByExactValue(
                tx,
                offloadRecord.locationId,
                offloadItem.stockItemId,
                parseFloat(offloadItem.quantity),
                parseFloat(offloadItem.totalValue),
              );
            }
            
            // Delete stored offload items
            await tx
              .delete(containerOffloadItems)
              .where(eq(containerOffloadItems.offloadId, offloadRecord.id));
          } else {
            // Fallback for old offloads without stored items (legacy approach)
            const pos = await storage.getPurchaseOrdersByContainer(containerId);
            const allLineItems: any[] = [];
            for (const po of pos) {
              const items = await storage.getLineItemsByPO(po.id);
              allLineItems.push(...items);
            }
            
            const additionalCostPerBale = parseFloat(offloadRecord.additionalCostPerBale || "0");
            const itemsMap = new Map<number, { 
              stockItemId: number; 
              totalQuantity: number; 
              weightedRateSum: number;
            }>();
            
            for (const item of allLineItems) {
              const stockItemId = item.stockItemId;
              if (!stockItemId || stockItemId === 0) continue;
              
              const quantity = parseFloat(item.quantity);
              const rate = parseFloat(item.rate);
              
              if (itemsMap.has(stockItemId)) {
                const existing = itemsMap.get(stockItemId)!;
                existing.totalQuantity += quantity;
                existing.weightedRateSum += rate * quantity;
              } else {
                itemsMap.set(stockItemId, {
                  stockItemId,
                  totalQuantity: quantity,
                  weightedRateSum: rate * quantity,
                });
              }
            }

            for (const [stockItemId, data] of Array.from(itemsMap)) {
              const estimatedValue = data.weightedRateSum + data.totalQuantity * additionalCostPerBale;
              await reverseInventoryByExactValue(
                tx,
                offloadRecord.locationId,
                stockItemId,
                data.totalQuantity,
                estimatedValue,
              );
            }
          }

          // Delete OFFLOAD-related vouchers only (DUTY-, OFFICE-, TRANS-, CHG- prefixes)
          // DO NOT delete PO vouchers that track supplier balances
          const containerVouchers = await tx
            .select()
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, req.session.currentCompanyId!),
                like(sql`LOWER(${vouchers.description})`, `%container ${(container.containerNumber || "").toLowerCase()}%`),
                sql`(
                  ${vouchers.voucherNumber} LIKE 'DUTY-%' OR
                  ${vouchers.voucherNumber} LIKE 'OFFICE-%' OR
                  ${vouchers.voucherNumber} LIKE 'TRANS-%' OR
                  ${vouchers.voucherNumber} LIKE 'CHG-%' OR
                  ${vouchers.voucherNumber} LIKE 'XFER-%'
                )`,
              ),
            );

          for (const voucher of containerVouchers) {
            // Delete voucher entries first
            await tx
              .delete(voucherEntries)
              .where(eq(voucherEntries.voucherId, voucher.id));

            // Delete the voucher
            await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));

          }

          // Delete the offload record
          await tx
            .delete(containerOffloads)
            .where(eq(containerOffloads.id, offloadRecord.id));

          // Update container status back to OTW
          // The import cycle balance uses container.status to filter which containers to include
          // When status changes to OTW, the container's grandTotal is counted in Stock OTW
          await tx
            .update(containers)
            .set({ status: "OTW" })
            .where(eq(containers.id, containerId));
        });

        res.json({
          success: true,
          message: "Container offload reversed successfully",
        });
      } catch (error: any) {
        console.error("Reverse offload error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Edit container offload (Admin only)
  app.patch(
    "/api/containers/:id/offload",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const containerId = parseInt(req.params.id);
        if (isNaN(containerId)) {
          return res.status(400).json({ message: "Invalid container ID" });
        }

        // Get container
        const container = await storage.getContainerById(containerId);
        if (!container) {
          return res.status(404).json({ message: "Container not found" });
        }

        // Verify container belongs to current company
        if (container.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({
            message: "Access denied: Container belongs to a different company",
          });
        }

        // Check if container is offloaded
        if (container.status !== "OFFLOADED") {
          return res
            .status(400)
            .json({ message: "Container must be offloaded to edit" });
        }

        // Validate request body
        const validation = offloadRequestSchema.extend({
          dutiesAccountId: z.number().optional(),
          officeChargesAccountId: z.number().optional(),
          officeChargesCashAccountId: z.number().optional(),
          transportAccountId: z.number().optional(),
          additionalCharges: z.array(z.object({
            description: z.string(),
            amount: z.number(),
            ledgerAccountId: z.number(),
          })).optional(),
        }).safeParse(req.body);

        if (!validation.success) {
          return res.status(400).json({ errors: validation.error.errors });
        }

        const {
          locationId,
          offloadDate,
          duties,
          dutiesAccountId,
          officeCharges,
          officeChargesAccountId,
          officeChargesCashAccountId,
          transferCharges,
          transportFees,
          transportAccountId,
          additionalCharges = [],
        } = validation.data;

        // Get current offload record
        const [currentOffload] = await db
          .select()
          .from(containerOffloads)
          .where(eq(containerOffloads.containerId, containerId))
          .limit(1);

        if (!currentOffload) {
          return res.status(404).json({ message: "Offload record not found" });
        }

        await db.transaction(async (tx) => {
          // If location changed, need to move inventory
          if (locationId !== currentOffload.locationId) {
            const pos = await storage.getPurchaseOrdersByContainer(containerId);
            for (const po of pos) {
              const lineItems = await storage.getLineItemsByPO(po.id);
              for (const item of lineItems) {
                // Move inventory from old location to new location
                const removeResult = await adjustInventory(
                  tx,
                  currentOffload.locationId,
                  item.stockItemId,
                  -parseFloat(item.quantity),
                  req.session.currentCompanyId!,
                );
                if (removeResult.previousQuantity !== 0) {
                  await adjustInventory(
                    tx,
                    locationId,
                    item.stockItemId,
                    parseFloat(item.quantity),
                    req.session.currentCompanyId!,
                    removeResult.averageRate,
                  );
                }
              }
            }
          }

          // Recalculate charges
          const additionalChargesTotal = additionalCharges.reduce((sum, charge) => sum + charge.amount, 0);
          const totalCharges = 
            parseFloat(duties) + 
            parseFloat(officeCharges) + 
            parseFloat(transferCharges) + 
            parseFloat(transportFees) +
            additionalChargesTotal;

          const totalBales = parseFloat(currentOffload.totalBales);
          // Round to 2 decimal places to prevent floating-point accumulation errors
          const additionalCostPerBale = totalBales > 0 ? Math.round((totalCharges / totalBales) * 100) / 100 : 0;

          // Update offload record
          await tx
            .update(containerOffloads)
            .set({
              locationId,
              duties,
              officeCharges,
              transferCharges,
              transportFees,
              totalCharges: totalCharges.toString(),
              additionalCostPerBale: additionalCostPerBale.toString(),
              offloadedAt: offloadDate ? new Date(offloadDate) : currentOffload.offloadedAt,
            })
            .where(eq(containerOffloads.id, currentOffload.id));

          // Delete old vouchers and create new ones with updated charges
          const containerVouchers = await tx
            .select()
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, req.session.currentCompanyId!),
                sql`${vouchers.description} LIKE '%Container ${container.containerNumber}%'`,
              ),
            );

          for (const voucher of containerVouchers) {
            await tx
              .delete(voucherEntries)
              .where(eq(voucherEntries.voucherId, voucher.id));
            await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));

          }

          // Create new voucher entries with updated charges (similar to offloadContainer logic)
          // This is a simplified version - you may want to call the full offload logic
          // For now, we'll just update the records
        });

        res.json({
          success: true,
          message: "Container offload updated successfully",
        });
      } catch (error: any) {
        console.error("Edit offload error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Get a single purchase order by ID (Admin/Owner only)
  app.get("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }

      // Check role permissions - only Admin and Owner can view purchase orders
      const userRole = req.session.currentRole;
      if (!userRole || (userRole !== "Admin" && userRole !== "Owner")) {
        return res
          .status(403)
          .json({ message: "Only Admin and Owner can view purchase orders" });
      }

      const po = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, id),
      });

      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      // Verify purchase order belongs to current company
      if (po.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message:
              "Access denied: Purchase order belongs to a different company",
          });
      }

      // Get line items for this PO
      const lineItems = await db.query.poLineItems.findMany({
        where: eq(poLineItems.poId, id),
      });
      
      // Get supplier info
      const supplier = await db.query.suppliers.findFirst({
        where: eq(suppliers.id, po.supplierId),
      });
      
      // Get container info
      const container = await db.query.containers.findFirst({
        where: eq(containers.id, po.containerId),
      });

      // Check if PO has no charges stored - if so, fetch from containerCharges table
      const poFreight = parseFloat(po.freight?.toString() || '0');
      const poSurcharge = parseFloat(po.surcharge?.toString() || '0');
      const poFumigation = parseFloat(po.fumigation?.toString() || '0');
      const poDocCharges = parseFloat(po.documentCharges?.toString() || '0');
      const poDiscount = parseFloat(po.discount?.toString() || '0');
      const poOtherCharges = parseFloat(po.otherCharges?.toString() || '0');
      
      let finalCharges = {
        freight: poFreight.toString(),
        surcharge: poSurcharge.toString(),
        fumigation: poFumigation.toString(),
        documentCharges: poDocCharges.toString(),
        discount: poDiscount.toString(),
        otherCharges: poOtherCharges.toString(),
      };

      // If all charges are 0 AND charges haven't been explicitly edited, try to fetch from containerCharges table
      // This ensures that if user edited charges to 0, we respect that instead of showing container charges
      if (poFreight === 0 && poSurcharge === 0 && poFumigation === 0 && 
          poDocCharges === 0 && poDiscount === 0 && poOtherCharges === 0 &&
          !po.chargesEdited) {
        const containerChargesData = await db.query.containerCharges.findMany({
          where: eq(containerCharges.containerId, po.containerId),
        });
        
        for (const charge of containerChargesData) {
          const amount = parseFloat(charge.amount?.toString() || '0');
          switch (charge.chargeType) {
            case 'Freight':
              finalCharges.freight = Math.abs(amount).toString();
              break;
            case 'Surcharge':
              finalCharges.surcharge = Math.abs(amount).toString();
              break;
            case 'Fumigation':
              finalCharges.fumigation = Math.abs(amount).toString();
              break;
            case 'Document Charges':
              finalCharges.documentCharges = Math.abs(amount).toString();
              break;
            case 'Discount':
              finalCharges.discount = Math.abs(amount).toString();
              break;
            case 'Other Charges':
              finalCharges.otherCharges = Math.abs(amount).toString();
              break;
          }
        }
      }

      res.json({
        ...po,
        items: lineItems,
        supplierName: supplier?.legalName || 'Unknown Supplier',
        supplierCode: supplier?.code || '',
        containerNumber: container?.containerNumber || '',
        ...finalCharges,
        itemsTotal: po.itemsTotal?.toString() || '0',
      });
    } catch (error: any) {
      console.error("Get PO error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Update a purchase order with line items
  app.patch("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }

      const existingPO = await storage.getPurchaseOrderById(id);
      if (!existingPO) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      // Verify purchase order belongs to current company
      if (existingPO.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message:
              "Access denied: Purchase order belongs to a different company",
          });
      }

      // Check edit permissions based on role
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Only Admin and Owner can edit purchase orders
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res
          .status(403)
          .json({ message: "Only Admin and Owner can edit purchase orders" });
      }

      // Check if container is offloaded - if so, prevent stock item changes that would cause import cycle imbalance
      const container = await storage.getContainerById(existingPO.containerId);
      if (container?.status === "OFFLOADED" && req.body.items && Array.isArray(req.body.items)) {
        const existingLineItems = await storage.getLineItemsByPO(id);
        const existingStockItemIds = new Set(existingLineItems.map(item => item.stockItemId));
        
        // Check if any stock item is being changed (swapped)
        // Normalize stockItemId to number to avoid type mismatch if client sends strings
        for (const item of req.body.items) {
          const stockItemId = item.stockItemId ? Number(item.stockItemId) : null;
          if (stockItemId && !existingStockItemIds.has(stockItemId)) {
            return res.status(400).json({
              message: "Cannot change stock items on an offloaded container. The inventory has already been added with the original items. Changing stock items would cause an import cycle imbalance. To fix this, first reverse the container offload, then edit the PO, then re-offload."
            });
          }
        }
      }

      // Update line items if provided
      if (req.body.items && Array.isArray(req.body.items)) {
        // Get existing line items to preserve values when only name changes
        const existingLineItems = await storage.getLineItemsByPO(id);
        const existingItemsMap = new Map(existingLineItems.map(item => [item.id, item]));
        
        // Calculate new items total, preserving existing quantity/rate if not provided
        let itemsTotal = 0;
        const newItems = req.body.items.map((item: any) => {
          // Find existing item by id to preserve values
          // Convert item.id to number for consistent Map lookup (request may send string or number)
          const itemIdNum = item.id ? Number(item.id) : null;
          const existingItem = itemIdNum ? existingItemsMap.get(itemIdNum) : null;
          
          // Use provided values, or fall back to existing values, or default to "0"
          // Also handle empty string as missing value
          const hasQuantity = item.quantity !== undefined && item.quantity !== null && item.quantity !== "";
          const hasRate = item.rate !== undefined && item.rate !== null && item.rate !== "";
          const quantity = hasQuantity ? item.quantity.toString() : (existingItem?.quantity ?? "0");
          const rate = hasRate ? item.rate.toString() : (existingItem?.rate ?? "0");
          const lineTotal = parseFloat(quantity) * parseFloat(rate);
          itemsTotal += lineTotal;
          
          return {
            poId: id,
            stockItemId: item.stockItemId ?? existingItem?.stockItemId,
            itemName: item.itemName ?? existingItem?.itemName,
            quantity: quantity,
            rate: rate,
            lineTotal: lineTotal.toFixed(2),
          };
        });

        // Delete existing line items and create new ones in a transaction
        await db.transaction(async (tx) => {
          // Delete old line items
          await tx.delete(poLineItems).where(eq(poLineItems.poId, id));
          
          // Insert new line items
          if (newItems.length > 0) {
            await tx.insert(poLineItems).values(newItems);
          }
          
          // Update PO with new items total and charges
          // Use ?? to correctly handle explicit zero values from the request
          const freight = parseFloat(req.body.freight ?? existingPO.freight ?? "0");
          const surcharge = parseFloat(req.body.surcharge ?? existingPO.surcharge ?? "0");
          const fumigation = parseFloat(req.body.fumigation ?? existingPO.fumigation ?? "0");
          const documentCharges = parseFloat(req.body.documentCharges ?? existingPO.documentCharges ?? "0");
          const discount = parseFloat(req.body.discount ?? existingPO.discount ?? "0");
          const otherCharges = parseFloat(req.body.otherCharges ?? existingPO.otherCharges ?? "0");
          
          // Check if any charge field was explicitly provided in the request
          const chargesWereEdited = req.body.freight !== undefined || 
                                    req.body.surcharge !== undefined || 
                                    req.body.fumigation !== undefined || 
                                    req.body.documentCharges !== undefined || 
                                    req.body.discount !== undefined || 
                                    req.body.otherCharges !== undefined;
          
          await tx.update(purchaseOrders)
            .set({ 
              itemsTotal: itemsTotal.toFixed(2),
              freight: freight.toFixed(2),
              surcharge: surcharge.toFixed(2),
              fumigation: fumigation.toFixed(2),
              documentCharges: documentCharges.toFixed(2),
              discount: discount.toFixed(2),
              otherCharges: otherCharges.toFixed(2),
              chargesEdited: chargesWereEdited ? true : existingPO.chargesEdited,
              poNumber: req.body.poNumber || existingPO.poNumber,
              currency: req.body.currency || existingPO.currency,
              status: req.body.status || existingPO.status,
            })
            .where(eq(purchaseOrders.id, id));
            
          // Also update container's totals if applicable
          const container = await storage.getContainerById(existingPO.containerId);
          if (container) {
            // Get all POs for this container and recalculate totals
            const allPOs = await storage.getAllPurchaseOrders(existingPO.companyId);
            const containerPOs = allPOs.filter((po: any) => po.containerId === existingPO.containerId);
            let totalItemsCost = 0;
            let totalCharges = 0;
            
            for (const po of containerPOs) {
              if (po.id === id) {
                // Use the new values for this PO
                totalItemsCost += itemsTotal;
                totalCharges += freight + surcharge + fumigation + documentCharges - discount + otherCharges;
              } else {
                totalItemsCost += parseFloat(po.itemsTotal || "0");
                totalCharges += parseFloat(po.freight || "0") + parseFloat(po.surcharge || "0") + parseFloat(po.fumigation || "0") + parseFloat(po.documentCharges || "0") - parseFloat(po.discount || "0") + parseFloat(po.otherCharges || "0");
              }
            }
            
            // Update container totals
            const chargesTotal = totalCharges;
            await tx.update(containers)
              .set({
                itemsTotal: totalItemsCost.toFixed(2),
                chargesTotal: chargesTotal.toFixed(2),
                grandTotal: (totalItemsCost + chargesTotal).toFixed(2),
              })
              .where(eq(containers.id, existingPO.containerId));
          }
          
          // Update the associated voucher with new total (items + all charges)
          if (existingPO.voucherId) {
            const poGrandTotal = itemsTotal + freight + surcharge + fumigation + documentCharges - discount + otherCharges;
            
            // Update voucher total amount
            await tx.update(vouchers)
              .set({ totalAmount: poGrandTotal.toFixed(2) })
              .where(eq(vouchers.id, existingPO.voucherId));
            
            // Update voucher entries - both debit (purchases) and credit (supplier)
            const existingEntries = await tx
              .select()
              .from(voucherEntries)
              .where(eq(voucherEntries.voucherId, existingPO.voucherId));
            
            for (const entry of existingEntries) {
              if (parseFloat(entry.debitAmount || "0") > 0) {
                // Update debit entry (Purchases expense)
                await tx.update(voucherEntries)
                  .set({ debitAmount: poGrandTotal.toFixed(2) })
                  .where(eq(voucherEntries.id, entry.id));
              } else if (parseFloat(entry.creditAmount || "0") > 0) {
                // Update credit entry (Supplier payable)
                await tx.update(voucherEntries)
                  .set({ creditAmount: poGrandTotal.toFixed(2) })
                  .where(eq(voucherEntries.id, entry.id));
              }
            }

            // ── Inter-company sync: update the matching INTERCO-PARENT voucher in the parent company ──
            await syncIntercoParentVoucher(tx, existingPO.poNumber, poGrandTotal);
          }
          
          // Sync container_charges table when PO charges are edited
          if (chargesWereEdited && existingPO.containerId) {
            const chargeTypeMap = [
              { field: 'freight', chargeType: 'Freight', amount: freight },
              { field: 'surcharge', chargeType: 'Surcharge', amount: surcharge },
              { field: 'fumigation', chargeType: 'Fumigation', amount: fumigation },
              { field: 'documentCharges', chargeType: 'Document Charges', amount: documentCharges },
              { field: 'discount', chargeType: 'Discount', amount: -discount }, // Discount stored as negative
              { field: 'otherCharges', chargeType: 'Other Charges', amount: otherCharges },
            ];
            
            for (const { chargeType, amount } of chargeTypeMap) {
              // Find existing container charge entry
              const existingCharge = await tx
                .select()
                .from(containerCharges)
                .where(and(
                  eq(containerCharges.containerId, existingPO.containerId),
                  eq(containerCharges.chargeType, chargeType)
                ))
                .limit(1);
              
              if (amount === 0) {
                // Delete entry if charge is 0
                if (existingCharge.length > 0) {
                  await tx.delete(containerCharges)
                    .where(eq(containerCharges.id, existingCharge[0].id));
                }
              } else {
                // Upsert: update if exists, insert if not
                if (existingCharge.length > 0) {
                  await tx.update(containerCharges)
                    .set({ amount: amount.toFixed(2) })
                    .where(eq(containerCharges.id, existingCharge[0].id));
                } else {
                  await tx.insert(containerCharges).values({
                    containerId: existingPO.containerId,
                    chargeType: chargeType,
                    amount: amount.toFixed(2),
                  });
                }
              }
            }
          }
        });
        
        // Get updated PO with items
        const updatedPO = await storage.getPurchaseOrderById(id);
        const lineItems = await storage.getLineItemsByPO(id);
        const supplier = await storage.getSupplierById(existingPO.supplierId);
        const container = await storage.getContainerById(existingPO.containerId);
        
        return res.json({
          ...updatedPO,
          items: lineItems,
          supplierName: supplier?.legalName || 'Unknown Supplier',
          supplierCode: supplier?.code || '',
          containerNumber: container?.containerNumber || '',
        });
      }

      // Only allow updating specific fields if no items provided
      const allowedUpdates: Partial<InsertPurchaseOrder> = {};
      if (req.body.poNumber !== undefined)
        allowedUpdates.poNumber = req.body.poNumber;
      if (req.body.itemsTotal !== undefined)
        allowedUpdates.itemsTotal = req.body.itemsTotal;
      if (req.body.currency !== undefined)
        allowedUpdates.currency = req.body.currency;
      if (req.body.status !== undefined)
        allowedUpdates.status = req.body.status;
      if (req.body.freight !== undefined)
        allowedUpdates.freight = req.body.freight;
      if (req.body.surcharge !== undefined)
        allowedUpdates.surcharge = req.body.surcharge;
      if (req.body.fumigation !== undefined)
        allowedUpdates.fumigation = req.body.fumigation;
      if (req.body.documentCharges !== undefined)
        allowedUpdates.documentCharges = req.body.documentCharges;
      if (req.body.discount !== undefined)
        allowedUpdates.discount = req.body.discount;
      if (req.body.otherCharges !== undefined)
        allowedUpdates.otherCharges = req.body.otherCharges;
      
      // Set chargesEdited flag if any charge field was modified
      const chargesWereEdited = req.body.freight !== undefined || 
                                req.body.surcharge !== undefined || 
                                req.body.fumigation !== undefined || 
                                req.body.documentCharges !== undefined || 
                                req.body.discount !== undefined || 
                                req.body.otherCharges !== undefined;
      if (chargesWereEdited) {
        allowedUpdates.chargesEdited = true;
      }

      // Check if any charges changed - need to update voucher entries
      const newFreight = parseFloat(req.body.freight ?? existingPO.freight ?? "0");
      const newSurcharge = parseFloat(req.body.surcharge ?? existingPO.surcharge ?? "0");
      const newFumigation = parseFloat(req.body.fumigation ?? existingPO.fumigation ?? "0");
      const newDocumentCharges = parseFloat(req.body.documentCharges ?? existingPO.documentCharges ?? "0");
      const newDiscount = parseFloat(req.body.discount ?? existingPO.discount ?? "0");
      const newOtherCharges = parseFloat(req.body.otherCharges ?? existingPO.otherCharges ?? "0");
      const newItemsTotal = parseFloat(req.body.itemsTotal ?? existingPO.itemsTotal ?? "0");
      const oldFreight = parseFloat(existingPO.freight || "0");
      const oldSurcharge = parseFloat(existingPO.surcharge || "0");
      const oldFumigation = parseFloat(existingPO.fumigation || "0");
      const oldDocumentCharges = parseFloat(existingPO.documentCharges || "0");
      const oldDiscount = parseFloat(existingPO.discount || "0");
      const oldOtherCharges = parseFloat(existingPO.otherCharges || "0");
      const oldItemsTotal = parseFloat(existingPO.itemsTotal || "0");
      
      const newGrandTotal = newItemsTotal + newFreight + newSurcharge + newFumigation + newDocumentCharges - newDiscount + newOtherCharges;
      const oldGrandTotal = oldItemsTotal + oldFreight + oldSurcharge + oldFumigation + oldDocumentCharges - oldDiscount + oldOtherCharges;
      
      // Update PO
      const updated = await storage.updatePurchaseOrder(id, allowedUpdates);
      
      // If the grand total changed, update voucher entries to reflect new supplier balance
      if (Math.abs(newGrandTotal - oldGrandTotal) > 0.001 && existingPO.voucherId) {
        await db.transaction(async (tx) => {
          // Update voucher total amount
          await tx.update(vouchers)
            .set({ totalAmount: newGrandTotal.toFixed(2) })
            .where(eq(vouchers.id, existingPO.voucherId!));
          
          // Update voucher entries - both debit (purchases) and credit (supplier)
          const existingEntries = await tx
            .select()
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, existingPO.voucherId!));
          
          for (const entry of existingEntries) {
            if (parseFloat(entry.debitAmount || "0") > 0) {
              // Update debit entry (Purchases expense)
              await tx.update(voucherEntries)
                .set({ debitAmount: newGrandTotal.toFixed(2) })
                .where(eq(voucherEntries.id, entry.id));
            } else if (parseFloat(entry.creditAmount || "0") > 0) {
              // Update credit entry (Supplier payable)
              await tx.update(voucherEntries)
                .set({ creditAmount: newGrandTotal.toFixed(2) })
                .where(eq(voucherEntries.id, entry.id));
            }
          }

          // ── Inter-company sync: update the matching INTERCO-PARENT voucher in the parent company ──
          await syncIntercoParentVoucher(tx, existingPO.poNumber, newGrandTotal);
          
          // Update container totals if applicable
          const container = await storage.getContainerById(existingPO.containerId);
          if (container) {
            // Get all POs for this container and recalculate totals
            const allPOs = await storage.getAllPurchaseOrders(existingPO.companyId);
            const containerPOs = allPOs.filter((po: any) => po.containerId === existingPO.containerId);
            let totalItemsCost = 0;
            let totalCharges = 0;
            
            for (const po of containerPOs) {
              if (po.id === id) {
                // Use the new values for this PO
                totalItemsCost += newItemsTotal;
                totalCharges += newFreight + newSurcharge + newFumigation + newDocumentCharges - newDiscount + newOtherCharges;
              } else {
                totalItemsCost += parseFloat(po.itemsTotal || "0");
                totalCharges += parseFloat(po.freight || "0") + parseFloat(po.surcharge || "0") + parseFloat(po.fumigation || "0") + parseFloat(po.documentCharges || "0") - parseFloat(po.discount || "0") + parseFloat(po.otherCharges || "0");
              }
            }
            
            // Update container totals
            const chargesTotal = totalCharges;
            await tx.update(containers)
              .set({
                itemsTotal: totalItemsCost.toFixed(2),
                chargesTotal: chargesTotal.toFixed(2),
                grandTotal: (totalItemsCost + chargesTotal).toFixed(2),
              })
              .where(eq(containers.id, existingPO.containerId));
          }
          
          // Sync container_charges table when PO charges are edited
          if (chargesWereEdited && existingPO.containerId) {
            const chargeTypeMap = [
              { field: 'freight', chargeType: 'Freight', amount: newFreight },
              { field: 'surcharge', chargeType: 'Surcharge', amount: newSurcharge },
              { field: 'fumigation', chargeType: 'Fumigation', amount: newFumigation },
              { field: 'documentCharges', chargeType: 'Document Charges', amount: newDocumentCharges },
              { field: 'discount', chargeType: 'Discount', amount: -newDiscount }, // Discount stored as negative
              { field: 'otherCharges', chargeType: 'Other Charges', amount: newOtherCharges },
            ];
            
            for (const { chargeType, amount } of chargeTypeMap) {
              // Find existing container charge entry
              const existingCharge = await tx
                .select()
                .from(containerCharges)
                .where(and(
                  eq(containerCharges.containerId, existingPO.containerId),
                  eq(containerCharges.chargeType, chargeType)
                ))
                .limit(1);
              
              if (amount === 0) {
                // Delete entry if charge is 0
                if (existingCharge.length > 0) {
                  await tx.delete(containerCharges)
                    .where(eq(containerCharges.id, existingCharge[0].id));
                }
              } else {
                // Upsert: update if exists, insert if not
                if (existingCharge.length > 0) {
                  await tx.update(containerCharges)
                    .set({ amount: amount.toFixed(2) })
                    .where(eq(containerCharges.id, existingCharge[0].id));
                } else {
                  await tx.insert(containerCharges).values({
                    containerId: existingPO.containerId,
                    chargeType: chargeType,
                    amount: amount.toFixed(2),
                  });
                }
              }
            }
          }
        });
      } else if (chargesWereEdited && existingPO.containerId) {
        // If charges were edited but grand total didn't change (or no voucher), still sync container_charges
        const chargeTypeMap = [
          { field: 'freight', chargeType: 'Freight', amount: newFreight },
          { field: 'surcharge', chargeType: 'Surcharge', amount: newSurcharge },
          { field: 'fumigation', chargeType: 'Fumigation', amount: newFumigation },
          { field: 'documentCharges', chargeType: 'Document Charges', amount: newDocumentCharges },
          { field: 'discount', chargeType: 'Discount', amount: -newDiscount }, // Discount stored as negative
          { field: 'otherCharges', chargeType: 'Other Charges', amount: newOtherCharges },
        ];
        
        for (const { chargeType, amount } of chargeTypeMap) {
          // Find existing container charge entry
          const existingCharge = await db
            .select()
            .from(containerCharges)
            .where(and(
              eq(containerCharges.containerId, existingPO.containerId),
              eq(containerCharges.chargeType, chargeType)
            ))
            .limit(1);
          
          if (amount === 0) {
            // Delete entry if charge is 0
            if (existingCharge.length > 0) {
              await db.delete(containerCharges)
                .where(eq(containerCharges.id, existingCharge[0].id));
            }
          } else {
            // Upsert: update if exists, insert if not
            if (existingCharge.length > 0) {
              await db.update(containerCharges)
                .set({ amount: amount.toFixed(2) })
                .where(eq(containerCharges.id, existingCharge[0].id));
            } else {
              await db.insert(containerCharges).values({
                containerId: existingPO.containerId,
                chargeType: chargeType,
                amount: amount.toFixed(2),
              });
            }
          }
        }
      }
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a purchase order (Admin only)
  app.delete(
    "/api/purchase-orders/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid purchase order ID" });
        }

        const existingPO = await storage.getPurchaseOrderById(id);
        if (!existingPO) {
          return res.status(404).json({ message: "Purchase order not found" });
        }

        // Verify purchase order belongs to current company
        if (existingPO.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Purchase order belongs to a different company",
            });
        }

        await storage.deletePurchaseOrder(id);
        res.json({ message: "Purchase order deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Delete a container (Admin only)
  app.delete(
    "/api/containers/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid container ID" });
        }

        const existingContainer = await storage.getContainerById(id);
        if (!existingContainer) {
          return res.status(404).json({ message: "Container not found" });
        }

        // Verify container belongs to current company
        if (existingContainer.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Container belongs to a different company",
            });
        }

        await storage.deleteContainer(id);
        res.json({ message: "Container deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Backfill voucher entries for existing POs
  app.post("/api/po-import/backfill", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all POs without voucher IDs
      const allPOs = await storage.getAllPurchaseOrders(
        req.session.currentCompanyId!,
      );
      const posWithoutVouchers = allPOs.filter((po: any) => !po.voucherId);

      if (posWithoutVouchers.length === 0) {
        return res.json({
          message: "No POs need backfilling",
          count: 0,
        });
      }

      // Get or create "Purchases" ledger account for double-entry bookkeeping
      let purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES", req.session.currentCompanyId!);
      if (!purchasesAccount) {
        purchasesAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "PURCHASES",
          name: "Purchases",
          accountType: "Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
          active: true,
        });
      }

      // Get all containers to lookup import dates
      const allContainers = await storage.getAllContainers(
        req.session.currentCompanyId!,
      );
      const containerMap = new Map(allContainers.map((c) => [c.id, c]));

      let backfilledCount = 0;

      for (const po of posWithoutVouchers) {
        const container = containerMap.get(po.containerId);
        if (!container) continue;
        const backfillSupplier = po.supplierId ? await storage.getSupplierById(po.supplierId) : null;

        // Create voucher for this PO with double-entry bookkeeping
        const voucher = await storage.createVoucher({
          companyId: req.session.currentCompanyId!,
          currency: "USD",
          voucherNumber: `PO-${po.poNumber}-BACKFILL-${Date.now()}`,
          voucherType: "Purchase",
          voucherDate: container.importDate,
          description: `${container.containerNumber} ${backfillSupplier?.legalName || 'Unknown Supplier'}`,
          totalAmount: po.itemsTotal || "0",
          optional: false,
          sourceModule: "ERP",
        });

        // Debit: Purchases account (Expense increases)
        await storage.createVoucherEntry({
          voucherId: voucher.id,
          ledgerAccountId: purchasesAccount.id,
          debitAmount: po.itemsTotal || "0",
          creditAmount: "0",
          narration: `PO ${po.poNumber} - Container ${container.containerNumber} (Backfilled)`,
        });

        // Credit: Supplier account (Accounts Payable increases)
        await storage.createVoucherEntry({
          voucherId: voucher.id,
          supplierId: po.supplierId,
          debitAmount: "0",
          creditAmount: po.itemsTotal || "0",
          narration: `PO ${po.poNumber} - Container ${container.containerNumber} (Backfilled)`,
        });

        // Update PO with voucher ID
        await storage.updatePurchaseOrder(po.id, {
          voucherId: voucher.id,
        });

        backfilledCount++;
      }

      res.json({
        message: "Backfill completed successfully",
        count: backfilledCount,
      });
    } catch (error: any) {
      console.error("Backfill error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Backfill voucher entries for existing sales
  app.post("/api/sales-import/backfill", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationCashAccountMap } = req.body;

      if (!locationCashAccountMap || typeof locationCashAccountMap !== 'object') {
        return res.status(400).json({ 
          message: "Location-to-cash-account mapping is required. Please specify which cash account to use for each location's sales." 
        });
      }

      // Validate all cash accounts belong to this company
      const cashAccountIds = Object.values(locationCashAccountMap) as number[];
      for (const cashAccountId of cashAccountIds) {
        const cashAccount = await storage.getLedgerAccountById(cashAccountId);
        if (!cashAccount || cashAccount.companyId !== req.session.currentCompanyId) {
          return res.status(400).json({ message: `Invalid cash account ID: ${cashAccountId}` });
        }
      }

      // Get or create "Sales Revenue" ledger account
      let salesRevenueAccount = await storage.getLedgerAccountByCode("SALES_REV", req.session.currentCompanyId!);
      if (!salesRevenueAccount) {
        salesRevenueAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "SALES_REV",
          name: "Sales Revenue",
          accountType: "Income",
          subType: "Direct Income",
          openingBalance: "0",
          openingBalanceSide: "Cr",
          active: true,
        });
      }

      // Get all Sales vouchers for this company
      const allVouchers = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, req.session.currentCompanyId!),
            eq(vouchers.voucherType, "Sales")
          )
        )
        .execute();

      if (allVouchers.length === 0) {
        return res.json({
          message: "No sales vouchers found",
          count: 0,
        });
      }

      // Get all existing voucher entries for these vouchers
      const voucherIds = allVouchers.map(v => v.id);
      const existingEntries = await db
        .select()
        .from(voucherEntries)
        .where(inArray(voucherEntries.voucherId, voucherIds))
        .execute();

      // Create a map of voucher ID -> set of ledger account IDs
      const voucherLedgerMap = new Map<number, Set<number>>();
      for (const entry of existingEntries) {
        if (!voucherLedgerMap.has(entry.voucherId)) {
          voucherLedgerMap.set(entry.voucherId, new Set());
        }
        if (entry.ledgerAccountId) {
          voucherLedgerMap.get(entry.voucherId)!.add(entry.ledgerAccountId);
        }
      }

      // Filter to vouchers that need backfill (missing entries or have wrong structure)
      const vouchersNeedingBackfill = allVouchers.filter(v => {
        const ledgerIds = voucherLedgerMap.get(v.id) || new Set();
        const entryCount = ledgerIds.size;
        
        // Need backfill if:
        // 1. No entries at all
        // 2. Missing sales revenue
        // 3. Has wrong number of entries (old format had COGS/Inventory)
        const hasSalesRev = ledgerIds.has(salesRevenueAccount!.id);
        return entryCount === 0 || !hasSalesRev || entryCount !== 2;
      });

      if (vouchersNeedingBackfill.length === 0) {
        return res.json({
          message: "All sales vouchers already have complete accounting entries",
          count: 0,
        });
      }

      let backfilledCount = 0;
      let skippedCount = 0;

      for (const voucher of vouchersNeedingBackfill) {
        // Use a transaction to ensure atomic updates
        await db.transaction(async (tx) => {
          // Get all sales items for this voucher
          const items = await tx
            .select()
            .from(salesItems)
            .where(eq(salesItems.voucherId, voucher.id))
            .execute();

          if (items.length === 0) {
            console.warn(`No sales items found for voucher ${voucher.id}, skipping`);
            skippedCount++;
            return;
          }

          // Calculate total sales
          const totalSales = items.reduce((sum, item) => sum + parseFloat(item.totalSales || "0"), 0);

          if (totalSales === 0) {
            console.warn(`Voucher ${voucher.id} has zero sales, skipping`);
            skippedCount++;
            return;
          }

          // Determine location for this voucher by checking first sales item
          const firstItem = items[0];
          const stockItem = await tx
            .select()
            .from(stockItems)
            .where(eq(stockItems.id, firstItem.stockItemId))
            .limit(1);

          if (stockItem.length === 0) {
            console.warn(`Could not find stock item ${firstItem.stockItemId} for voucher ${voucher.id}, skipping`);
            skippedCount++;
            return;
          }

          // Find inventory record to determine location
          const inventoryRecords = await tx
            .select()
            .from(inventory)
            .where(eq(inventory.stockItemId, stockItem[0].id))
            .limit(1);

          if (inventoryRecords.length === 0) {
            console.warn(`Could not determine location for voucher ${voucher.id}, skipping`);
            skippedCount++;
            return;
          }

          const locationId = inventoryRecords[0].locationId;
          const cashAccountId = locationCashAccountMap[locationId];

          if (!cashAccountId) {
            console.warn(`No cash account mapped for location ${locationId}, skipping voucher ${voucher.id}`);
            skippedCount++;
            return;
          }

          // Delete all existing voucher entries (in case of old format)
          await tx
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, voucher.id));

          // Create new balanced entries (periodic inventory system)
          
          // Entry 1: Debit Cash Account (location-specific)
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: cashAccountId,
            debitAmount: totalSales.toFixed(2),
            creditAmount: "0",
            narration: `Cash from POS Sales - ${items.length} items (Backfilled)`,
          });

          // Entry 2: Credit Sales Revenue
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: salesRevenueAccount!.id,
            debitAmount: "0",
            creditAmount: totalSales.toFixed(2),
            narration: `Sales Revenue - ${items.length} items (Backfilled)`,
          });

          backfilledCount++;
        });
      }

      res.json({
        message: `Sales backfill completed. ${backfilledCount} vouchers updated, ${skippedCount} skipped.`,
        backfilledCount,
        skippedCount,
        totalSalesVouchers: allVouchers.length,
      });
    } catch (error: any) {
      console.error("Sales backfill error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Price import from Excel: preview matching by stock item code
  app.post("/api/containers/:id/price-import/preview", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseInt(req.params.id);
      const rows: { barcode: string; price: string }[] = req.body.rows || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      // Get all POs for this container
      const containerPOs = await storage.getPurchaseOrdersByContainer(containerId);
      if (containerPOs.length === 0) {
        return res.status(400).json({ message: "No purchase orders found for this container" });
      }
      const poIds = containerPOs.map((po: any) => po.id);

      // Load all line items for those POs in one query
      const allLineItems = poIds.length > 0
        ? await db.select({
            id: poLineItems.id,
            poId: poLineItems.poId,
            stockItemId: poLineItems.stockItemId,
            itemName: poLineItems.itemName,
            quantity: poLineItems.quantity,
            rate: poLineItems.rate,
            stockItemCode: stockItems.code,
          })
          .from(poLineItems)
          .leftJoin(stockItems, eq(poLineItems.stockItemId, stockItems.id))
          .where(inArray(poLineItems.poId, poIds))
        : [];

      const preview = await Promise.all(rows.map(async (row) => {
        const barcode = String(row.barcode || "").trim();
        const newRate = parseFloat(String(row.price || ""));
        if (!barcode) return { barcode, status: "invalid", itemName: null, currentRate: null, newRate: null };
        if (isNaN(newRate) || newRate < 0) return { barcode, status: "invalid_price", itemName: null, currentRate: null, newRate: null };

        // Find matching stock item (code or alias)
        const stockItem = await storage.getStockItemByCodeOrAlias(barcode, companyId);
        if (!stockItem) return { barcode, status: "not_found", itemName: null, currentRate: null, newRate };

        // Find matching line items in container POs
        const matched = allLineItems.filter((li: any) => li.stockItemId === stockItem.id);
        if (matched.length === 0) {
          return { barcode, itemName: stockItem.name, status: "not_in_container", currentRate: null, newRate };
        }

        const lineItemIds = matched.map((li: any) => li.id);
        const currentRate = parseFloat(matched[0].rate);
        const noChange = Math.abs(currentRate - newRate) < 0.001;

        return {
          barcode,
          itemName: matched[0].itemName || stockItem.name,
          lineItemIds,
          status: noChange ? "no_change" : "will_update",
          currentRate,
          newRate,
        };
      }));

      res.json({ preview });
    } catch (error: any) {
      console.error("Error in container price-import preview:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/containers/:id/price-import/apply", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseInt(req.params.id);
      const rows: { lineItemIds: number[]; newRate: number }[] = req.body.rows || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      // Collect all line item IDs to update
      const allLineItemIds = rows.flatMap((r) => r.lineItemIds || []);
      if (allLineItemIds.length === 0) return res.json({ success: true, updated: 0 });

      await db.transaction(async (tx) => {
        // Update each line item with its new rate
        for (const row of rows) {
          const newRate = parseFloat(String(row.newRate));
          if (isNaN(newRate) || newRate < 0) continue;
          for (const lineItemId of (row.lineItemIds || [])) {
            // Get the current line item to know its quantity
            const [item] = await tx.select().from(poLineItems).where(eq(poLineItems.id, lineItemId)).limit(1);
            if (!item) continue;
            const qty = parseFloat(item.quantity);
            const newLineTotal = qty * newRate;
            await tx.update(poLineItems)
              .set({ rate: newRate.toFixed(2), lineTotal: newLineTotal.toFixed(2) })
              .where(eq(poLineItems.id, lineItemId));
          }
        }

        // Recalculate itemsTotal for all affected POs, then the container
        const containerPOs = await storage.getPurchaseOrdersByContainer(containerId);
        const poIds = containerPOs.map((po: any) => po.id);

        let containerItemsTotal = 0;
        let containerChargesTotal = 0;

        for (const po of containerPOs) {
          const lineItems = await tx.select().from(poLineItems).where(eq(poLineItems.poId, po.id));
          const newItemsTotal = lineItems.reduce((sum: number, li: any) => sum + parseFloat(li.lineTotal || "0"), 0);
          await tx.update(purchaseOrders)
            .set({ itemsTotal: newItemsTotal.toFixed(2) })
            .where(eq(purchaseOrders.id, po.id));
          containerItemsTotal += newItemsTotal;
          containerChargesTotal += parseFloat(po.freight || "0") + parseFloat(po.surcharge || "0") + parseFloat(po.fumigation || "0") + parseFloat(po.documentCharges || "0") - parseFloat(po.discount || "0") + parseFloat(po.otherCharges || "0");
        }

        await tx.update(containers)
          .set({
            itemsTotal: containerItemsTotal.toFixed(2),
            chargesTotal: containerChargesTotal.toFixed(2),
            grandTotal: (containerItemsTotal + containerChargesTotal).toFixed(2),
          })
          .where(eq(containers.id, containerId));
      });

      res.json({ success: true, updated: allLineItemIds.length });
    } catch (error: any) {
      console.error("Error in container price-import apply:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get all accounts (combined from ledgers, bank accounts, fixed assets, and suppliers)
}
