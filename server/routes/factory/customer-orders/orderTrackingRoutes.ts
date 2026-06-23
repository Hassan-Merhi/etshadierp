import { trackOneContainerById } from "../../../services/containerTrackingService";
import { parseId, parseOptionalId } from "../../../lib/parseId";
import { dispatchNotification } from "../../../lib/notificationService";
import { getClientDate } from "../../../lib/dateUtils";
import { getExportPriceVisibility } from "../../../helpers/exportVisibility";
import { sendWhatsAppFileToChatIdPos } from "../../../services/whatsappService";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import {
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
  recalculateOrderTotals,
} from "../_helpers";
import {
  factorySuppliers,
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryDailyUsages,
  factoryPressingBatches,
  factoryBales,
  factoryBaleSequences,
  factoryContainerCommissions,
  baleLabelPrints,
  stockItems,
  stockGroups,
  users,
  insertFactorySupplierSchema,
  insertFactoryCategorySchema,
  insertFactoryBaleProductSchema,
  insertFactoryContainerSchema,
  insertFactoryRawStockSchema,
  insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema,
  insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  customerInvoiceSequences,
  customerBalances,
  customers,
  insertCustomerSchema,
  ledgerAccounts,
  voucherEntries,
  companies,
  locations,
  userCompanyRoles,
  insertCustomerProformaSchema,
  insertCustomerProformaLineSchema,
  insertCustomerOrderSchema,
  factoryFxRates,
  insertFactoryFxRateSchema,
  factoryDaybookEntries,
  containerDocumentTypes,
  containerDocuments,
  containerFreight,
  containerFreightPayments,
  factoryDaybookEntryEdits,
  containers,
  factoryUserProfiles,
  factoryUserPageAccess,
  insertUserSchema,
  directMessages,
  insertDirectMessageSchema,
  userPresence,
  factoryDutyAuditLog,
  factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges,
  companySettings,
  factorySettings,
  factoryWorkers,
  factoryWorkerCategories,
  insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments,
  factoryPayrolls,
  factoryWorkerDocuments,
  factoryAlerts,
  employees,
  factoryWasteEntries,
  factoryBalePhotos,
  factoryDailyKpiSnapshots,
  factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots,
  factoryContainerProfitSnapshots,
  bankAccounts,
  inventory,
  exchangeRates,
  vouchers,
  suppliers,
  containerSales,
  factorySupplierPayments,
  insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers,
  insertFactorySupplierFxTransferSchema,
  factoryFxAllocations,
  baleRecodeSessions,
  baleRecodeItems,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryBaleWasteDispatches,
  factoryPosSales,
  factoryPosSaleItems,
  proformaStockReservations,
  customerOrderBaleRemovals,
  customerOrderExpectedLines,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

export function registerOrderTrackingRoutes(app: Express) {
  app.get("/api/factory/invoice-container-tracking", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          containerNumber: customerOrders.containerNumber,
          status: customerOrders.status,
          grandTotal: customerOrders.grandTotal,
          orderDate: customerOrders.orderDate,
          customerName: customers.legalName,
          // ERP container tracking fields
          eta: containers.eta,
          trackingLastStatus: containers.trackingLastStatus,
          trackingLink: containers.trackingLink,
          containerStatus: containers.status,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .leftJoin(containers, eq(customerOrders.containerNumber, containers.containerNumber))
        .where(
          and(
            eq(customerOrders.companyId, companyId),
            isNull(customerOrders.deletedAt),
            sql`${customerOrders.status} IN ('VERIFIED', 'FINALIZED')`,
            sql`${customerOrders.containerNumber} IS NOT NULL AND TRIM(${customerOrders.containerNumber}) <> ''`
          )
        )
        .orderBy(desc(customerOrders.orderDate), desc(customerOrders.id));

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/shipping-containers/track-now
  // Finds all active factory customer orders with container numbers, matches
  // them to ERP containers table, and triggers live tracking for each one.
  app.post("/api/factory/shipping-containers/track-now", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Get all active factory customer orders with a container number
      const orders = await db
        .select({ containerNumber: customerOrders.containerNumber })
        .from(customerOrders)
        .where(
          and(
            eq(customerOrders.companyId, companyId),
            isNull(customerOrders.deletedAt),
            sql`${customerOrders.containerNumber} IS NOT NULL AND TRIM(${customerOrders.containerNumber}) <> ''`
          )
        );

      const containerNumbers = [
        ...new Set(orders.map((o) => (o.containerNumber || "").trim().toUpperCase()).filter(Boolean)),
      ];

      if (containerNumbers.length === 0) {
        return res.json({ tracked: 0, message: "No container numbers found on active orders." });
      }

      // Find matching ERP containers
      const matched = await db
        .select({ id: containers.id, containerNumber: containers.containerNumber })
        .from(containers)
        .where(
          and(inArray(sql`UPPER(TRIM(${containers.containerNumber}))`, containerNumbers), isNull(containers.deletedAt))
        );

      if (matched.length === 0) {
        return res.json({
          tracked: 0,
          message:
            "No matching containers found in tracking system. Ensure container numbers are registered as ERP containers.",
        });
      }

      // Fire tracking for each matched container in parallel (fire-and-forget)
      let queued = 0;
      for (const c of matched) {
        trackOneContainerById(c.id).catch(() => {});
        queued++;
      }

      res.json({
        tracked: queued,
        message: `Tracking started for ${queued} container${queued !== 1 ? "s" : ""}. ETAs will update shortly.`,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // REPAIR PER-KG LOADING PRICES
  // Finds LOADING/PENDING_VERIFICATION orders whose bales have priceUsed=0
  // but the proforma uses per_kg pricing, and recomputes each bale's price
  // using its real weight × pricePerKg.  Idempotent: already-correct bales
  // (priceUsed > 0) are left untouched.
  // ─────────────────────────────────────────────────────────────────────
}
