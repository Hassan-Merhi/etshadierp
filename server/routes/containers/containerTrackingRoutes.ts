import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { upload, logAudit, getCurrentExchangeRate } from "../_helpers";
import {
  inventory,
  stockItems,
  stockGroups,
  stockItemCodeAliases,
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  containerSales,
  containerCharges,
  containerTrackingImportRowSchema,
  updateContainerTrackingSchema,
  bankAccounts,
  fixedAssets,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertStockItemCodeAliasSchema,
  insertContainerSchema,
  offloadRequestSchema,
  purchaseOrders,
  poLineItems,
  insertContainerSaleSchema,
  vouchers,
  voucherEntries,
  salesItems,
  suppliers,
  customers,
  locations,
  employees,
  userLocations,
  auditLog,
  interCompanyTransfers,
  insertInterCompanyTransferSchema,
  FEATURE_KEYS,
  ledgerAccounts,
  intercompanyPosConfigs,
  stockItemMergeLogs,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  desc,
  asc,
  lt,
  gt,
  ne,
  inArray,
  sql,
  isNull,
  isNotNull,
  not,
  gte,
  lte,
  like,
  ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../../inventoryHelper";

export function registerContainerTrackingRoutes(app: Express) {
  app.patch("/api/containers/:id/tracking", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }

      // Validate request body with Zod schema
      const parseResult = updateContainerTrackingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid tracking data",
          errors: parseResult.error.errors,
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
        docsSentDate,
        freightStatus,
        trackingLink,
        status,
        blDocs,
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
      if (offloadDate !== undefined) {
        updateData.offloadDate = offloadDate || null;
        // When an offload date is recorded, always force status to OFFLOADED
        // regardless of the container's previous location or status.
        if (offloadDate) updateData.status = "OFFLOADED";
      }
      if (agent !== undefined) updateData.agent = agent;
      if (dutyFee !== undefined) updateData.dutyFee = dutyFee || null;
      if (docReceived !== undefined) updateData.docReceived = docReceived;
      if (trackingDescription !== undefined) updateData.trackingDescription = trackingDescription;
      if (docsSentDate !== undefined) updateData.docsSentDate = docsSentDate || null;
      if (freightStatus !== undefined) updateData.freightStatus = freightStatus || null;
      if (trackingLink !== undefined) updateData.trackingLink = trackingLink || null;
      if (status !== undefined) updateData.status = status;
      if (blDocs !== undefined) updateData.blDocs = blDocs || null;

      await db
        .update(containers)
        .set(updateData)
        .where(and(eq(containers.id, id), eq(containers.companyId, req.session.currentCompanyId)));

      const [updated] = await db
        .select()
        .from(containers)
        .where(and(eq(containers.id, id), eq(containers.companyId, req.session.currentCompanyId)))
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
            errors.push(`Invalid row data for ${row.containerNumber || "unknown"}`);
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
            .where(
              and(
                eq(containers.containerNumber, containerNumber),
                eq(containers.companyId, req.session.currentCompanyId!)
              )
            )
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
              return `${fullYr}-${mo.padStart(2, "0")}-${dy.padStart(2, "0")}`;
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
          if (data.transporter && String(data.transporter) !== "[object Object]")
            updateData.transporter = String(data.transporter);
          const tFee = normNum(data.transportFee);
          if (tFee !== null) updateData.transportFee = tFee;
          if (data.numberPlate && String(data.numberPlate) !== "[object Object]")
            updateData.numberPlate = String(data.numberPlate);
          if (data.trackingLocation && String(data.trackingLocation) !== "[object Object]")
            updateData.trackingLocation = String(data.trackingLocation);
          const borderDateVal = normDate(data.borderDate);
          if (borderDateVal) updateData.borderDate = borderDateVal;
          const offloadDateVal = normDate(data.offloadDate);
          if (offloadDateVal) updateData.offloadDate = offloadDateVal;
          if (data.agent && String(data.agent) !== "[object Object]") updateData.agent = String(data.agent);
          const dFee = normNum(data.dutyFee);
          if (dFee !== null) updateData.dutyFee = dFee;
          if (data.docReceived !== undefined) {
            updateData.docReceived =
              data.docReceived === true ||
              data.docReceived === "Yes" ||
              data.docReceived === "yes" ||
              data.docReceived === "YES" ||
              data.docReceived === "TRUE" ||
              data.docReceived === "true";
          }
          if (data.trackingDescription && String(data.trackingDescription) !== "[object Object]")
            updateData.trackingDescription = String(data.trackingDescription);

          if (Object.keys(updateData).length > 0) {
            await db.update(containers).set(updateData).where(eq(containers.id, container.id));
            updated++;
          }
        } catch (rowError: any) {
          errors.push(`Error processing ${row.containerNumber || "unknown"}: ${rowError.message}`);
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }

      // Get the container
      const [container] = await db
        .select()
        .from(containers)
        .where(and(eq(containers.id, id), eq(containers.companyId, req.session.currentCompanyId)))
        .limit(1);

      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }

      const apiKey = process.env.CONTAINER_TRACKING_API_KEY;
      if (!apiKey) {
        return res.status(400).json({
          message: "Container tracking API not configured. Add CONTAINER_TRACKING_API_KEY to enable auto ETA updates.",
          needsSetup: true,
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
          instructions: "Set CONTAINER_TRACKING_API_KEY secret with your Terminal49 API key to enable auto ETA updates",
        });
      } catch (apiError: any) {
        return res.status(502).json({
          message: "Failed to fetch from tracking API",
          error: apiError.message,
        });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get POs for a container (for viewing details from dashboard)
}
