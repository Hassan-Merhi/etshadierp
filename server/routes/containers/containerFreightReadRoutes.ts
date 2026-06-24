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
import { calcPoAmounts, syncIntercoParentVoucher } from "./containerHelpers";

export function registerContainerFreightReadRoutes(app: Express) {
  app.get("/api/purchase-orders/next-po-number", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = (req.user as any)?.companyId;
      if (!companyId) return res.status(400).json({ message: "No company in session" });

      const year = new Date().getFullYear();
      const prefix = `PO-${year}-`;

      // Fetch all PO numbers for this company that match the auto-format
      const rows = await db
        .select({ poNumber: purchaseOrders.poNumber })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.companyId, companyId), like(purchaseOrders.poNumber, `${prefix}%`)));

      // Extract the numeric suffix and find the highest
      let maxSeq = 0;
      for (const { poNumber } of rows) {
        const suffix = poNumber.slice(prefix.length);
        const n = parseInt(suffix, 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }

      const next = String(maxSeq + 1).padStart(3, "0");
      res.json({ poNumber: `${prefix}${next}` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ledger accounts from the parent company — used for "Parent pays freight" picker
  app.get("/api/purchase-orders/parent-freight-accounts", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const parentCompanyId = await storage.getParentCompanyId();
      if (!parentCompanyId) return res.status(404).json({ message: "No parent company configured" });
      const accounts = await db
        .select({
          id: ledgerAccounts.id,
          name: ledgerAccounts.name,
          code: ledgerAccounts.code,
          accountType: ledgerAccounts.accountType,
        })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, parentCompanyId), eq(ledgerAccounts.active, true)))
        .orderBy(asc(ledgerAccounts.name));
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Per-PO parent JV sync endpoint
  app.post("/api/purchase-orders/:id/sync-parent-voucher", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const po = await storage.getPurchaseOrderById(id);
      if (!po) return res.status(404).json({ message: "Purchase order not found" });
      if (po.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      const parentCompanyId = await storage.getParentCompanyId();
      const isSameCompanySync = !parentCompanyId || po.companyId === parentCompanyId;

      const { grossTotal: poGrossTotal, intercoTotal: poSupplierTotal } = calcPoAmounts({
        itemsTotal: po.itemsTotal,
        freight: po.freight,
        surcharge: po.surcharge,
        fumigation: po.fumigation,
        documentCharges: po.documentCharges,
        discount: po.discount,
        otherCharges: po.otherCharges,
        freightPaidBy: (po as any).freightPaidBy,
      });
      const poFreightPaidBy: string = (po as any).freightPaidBy || "supplier";
      const poFreightAmt = parseFloat(po.freight || "0");
      const poFreightParentAcctId: number | null = (po as any).freightParentAccountId
        ? Number((po as any).freightParentAccountId)
        : null;
      const poHasParentFreight = poFreightPaidBy === "parent" && poFreightAmt > 0 && !!poFreightParentAcctId;

      // Fetch container number up-front — used in both the same-company and interco paths.
      // Must be declared before isSameCompanySync block to avoid Temporal Dead Zone crash.
      const poContainerRow = po.containerId
        ? (
            await db
              .select({ containerNumber: containers.containerNumber })
              .from(containers)
              .where(eq(containers.id, po.containerId))
              .limit(1)
          )[0]
        : undefined;

      // Same-company / no interco: update the freight DR entry in the PO's local voucher.
      if (isSameCompanySync) {
        if (!poHasParentFreight || !po.voucherId) {
          return res.json({
            message: "No parent company freight configured — nothing to sync",
            found: false,
            updated: false,
          });
        }
        // Update the PO voucher entries: DR Purchases (grossTotal), CR Supplier (supplierTotal), CR Freight Account (freight).
        const existingEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, po.voucherId!));
        let purchasesEntryId: number | null = null;
        let freightCrEntryId: number | null = null;
        let mainCrEntryId: number | null = null;
        const toDeleteIds: number[] = [];
        const freightCrCandidates: number[] = [];
        for (const entry of existingEntries) {
          const acctId = (entry as any).ledgerAccountId as number | null;
          const isDebit = parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
          const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;
          if (isCredit && acctId === poFreightParentAcctId) {
            freightCrCandidates.push(entry.id);
          } else if (isDebit && purchasesEntryId === null) {
            purchasesEntryId = entry.id;
          } else if (isCredit && mainCrEntryId === null) {
            mainCrEntryId = entry.id;
          } else {
            toDeleteIds.push(entry.id);
          }
        }
        freightCrEntryId = freightCrCandidates[0] ?? null;
        toDeleteIds.push(...freightCrCandidates.slice(1));
        await db.transaction(async (tx) => {
          if (toDeleteIds.length > 0) await tx.delete(voucherEntries).where(inArray(voucherEntries.id, toDeleteIds));
          if (purchasesEntryId !== null)
            await tx
              .update(voucherEntries)
              .set({ debitAmount: poGrossTotal.toFixed(2), creditAmount: "0" })
              .where(eq(voucherEntries.id, purchasesEntryId));
          if (mainCrEntryId !== null)
            await tx
              .update(voucherEntries)
              .set({ creditAmount: poSupplierTotal.toFixed(2), debitAmount: "0" })
              .where(eq(voucherEntries.id, mainCrEntryId));
          const _syncBtnFreightNarration = `Freight - ${po.poNumber}${poContainerRow?.containerNumber ? ` (${poContainerRow.containerNumber})` : ""}`;
          if (freightCrEntryId !== null) {
            await tx
              .update(voucherEntries)
              .set({
                creditAmount: poFreightAmt.toFixed(2),
                debitAmount: "0",
                ledgerAccountId: poFreightParentAcctId!,
                narration: _syncBtnFreightNarration,
              })
              .where(eq(voucherEntries.id, freightCrEntryId));
          } else {
            await tx.insert(voucherEntries).values({
              voucherId: po.voucherId!,
              companyId: po.companyId,
              ledgerAccountId: poFreightParentAcctId!,
              debitAmount: "0",
              creditAmount: poFreightAmt.toFixed(2),
              narration: _syncBtnFreightNarration,
            });
          }
          await tx
            .update(vouchers)
            .set({ totalAmount: poGrossTotal.toFixed(2) })
            .where(eq(vouchers.id, po.voucherId!));
        });
        return res.json({
          message: `Freight posted to account — PO voucher updated (${poFreightAmt.toFixed(2)})`,
          found: true,
          updated: true,
          amount: poGrossTotal.toFixed(2),
          poNumber: po.poNumber,
          updatedVouchers: 1,
        });
      }

      const result = await syncIntercoParentVoucher(
        db,
        po.poNumber,
        poGrossTotal,
        poContainerRow?.containerNumber,
        poHasParentFreight
          ? {
              freightAmount: poFreightAmt,
              freightParentAccountId: poFreightParentAcctId!,
              subsidiaryCompanyId: po.companyId,
            }
          : undefined
      );

      if (result.found) {
        return res.json({
          message: `Parent JV synced — voucher #${result.voucherId} updated to ${result.amount}`,
          ...result,
          poNumber: po.poNumber,
          intercoTotal: result.amount,
          updatedVouchers: result.updated ? 1 : 0,
        });
      }

      // No INTERCO-PARENT voucher found. If this PO has parent freight configured
      // with a local voucher, apply the freight split directly to the local purchase
      // voucher: CR Supplier = items-only (grossTotal − freight), CR FreightAccount = freight.
      if (poHasParentFreight && po.voucherId) {
        const existingEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, po.voucherId!));
        let purchasesEntryId: number | null = null;
        let freightCrEntryId: number | null = null;
        let mainCrEntryId: number | null = null;
        const toDeleteIds: number[] = [];
        const freightCrCandidates2: number[] = [];
        for (const entry of existingEntries) {
          const acctId = (entry as any).ledgerAccountId as number | null;
          const isDebit = parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
          const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;
          if (isCredit && acctId === poFreightParentAcctId) {
            freightCrCandidates2.push(entry.id);
          } else if (isDebit && purchasesEntryId === null) {
            purchasesEntryId = entry.id;
          } else if (isCredit && mainCrEntryId === null) {
            mainCrEntryId = entry.id;
          } else {
            toDeleteIds.push(entry.id);
          }
        }
        freightCrEntryId = freightCrCandidates2[0] ?? null;
        toDeleteIds.push(...freightCrCandidates2.slice(1));
        const _freightNarration = `Freight - ${po.poNumber}${poContainerRow?.containerNumber ? ` (${poContainerRow.containerNumber})` : ""}`;
        await db.transaction(async (tx) => {
          if (toDeleteIds.length > 0) await tx.delete(voucherEntries).where(inArray(voucherEntries.id, toDeleteIds));
          if (purchasesEntryId !== null)
            await tx
              .update(voucherEntries)
              .set({ debitAmount: poGrossTotal.toFixed(2), creditAmount: "0" })
              .where(eq(voucherEntries.id, purchasesEntryId));
          if (mainCrEntryId !== null)
            await tx
              .update(voucherEntries)
              .set({ creditAmount: poSupplierTotal.toFixed(2), debitAmount: "0" })
              .where(eq(voucherEntries.id, mainCrEntryId));
          if (freightCrEntryId !== null) {
            await tx
              .update(voucherEntries)
              .set({
                creditAmount: poFreightAmt.toFixed(2),
                debitAmount: "0",
                ledgerAccountId: poFreightParentAcctId!,
                narration: _freightNarration,
              })
              .where(eq(voucherEntries.id, freightCrEntryId));
          } else {
            await tx.insert(voucherEntries).values({
              voucherId: po.voucherId!,
              companyId: po.companyId,
              ledgerAccountId: poFreightParentAcctId!,
              debitAmount: "0",
              creditAmount: poFreightAmt.toFixed(2),
              narration: _freightNarration,
            });
          }
          await tx
            .update(vouchers)
            .set({ totalAmount: poGrossTotal.toFixed(2) })
            .where(eq(vouchers.id, po.voucherId!));
        });
        return res.json({
          message: `Freight split applied — supplier credited ${poSupplierTotal.toFixed(2)}, freight account credited ${poFreightAmt.toFixed(2)}`,
          found: true,
          updated: true,
          amount: poGrossTotal.toFixed(2),
          poNumber: po.poNumber,
          updatedVouchers: 1,
        });
      }

      res.json({
        message: `No INTERCO-PARENT voucher found for PO ${po.poNumber}`,
        ...result,
        poNumber: po.poNumber,
        intercoTotal: result.amount,
        updatedVouchers: 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Global PO / Parent JV sync-all endpoint ──────────────────────────────
  // Scans every PO in the current company, recalculates exact amounts, and
  // updates only mismatched local vouchers + mismatched parent INTERCO-PARENT
  // vouchers. Idempotent — safe to run multiple times.

  app.get("/api/containers/:id/purchase-orders", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(containerId)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }

      const container = await storage.getContainerById(containerId);

      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }

      // Verify user has access to this container's company
      const userCompanyRoles = await storage.getUserCompaniesWithRoles(userId);
      const hasAccess = userCompanyRoles.some((r) => r.companyId === container.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const supplier = await storage.getSupplierById(container.supplierId);
      const purchaseOrders = await storage.getPurchaseOrdersByContainer(containerId);

      // Batch-fetch all line items and stock items in 2 queries instead of N*M
      const poIds = purchaseOrders.map((po) => po.id);
      const [allLineItems, allStockItems] =
        poIds.length > 0
          ? await Promise.all([
              db.select().from(poLineItems).where(inArray(poLineItems.purchaseOrderId, poIds)).execute(),
              db
                .select({
                  id: stockItems.id,
                  code: stockItems.code,
                  name: stockItems.name,
                  deletedAt: stockItems.deletedAt,
                })
                .from(stockItems)
                .where(
                  inArray(stockItems.id, [
                    ...new Set(
                      (
                        await db
                          .select({ id: poLineItems.stockItemId })
                          .from(poLineItems)
                          .where(inArray(poLineItems.purchaseOrderId, poIds))
                          .execute()
                      )
                        .map((r) => r.id)
                        .filter(Boolean) as number[]
                    ),
                  ])
                )
                .execute(),
            ])
          : [[], []];

      const stockItemMap = new Map(allStockItems.map((s) => [s.id, s]));

      // Resolve deleted stock items → kept items via merge logs so OTW shows current names
      const deletedItemIds = allStockItems.filter((s) => s.deletedAt != null).map((s) => s.id);
      if (deletedItemIds.length > 0) {
        const mergeLogs = await db
          .select()
          .from(stockItemMergeLogs)
          .where(inArray(stockItemMergeLogs.mergedItemId, deletedItemIds));
        if (mergeLogs.length > 0) {
          const keptIds = [...new Set(mergeLogs.map((l) => l.keptItemId))];
          const keptItems = await db
            .select({
              id: stockItems.id,
              code: stockItems.code,
              name: stockItems.name,
              deletedAt: stockItems.deletedAt,
            })
            .from(stockItems)
            .where(inArray(stockItems.id, keptIds));
          const keptMap = new Map(keptItems.map((s) => [s.id, s]));
          for (const log of mergeLogs) {
            const kept = keptMap.get(log.keptItemId);
            if (kept) stockItemMap.set(log.mergedItemId, kept);
          }
        }
      }
      const lineItemsByPO = new Map<number, typeof allLineItems>();
      for (const li of allLineItems) {
        const arr = lineItemsByPO.get(li.purchaseOrderId!) || [];
        arr.push(li);
        lineItemsByPO.set(li.purchaseOrderId!, arr);
      }

      const posWithItems = purchaseOrders.map((po) => {
        const lineItemsForPO = lineItemsByPO.get(po.id) || [];
        const itemsWithNames = lineItemsForPO.map((item) => {
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

  app.get("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }

      // Check role permissions - only Admin and Owner can view purchase orders
      const userRole = req.session.currentRole;
      if (!userRole || (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer")) {
        return res.status(403).json({ message: "Only Admin and Owner can view purchase orders" });
      }

      const po = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, id),
      });

      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      // Verify purchase order belongs to current company
      if (po.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Purchase order belongs to a different company",
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
      const poFreight = parseFloat(po.freight?.toString() || "0");
      const poSurcharge = parseFloat(po.surcharge?.toString() || "0");
      const poFumigation = parseFloat(po.fumigation?.toString() || "0");
      const poDocCharges = parseFloat(po.documentCharges?.toString() || "0");
      const poDiscount = parseFloat(po.discount?.toString() || "0");
      const poOtherCharges = parseFloat(po.otherCharges?.toString() || "0");

      const finalCharges = {
        freight: poFreight.toString(),
        surcharge: poSurcharge.toString(),
        fumigation: poFumigation.toString(),
        documentCharges: poDocCharges.toString(),
        discount: poDiscount.toString(),
        otherCharges: poOtherCharges.toString(),
      };

      // If all charges are 0 AND charges haven't been explicitly edited, try to fetch from containerCharges table
      // This ensures that if user edited charges to 0, we respect that instead of showing container charges
      if (
        poFreight === 0 &&
        poSurcharge === 0 &&
        poFumigation === 0 &&
        poDocCharges === 0 &&
        poDiscount === 0 &&
        poOtherCharges === 0 &&
        !po.chargesEdited
      ) {
        const containerChargesData = await db.query.containerCharges.findMany({
          where: eq(containerCharges.containerId, po.containerId),
        });

        for (const charge of containerChargesData) {
          const amount = parseFloat(charge.amount?.toString() || "0");
          switch (charge.chargeType) {
            case "Freight":
              finalCharges.freight = Math.abs(amount).toString();
              break;
            case "Surcharge":
              finalCharges.surcharge = Math.abs(amount).toString();
              break;
            case "Fumigation":
              finalCharges.fumigation = Math.abs(amount).toString();
              break;
            case "Document Charges":
              finalCharges.documentCharges = Math.abs(amount).toString();
              break;
            case "Discount":
              finalCharges.discount = Math.abs(amount).toString();
              break;
            case "Other Charges":
              finalCharges.otherCharges = Math.abs(amount).toString();
              break;
          }
        }
      }

      res.json({
        ...po,
        items: lineItems,
        supplierName: supplier?.legalName || "Unknown Supplier",
        supplierCode: supplier?.code || "",
        containerNumber: container?.containerNumber || "",
        ...finalCharges,
        itemsTotal: po.itemsTotal?.toString() || "0",
      });
    } catch (error: any) {
      console.error("Get PO error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
