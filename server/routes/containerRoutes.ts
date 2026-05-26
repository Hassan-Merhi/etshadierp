import { parseId, parseOptionalId } from "../lib/parseId";
import { getClientDate } from "../lib/dateUtils";
import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockItemCodeAliases,
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
  ledgerAccounts, intercompanyPosConfigs,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";

// ──────────────────────────────────────────────────────────────────────────────
// Centralised PO amount calculator — single source of truth for gross/interco
// totals. All PATCH routes and repair endpoints call this so the formula
// cannot drift between them.
// ──────────────────────────────────────────────────────────────────────────────
interface PoAmounts {
  grossTotal: number;   // full gross — used for local subsidiary voucher
  intercoTotal: number; // supplier share — used for INTERCO-PARENT voucher
  freightPaidBy: string;
  freight: number;
}

function calcPoAmounts(po: {
  itemsTotal?:      string | number | null;
  freight?:         string | number | null;
  surcharge?:       string | number | null;
  fumigation?:      string | number | null;
  documentCharges?: string | number | null;
  discount?:        string | number | null;
  otherCharges?:    string | number | null;
  freightPaidBy?:   string | null;
}): PoAmounts {
  const f = (v: string | number | null | undefined) => parseFloat(String(v ?? "0")) || 0;
  const itemsTotal      = f(po.itemsTotal);
  const freight         = f(po.freight);
  const surcharge       = f(po.surcharge);
  const fumigation      = f(po.fumigation);
  const documentCharges = f(po.documentCharges);
  const discount        = f(po.discount);
  const otherCharges    = f(po.otherCharges);
  const freightPaidBy   = po.freightPaidBy ?? "supplier";
  const grossTotal = itemsTotal + freight + surcharge + fumigation + documentCharges - discount + otherCharges;
  // intercoTotal is the supplier's share: excludes freight when it's paid
  // by the subsidiary itself ("own") or by the parent company ("parent").
  const intercoTotal =
    (freightPaidBy === "own" || freightPaidBy === "parent") && freight > 0
      ? grossTotal - freight
      : grossTotal;
  return { grossTotal, intercoTotal, freightPaidBy, freight };
}

// ──────────────────────────────────────────────────────────────────────────────
// Inter-company sync helper
// When a subsidiary PO is edited (amount or container number), the matching
// INTERCO-PARENT-{poNumber} voucher in the parent company must also be updated.
// Only writes to the DB when the stored amount actually differs (idempotent).
// ──────────────────────────────────────────────────────────────────────────────
interface SyncIntercoResult {
  found: boolean;
  updated: boolean;
  voucherId?: number;
  amount: string;
  oldAmount?: string;
}

async function syncIntercoParentVoucher(
  dbOrTx: any,
  poNumbers: string | string[],
  grossTotal: number,
  containerNumber?: string,
  freightOpts?: {
    freightAmount: number;
    freightParentAccountId: number;
  },
): Promise<SyncIntercoResult> {
  const amountStr = grossTotal.toFixed(2);
  const intercoTotal = (freightOpts && freightOpts.freightAmount > 0)
    ? grossTotal - freightOpts.freightAmount
    : grossTotal;
  try {
    const parentCompanyId = await storage.getParentCompanyId();
    if (!parentCompanyId) return { found: false, updated: false, amount: amountStr };

    const nums = Array.isArray(poNumbers) ? poNumbers.filter(Boolean) : [poNumbers];

    // Build OR condition across all provided PO number patterns.
    // Three naming conventions exist depending on which creation path was used:
    //   INTERCO-PARENT-{n}-{ts}  — storage.ts / adminRoutes.ts
    //   INTERCO-{n}-{ts}         — adminRoutes.ts (older path)
    //   IC-{n}-{ts}              — importRoutes.ts (container import flow)
    const likeConditions = nums.flatMap((n) => [
      like(vouchers.voucherNumber, `INTERCO-PARENT-${n}-%`),
      like(vouchers.voucherNumber, `INTERCO-${n}-%`),
      like(vouchers.voucherNumber, `IC-${n}-%`),
    ]);
    const patternClause = likeConditions.length === 1
      ? likeConditions[0]
      : or(...likeConditions);

    // Locate the parent INTERCO voucher for this specific container.
    // Two description formats exist depending on which creation path was used:
    //   A) Container-based:  description starts with the container number
    //      e.g. "CAJU5262333 EUROGULF"
    //   B) PO-based:         description is generic "Inter-company credit: …"
    //      but the entry NARRATION contains "- Container EMCU7265605"
    // We try format A first (description LIKE), then fall back to format B
    // (entry narration LIKE) so both paths are handled.
    let parentVoucher: { id: number; totalAmount: string | null } | undefined;
    if (containerNumber) {
      // Format A: container number in description
      const [byDesc] = await dbOrTx
        .select({ id: vouchers.id, totalAmount: vouchers.totalAmount })
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, parentCompanyId),
          patternClause,
          like(vouchers.description, `%${containerNumber}%`),
        ))
        .limit(1);
      if (byDesc) {
        parentVoucher = byDesc;
      } else {
        // Format B: container number in entry narration
        const [byNarration] = await dbOrTx
          .select({ id: vouchers.id, totalAmount: vouchers.totalAmount })
          .from(vouchers)
          .innerJoin(voucherEntries, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(
            eq(vouchers.companyId, parentCompanyId),
            patternClause,
            like(voucherEntries.narration, `%${containerNumber}%`),
          ))
          .limit(1);
        parentVoucher = byNarration;
      }
    } else {
      const [byPo] = await dbOrTx
        .select({ id: vouchers.id, totalAmount: vouchers.totalAmount })
        .from(vouchers)
        .where(and(eq(vouchers.companyId, parentCompanyId), patternClause))
        .limit(1);
      parentVoucher = byPo;
    }

    if (!parentVoucher) {
      console.warn(`[syncIntercoParentVoucher] No INTERCO-PARENT voucher found for PO(s): ${nums.join(", ")}`);
      return { found: false, updated: false, amount: amountStr };
    }

    const parentEntries = await dbOrTx
      .select()
      .from(voucherEntries)
      .where(eq(voucherEntries.voucherId, parentVoucher.id));

    const oldAmount = parseFloat(parentVoucher.totalAmount || "0");
    const oldAmountStr = oldAmount.toFixed(2);

    // Check whether an update is needed (idempotent)
    const totalMismatch = Math.abs(oldAmount - grossTotal) > 0.001;
    let freightEntryMissing = false;
    if (freightOpts && freightOpts.freightAmount > 0) {
      const fe = parentEntries.find(
        (e: any) => e.ledgerAccountId === freightOpts.freightParentAccountId &&
                    parseFloat(e.creditAmount || "0") > 0,
      );
      freightEntryMissing = !fe ||
        Math.abs(parseFloat(fe.creditAmount || "0") - freightOpts.freightAmount) > 0.001;
    }
    if (!totalMismatch && !freightEntryMissing) {
      return { found: true, updated: false, voucherId: parentVoucher.id, amount: amountStr, oldAmount: oldAmountStr };
    }

    console.log(`[syncIntercoParentVoucher] PO(s) ${nums.join(", ")}: voucher #${parentVoucher.id} ${oldAmountStr} → ${amountStr}`);

    await dbOrTx
      .update(vouchers)
      .set({ totalAmount: amountStr })
      .where(eq(vouchers.id, parentVoucher.id));

    if (freightOpts && freightOpts.freightAmount > 0) {
      // Split the INTERCO-PARENT: DR subsidiary receivable (grossTotal),
      //   CR supplier (intercoTotal — goods only), CR freightAccount (freight)
      const intercoAmtStr = intercoTotal.toFixed(2);
      const freightAmtStr = freightOpts.freightAmount.toFixed(2);
      let freightEntryFound = false;

      for (const entry of parentEntries) {
        if (parseFloat(entry.debitAmount || "0") > 0) {
          await dbOrTx.update(voucherEntries)
            .set({ debitAmount: amountStr })
            .where(eq(voucherEntries.id, entry.id));
        } else if (parseFloat(entry.creditAmount || "0") > 0) {
          if ((entry as any).ledgerAccountId === freightOpts.freightParentAccountId) {
            freightEntryFound = true;
            await dbOrTx.update(voucherEntries)
              .set({ creditAmount: freightAmtStr })
              .where(eq(voucherEntries.id, entry.id));
          } else {
            // Supplier CR → intercoTotal (goods share only)
            await dbOrTx.update(voucherEntries)
              .set({ creditAmount: intercoAmtStr })
              .where(eq(voucherEntries.id, entry.id));
          }
        }
      }
      if (!freightEntryFound) {
        await dbOrTx.insert(voucherEntries).values({
          voucherId: parentVoucher.id,
          companyId: parentCompanyId,
          ledgerAccountId: freightOpts.freightParentAccountId,
          debitAmount: "0",
          creditAmount: freightAmtStr,
          narration: `Freight - ${nums.join(", ")}`,
        });
      }
    } else {
      // No freight split — update all entries to grossTotal (original behaviour)
      for (const entry of parentEntries) {
        if (parseFloat(entry.debitAmount || "0") > 0) {
          await dbOrTx.update(voucherEntries)
            .set({ debitAmount: amountStr })
            .where(eq(voucherEntries.id, entry.id));
        } else if (parseFloat(entry.creditAmount || "0") > 0) {
          await dbOrTx.update(voucherEntries)
            .set({ creditAmount: amountStr })
            .where(eq(voucherEntries.id, entry.id));
        }
      }
    }

    return { found: true, updated: true, voucherId: parentVoucher.id, amount: amountStr, oldAmount: oldAmountStr };
  } catch (err) {
    console.error("[syncIntercoParentVoucher] Error syncing parent INTERCO voucher:", err);
    return { found: false, updated: false, amount: amountStr };
  }
}

// syncIntercoFreightParentVoucher removed — freight is now recorded directly
// inside the purchase voucher (DR Purchases / CR freightParentAccountId).
// No separate INTERCO-FREIGHT voucher is created. Legacy ones are deleted
// by the sync-all cleanup below.

// ──────────────────────────────────────────────────────────────────────────────
// requireNonSP — blocks Supplier Partner companies from using ERP container
// accounting routes (they must use /api/sp/* endpoints instead).
// Does a single DB read; result is not cached — intentional for correctness.
// ──────────────────────────────────────────────────────────────────────────────
async function requireNonSP(req: Request, res: Response, next: NextFunction) {
  const companyId = req.session?.currentCompanyId;
  if (!companyId) return next(); // let requireAuth handle missing session

  try {
    const rows = await db.execute(
      sql`SELECT company_type FROM companies WHERE id = ${companyId} LIMIT 1`
    );
    const row = rows.rows?.[0] as { company_type: string } | undefined;
    if (row?.company_type === "supplier_partner") {
      return res.status(403).json({
        message:
          "Supplier Partner companies must use the SP container/offload workflow (/api/sp/*).",
      });
    }
    next();
  } catch (err: any) {
    next(err);
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
        docsSentDate,
        freightStatus,
        trackingLink,
        status,
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
      // Capture old number before updating so we can rewrite voucher descriptions
      const [currentRow] = await db
        .select({ containerNumber: containers.containerNumber })
        .from(containers)
        .where(and(eq(containers.id, id), eq(containers.companyId, companyId)))
        .limit(1);
      const oldNumber = currentRow?.containerNumber;

      const [updated] = await db
        .update(containers)
        .set({ containerNumber: newNumber })
        .where(and(eq(containers.id, id), eq(containers.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Container not found" });

      // ── Rewrite all voucher descriptions and narrations that mention the old container number ──
      // This ensures the supplier ledger regex picks up the new number and builds correct links.
      if (oldNumber && oldNumber !== newNumber) {
        try {
          await db.execute(
            sql`UPDATE vouchers SET description = REPLACE(description, ${oldNumber}, ${newNumber}) WHERE description LIKE ${'%' + oldNumber + '%'}`
          );
          await db.execute(
            sql`UPDATE voucher_entries SET narration = REPLACE(narration, ${oldNumber}, ${newNumber}) WHERE narration LIKE ${'%' + oldNumber + '%'}`
          );
        } catch (syncErr) {
          console.error("[container number sync] Error updating voucher descriptions:", syncErr);
        }
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Sync purchase voucher amounts for a container's POs (fixes cases where voucher
  // was created before line items were imported, resulting in $0 amounts)
  app.post("/api/containers/:id/sync-voucher", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [container] = await db
        .select({ id: containers.id, containerNumber: containers.containerNumber, companyId: containers.companyId })
        .from(containers)
        .where(and(eq(containers.id, id), eq(containers.companyId, companyId)))
        .limit(1);
      if (!container) return res.status(404).json({ message: "Container not found" });

      const pos = await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.containerId, id));

      const parentCompanyId = await storage.getParentCompanyId();
      let updatedLocalVouchers = 0;
      let updatedParentVouchers = 0;
      const skipped: string[] = [];
      const errors: string[] = [];

      for (const po of pos) {
        const { grossTotal: poTotal, intercoTotal: poIntercoTotal } = calcPoAmounts({
          itemsTotal: po.itemsTotal, freight: po.freight, surcharge: po.surcharge,
          fumigation: po.fumigation, documentCharges: po.documentCharges,
          discount: po.discount, otherCharges: po.otherCharges,
          freightPaidBy: (po as any).freightPaidBy,
        });
        const poFreightPaidBy: string = (po as any).freightPaidBy || "supplier";
        const poFreight = parseFloat(po.freight || "0");
        const poFreightParentAccountId: number | null = (po as any).freightParentAccountId
          ? Number((po as any).freightParentAccountId) : null;
        const poFreightOwnAccountId: number | null = (po as any).freightOwnAccountId
          ? Number((po as any).freightOwnAccountId) : null;
        const hasParentFreight = poFreightPaidBy === 'parent' && poFreight > 0 && !!poFreightParentAccountId;
        const hasOwnFreight    = poFreightPaidBy === 'own'    && poFreight > 0 && !!poFreightOwnAccountId;
        const hasEmbeddedFreight = hasParentFreight || hasOwnFreight;
        // Which account to credit for freight inside the purchase voucher
        const freightAccountId = hasParentFreight ? poFreightParentAccountId
                               : hasOwnFreight    ? poFreightOwnAccountId
                               : null;

        // Local voucher amount: grossTotal when freight is embedded, intercoTotal otherwise.
        const poLocalTotal = hasEmbeddedFreight ? poTotal : poIntercoTotal;

        if (poTotal <= 0) {
          skipped.push(`PO ${po.poNumber}: total is 0`);
          continue;
        }

        // Fix the purchase voucher linked directly to the PO
        if (po.voucherId) {
          await db
            .update(vouchers)
            .set({ totalAmount: poLocalTotal.toFixed(2) })
            .where(eq(vouchers.id, po.voucherId));

          // Also update the description to use the current container number
          const [voucherRow] = await db
            .select({ id: vouchers.id, description: vouchers.description })
            .from(vouchers)
            .where(eq(vouchers.id, po.voucherId))
            .limit(1);
          if (voucherRow && po.supplierId) {
            const [sup] = await db
              .select({ legalName: suppliers.legalName })
              .from(suppliers)
              .where(eq(suppliers.id, po.supplierId))
              .limit(1);
            const expectedDesc = [container.containerNumber, sup?.legalName].filter(Boolean).join(" ");
            if (voucherRow.description && !voucherRow.description.includes(container.containerNumber)) {
              await db
                .update(vouchers)
                .set({ description: expectedDesc })
                .where(eq(vouchers.id, voucherRow.id));
            }
          }

          const entries = await db
            .select()
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, po.voucherId));

          if (hasParentFreight && poFreightParentAccountId) {
            // Parent-paid freight: child's voucher must NEVER reference the parent's
            // freightParentAccountId. Correct structure:
            //   DR Purchases (intercoTotal — goods)
            //   DR Purchases (freight — same account)
            //   CR parentCreditAccountId (grossTotal — full intercompany payable)
            //
            // Strategy: locate the single parent-credit CR entry to preserve, then
            // DELETE everything else and rebuild DR entries fresh so a previously
            // bad sync (with double DRs) cannot leave stale entries behind.
            const childSettings = await storage.getCompanySettings(po.companyId);
            const parentCreditAcctId = childSettings?.parentCreditAccountId ?? null;

            let parentCreditEntryId: number | null = null;
            let purchasesAcctId: number | null = null;
            const toDeleteIds: number[] = [];

            for (const entry of entries) {
              const acctId = (entry as any).ledgerAccountId as number | null;
              const isDebit  = parseFloat(entry.debitAmount  || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
              const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount  || "0") === 0;

              if (isCredit && acctId === parentCreditAcctId && parentCreditEntryId === null) {
                // Keep this one — we'll update it to grossTotal
                parentCreditEntryId = entry.id;
              } else {
                // Everything else (wrong freight DRs/CRs, extra goods DRs, etc.) — delete
                toDeleteIds.push(entry.id);
                // Capture purchases account from any non-freight DR
                if (isDebit && acctId !== poFreightParentAccountId && !purchasesAcctId) {
                  purchasesAcctId = acctId;
                }
              }
            }

            // Delete all stale entries in one shot
            if (toDeleteIds.length > 0) {
              await db.delete(voucherEntries).where(inArray(voucherEntries.id, toDeleteIds));
            }

            // Update or insert the parent credit CR (grossTotal)
            if (parentCreditEntryId !== null) {
              await db.update(voucherEntries)
                .set({ creditAmount: poTotal.toFixed(2), debitAmount: "0" })
                .where(eq(voucherEntries.id, parentCreditEntryId));
            } else if (parentCreditAcctId) {
              await db.insert(voucherEntries).values({
                voucherId: po.voucherId, companyId: po.companyId,
                ledgerAccountId: parentCreditAcctId,
                debitAmount: "0", creditAmount: poTotal.toFixed(2),
                narration: `PO ${po.poNumber} - Credit to parent`,
              });
            }

            // Re-insert goods DR + freight DR fresh
            if (purchasesAcctId) {
              await db.insert(voucherEntries).values([
                {
                  voucherId: po.voucherId, companyId: po.companyId,
                  ledgerAccountId: purchasesAcctId,
                  debitAmount: poIntercoTotal.toFixed(2), creditAmount: "0",
                  narration: `PO ${po.poNumber}`,
                },
                {
                  voucherId: po.voucherId, companyId: po.companyId,
                  ledgerAccountId: purchasesAcctId,
                  debitAmount: poFreight.toFixed(2), creditAmount: "0",
                  narration: `Freight - PO ${po.poNumber}`,
                },
              ]);
            }
          } else if (hasOwnFreight) {
            // Own-paid freight: DR Purchases (intercoTotal) + DR FreightOwnAccount (freight)
            //                   CR Supplier (intercoTotal) + CR FreightOwnAccount (freight)
            // Identify freight CR entry by ledgerAccountId = freightAccountId (own)
            let purchasesAcctId: number | null = null;
            let freightCrFound = false;
            for (const entry of entries) {
              const isDebit = parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
              const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;
              if (isDebit) {
                if (!purchasesAcctId) purchasesAcctId = (entry as any).ledgerAccountId ?? null;
                // Goods DR entry — update to intercoTotal; freight DR will be added/kept separately
                if ((entry as any).ledgerAccountId !== freightAccountId) {
                  await db.update(voucherEntries)
                    .set({ debitAmount: poIntercoTotal.toFixed(2), creditAmount: "0" })
                    .where(eq(voucherEntries.id, entry.id));
                }
              } else if (isCredit) {
                if ((entry as any).ledgerAccountId === freightAccountId) {
                  // Freight CR entry — update to current freight amount
                  freightCrFound = true;
                  await db.update(voucherEntries)
                    .set({ creditAmount: poFreight.toFixed(2) })
                    .where(eq(voucherEntries.id, entry.id));
                } else {
                  // Goods CR entry (supplier account) — update to intercoTotal
                  await db.update(voucherEntries)
                    .set({ creditAmount: poIntercoTotal.toFixed(2), debitAmount: "0" })
                    .where(eq(voucherEntries.id, entry.id));
                }
              }
            }
            // If no freight CR entry exists yet, add the freight pair
            if (!freightCrFound && purchasesAcctId) {
              await db.insert(voucherEntries).values([
                {
                  voucherId: po.voucherId, companyId: po.companyId,
                  ledgerAccountId: purchasesAcctId,
                  debitAmount: poFreight.toFixed(2), creditAmount: "0",
                  narration: `Freight - PO ${po.poNumber}`,
                },
                {
                  voucherId: po.voucherId, companyId: po.companyId,
                  ledgerAccountId: freightAccountId,
                  debitAmount: "0", creditAmount: poFreight.toFixed(2),
                  narration: `Freight - PO ${po.poNumber}`,
                },
              ]);
            }
          } else {
            // Standard: update all entries to poLocalTotal
            for (const entry of entries) {
              const origDebit = parseFloat(entry.debitAmount || "0");
              const origCredit = parseFloat(entry.creditAmount || "0");
              let isDebitEntry: boolean;
              if (origDebit > 0 && origCredit === 0) {
                isDebitEntry = true;
              } else if (origCredit > 0 && origDebit === 0) {
                isDebitEntry = false;
              } else {
                const nar = (entry.narration || "").toLowerCase();
                isDebitEntry = !entry.supplierId && (nar.includes("purchases") || nar.includes("owes us"));
              }
              if (isDebitEntry) {
                await db.update(voucherEntries)
                  .set({ debitAmount: poLocalTotal.toFixed(2), creditAmount: "0" })
                  .where(eq(voucherEntries.id, entry.id));
              } else {
                await db.update(voucherEntries)
                  .set({ creditAmount: poLocalTotal.toFixed(2), debitAmount: "0" })
                  .where(eq(voucherEntries.id, entry.id));
              }
            }
          }
          updatedLocalVouchers++;
        }

        // Fix the INTERCO-PARENT voucher in the parent company
        if (parentCompanyId && po.companyId !== parentCompanyId) {
          const svResult = await syncIntercoParentVoucher(
            db, po.poNumber, poTotal, container.containerNumber,
            hasParentFreight ? { freightAmount: poFreight, freightParentAccountId: poFreightParentAccountId! } : undefined,
          );
          if (svResult.updated) {
            updatedParentVouchers++;
          } else if (!svResult.found) {
            skipped.push(`PO ${po.poNumber}: no INTERCO-PARENT voucher found`);
          }
        }
      }

      res.json({
        message: `Synced ${updatedLocalVouchers} local voucher(s) and ${updatedParentVouchers} parent JV(s)`,
        updatedVouchers: updatedLocalVouchers + updatedParentVouchers,
        updatedLocalVouchers,
        updatedParentVouchers,
        skipped,
        errors,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Auto-generate the next available PO number for the current company.
  // Format: PO-{YYYY}-{NNN} — scans existing PO numbers and returns the next
  // unused sequence so every new PO gets a unique, trackable identifier.
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
        .where(and(
          eq(purchaseOrders.companyId, companyId),
          like(purchaseOrders.poNumber, `${prefix}%`),
        ));

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
        .select({ id: ledgerAccounts.id, name: ledgerAccounts.name, code: ledgerAccounts.code, accountType: ledgerAccounts.accountType })
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
      if (!parentCompanyId || po.companyId === parentCompanyId) {
        return res.json({ message: "No parent company — nothing to sync", found: false, updated: false });
      }

      const { intercoTotal } = calcPoAmounts({
        itemsTotal: po.itemsTotal, freight: po.freight, surcharge: po.surcharge,
        fumigation: po.fumigation, documentCharges: po.documentCharges,
        discount: po.discount, otherCharges: po.otherCharges,
        freightPaidBy: (po as any).freightPaidBy,
      });

      const poContainerRow = po.containerId
        ? (await db.select({ containerNumber: containers.containerNumber }).from(containers).where(eq(containers.id, po.containerId)).limit(1))[0]
        : undefined;

      const result = await syncIntercoParentVoucher(db, po.poNumber, intercoTotal, poContainerRow?.containerNumber);
      res.json({
        message: result.found
          ? `Parent JV synced — voucher #${result.voucherId} updated to ${result.amount}`
          : `No INTERCO-PARENT voucher found for PO ${po.poNumber}`,
        ...result,
        poNumber: po.poNumber,
        intercoTotal: result.amount,
        updatedVouchers: result.updated ? 1 : 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Global PO / Parent JV sync-all endpoint ──────────────────────────────
  // Scans every PO in the current company, recalculates exact amounts, and
  // updates only mismatched local vouchers + mismatched parent INTERCO-PARENT
  // vouchers. Idempotent — safe to run multiple times.
  app.post(
    "/api/containers/sync-all-vouchers",
    requireAuth,
    requireNonPOS,
    requireRole("Admin", "Owner", "Developer"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const parentCompanyId = await storage.getParentCompanyId();

        // Collect company IDs to process: always include the current company.
        // When the current company IS the parent, also include all subsidiaries so
        // their INTERCO-PARENT and INTERCO-FREIGHT vouchers are repaired too.
        const companyIdsToProcess: number[] = [companyId];
        if (parentCompanyId && companyId === parentCompanyId) {
          const subsidiaryConfigs = await db
            .select({ sourceCompanyId: intercompanyPosConfigs.sourceCompanyId })
            .from(intercompanyPosConfigs)
            .where(eq(intercompanyPosConfigs.destCompanyId, parentCompanyId));
          for (const cfg of subsidiaryConfigs) {
            if (cfg.sourceCompanyId && !companyIdsToProcess.includes(cfg.sourceCompanyId)) {
              companyIdsToProcess.push(cfg.sourceCompanyId);
            }
          }
        }

        // Fetch all POs for all relevant companies
        const allPos = await db
          .select()
          .from(purchaseOrders)
          .where(inArray(purchaseOrders.companyId, companyIdsToProcess));

        // Build a containerId → containerNumber map across ALL companies.
        // POs may reference containers owned by the parent company or another
        // entity — restricting by companyIdsToProcess causes
        // containerNumberMap.get(poContainerId) to return undefined, making
        // cNum fall back to String(containerId) and breaking the INTERCO
        // journal lookup in syncIntercoParentVoucher.
        const allContainerRows = await db
          .select({ id: containers.id, containerNumber: containers.containerNumber })
          .from(containers);
        const containerNumberMap = new Map<number, string>(
          allContainerRows.map((c) => [c.id, c.containerNumber])
        );

        let scannedPOs = 0;
        let updatedLocalVouchers = 0;
        let updatedParentVouchers = 0;
        let updatedFreightVouchers = 0;
        let updatedContainerCharges = 0;
        const skipped: string[] = [];
        const notFoundParentVouchers: string[] = [];
        const missingParentFreightAccount: string[] = [];
        const errors: string[] = [];

        for (const po of allPos) {
          scannedPOs++;
          try {
            // Recalculate exact amounts
            const { grossTotal, intercoTotal } = calcPoAmounts({
              itemsTotal: po.itemsTotal, freight: po.freight, surcharge: po.surcharge,
              fumigation: po.fumigation, documentCharges: po.documentCharges,
              discount: po.discount, otherCharges: po.otherCharges,
              freightPaidBy: (po as any).freightPaidBy,
            });

            if (grossTotal <= 0) {
              skipped.push(`PO ${po.poNumber}: total is 0 — skipped`);
              continue;
            }

            // Resolve freight info from calcPoAmounts result
            const poFreightPaidBy: string = (po as any).freightPaidBy || "supplier";
            const poFreight = parseFloat(po.freight || "0");
            const poFreightParentAccountId: number | null = (po as any).freightParentAccountId
              ? Number((po as any).freightParentAccountId) : null;
            const poFreightOwnAccountId: number | null = (po as any).freightOwnAccountId
              ? Number((po as any).freightOwnAccountId) : null;
            const hasParentFreight   = poFreightPaidBy === 'parent' && poFreight > 0 && !!poFreightParentAccountId;
            const hasOwnFreight      = poFreightPaidBy === 'own'    && poFreight > 0 && !!poFreightOwnAccountId;
            const hasEmbeddedFreight = hasParentFreight || hasOwnFreight;
            const freightAccountId   = hasParentFreight ? poFreightParentAccountId
                                     : hasOwnFreight    ? poFreightOwnAccountId
                                     : null;

            // ── Fix the local purchase voucher ────────────────────────────────
            // Expected total:
            //   parent-freight (with or without account) → grossTotal (child owes parent the full amount)
            //   own-embedded freight                     → grossTotal
            //   all other cases                          → intercoTotal (goods only)
            const expectedLocalTotal =
              (hasEmbeddedFreight || (poFreightPaidBy === 'parent' && poFreight > 0))
                ? grossTotal
                : intercoTotal;
            if (po.voucherId) {
              const [localVoucher] = await db
                .select({ id: vouchers.id, totalAmount: vouchers.totalAmount })
                .from(vouchers)
                .where(eq(vouchers.id, po.voucherId))
                .limit(1);

              if (localVoucher) {
                const currentLocalTotal = parseFloat(localVoucher.totalAmount || "0");
                const entries = await db
                  .select()
                  .from(voucherEntries)
                  .where(eq(voucherEntries.voucherId, po.voucherId));

                // ── Determine if a repair is needed ──────────────────────────
                // For parent-freight, the freight account (freightParentAccountId) lives
                // ONLY in the parent INTERCO journal — NOT in the child's purchase voucher.
                // The child's voucher has: DR Purchases (goods) + DR Purchases (freight) + CR parentCredit.
                // We never look for a CR to freightParentAccountId in the child's voucher.
                let freightEntryMissing = false;
                if (hasParentFreight) {
                  // Detect old single-DR structure or wrong DR sum → needs rebuild
                  const drEntries = entries.filter((e: any) =>
                    parseFloat(e.debitAmount || "0") > 0 && parseFloat(e.creditAmount || "0") === 0
                  );
                  const drSum = drEntries.reduce((s: number, e: any) => s + parseFloat(e.debitAmount || "0"), 0);
                  // Also detect stray freight-account CR inside child voucher.
                  // freightParentAccountId belongs ONLY in the parent INTERCO journal.
                  // If it appears as a CR here it means the parent credit entry was
                  // left at intercoTotal and the freight leaked into the wrong account,
                  // causing an intercompany receivable/payable mismatch.
                  const strayFreightCr = poFreightParentAccountId
                    ? entries.some(
                        (e: any) => Number((e as any).ledgerAccountId) === poFreightParentAccountId &&
                                    parseFloat(e.creditAmount || "0") > 0
                      )
                    : false;
                  freightEntryMissing = drEntries.length !== 2 || Math.abs(drSum - grossTotal) > 0.001 || strayFreightCr;
                } else if (hasOwnFreight) {
                  // Own-freight: freight CR to freightAccountId must exist in child's voucher
                  const freightCrEntry = entries.find(
                    (e: any) => e.ledgerAccountId === freightAccountId && parseFloat(e.creditAmount || "0") > 0
                  );
                  freightEntryMissing = !freightCrEntry;
                }
                const localMismatch = Math.abs(currentLocalTotal - expectedLocalTotal) > 0.001 || freightEntryMissing;

                if (localMismatch) {
                  console.log(`[SyncAll] PO ${po.poNumber}: local voucher #${po.voucherId} ${currentLocalTotal} → ${expectedLocalTotal}`);
                  await db
                    .update(vouchers)
                    .set({ totalAmount: expectedLocalTotal.toFixed(2) })
                    .where(eq(vouchers.id, po.voucherId));

                  if (hasParentFreight) {
                    // Parent-freight: delete-and-rebuild approach.
                    // Child's voucher MUST be:
                    //   DR Purchases (intercoTotal — goods)
                    //   DR Purchases (freight)
                    //   CR parentCreditAccount (grossTotal)
                    // freightParentAccountId is NEVER in the child's voucher.
                    const childSettings = await storage.getCompanySettings(po.companyId);
                    const parentCreditAcctId = childSettings?.parentCreditAccountId ?? null;

                    let parentCreditEntryId: number | null = null;
                    let purchasesAcctId: number | null = null;
                    const toDeleteIds: number[] = [];

                    for (const entry of entries) {
                      const acctId = (entry as any).ledgerAccountId as number | null;
                      const isDebit = parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
                      const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;

                      if (isCredit && acctId === parentCreditAcctId && parentCreditEntryId === null) {
                        parentCreditEntryId = entry.id;
                      } else {
                        toDeleteIds.push(entry.id);
                        if (isDebit && acctId !== poFreightParentAccountId && !purchasesAcctId) {
                          purchasesAcctId = acctId;
                        }
                      }
                    }

                    if (toDeleteIds.length > 0) {
                      await db.delete(voucherEntries).where(inArray(voucherEntries.id, toDeleteIds));
                    }

                    if (parentCreditEntryId !== null) {
                      await db.update(voucherEntries)
                        .set({ creditAmount: grossTotal.toFixed(2), debitAmount: "0" })
                        .where(eq(voucherEntries.id, parentCreditEntryId));
                    } else if (parentCreditAcctId) {
                      await db.insert(voucherEntries).values({
                        voucherId: po.voucherId, companyId: po.companyId,
                        ledgerAccountId: parentCreditAcctId,
                        debitAmount: "0", creditAmount: grossTotal.toFixed(2),
                        narration: `PO ${po.poNumber} - Credit to parent`,
                      });
                    }

                    if (purchasesAcctId) {
                      await db.insert(voucherEntries).values([
                        {
                          voucherId: po.voucherId, companyId: po.companyId,
                          ledgerAccountId: purchasesAcctId,
                          debitAmount: intercoTotal.toFixed(2), creditAmount: "0",
                          narration: `PO ${po.poNumber}`,
                        },
                        {
                          voucherId: po.voucherId, companyId: po.companyId,
                          ledgerAccountId: purchasesAcctId,
                          debitAmount: poFreight.toFixed(2), creditAmount: "0",
                          narration: `Freight - PO ${po.poNumber}`,
                        },
                      ]);
                    }
                  } else if (hasOwnFreight) {
                    // Own-freight: DR Purchases (goods) + DR FreightOwnAccount (freight)
                    //              CR Supplier (goods) + CR FreightOwnAccount (freight)
                    let purchasesAcctId: number | null = null;
                    let freightCrFound = false;
                    for (const entry of entries) {
                      const isDebit = parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
                      const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;
                      if (isDebit) {
                        if (!purchasesAcctId) purchasesAcctId = (entry as any).ledgerAccountId ?? null;
                        if ((entry as any).ledgerAccountId !== freightAccountId) {
                          await db.update(voucherEntries)
                            .set({ debitAmount: intercoTotal.toFixed(2), creditAmount: "0" })
                            .where(eq(voucherEntries.id, entry.id));
                        }
                      } else if (isCredit) {
                        if ((entry as any).ledgerAccountId === freightAccountId) {
                          freightCrFound = true;
                          await db.update(voucherEntries)
                            .set({ creditAmount: poFreight.toFixed(2) })
                            .where(eq(voucherEntries.id, entry.id));
                        } else {
                          await db.update(voucherEntries)
                            .set({ creditAmount: intercoTotal.toFixed(2), debitAmount: "0" })
                            .where(eq(voucherEntries.id, entry.id));
                        }
                      }
                    }
                    if (!freightCrFound && purchasesAcctId) {
                      await db.insert(voucherEntries).values([
                        {
                          voucherId: po.voucherId, companyId: po.companyId,
                          ledgerAccountId: purchasesAcctId,
                          debitAmount: poFreight.toFixed(2), creditAmount: "0",
                          narration: `Freight - PO ${po.poNumber}`,
                        },
                        {
                          voucherId: po.voucherId, companyId: po.companyId,
                          ledgerAccountId: freightAccountId,
                          debitAmount: "0", creditAmount: poFreight.toFixed(2),
                          narration: `Freight - PO ${po.poNumber}`,
                        },
                      ]);
                    }
                  } else {
                    // Standard supplier-paid freight: all entries → expectedLocalTotal
                    for (const entry of entries) {
                      const origDebit = parseFloat(entry.debitAmount || "0");
                      const origCredit = parseFloat(entry.creditAmount || "0");
                      const isDebit = origDebit > 0 && origCredit === 0
                        ? true : origCredit > 0 && origDebit === 0
                          ? false : !(entry.supplierId);
                      if (isDebit) {
                        await db.update(voucherEntries)
                          .set({ debitAmount: expectedLocalTotal.toFixed(2), creditAmount: "0" })
                          .where(eq(voucherEntries.id, entry.id));
                      } else {
                        await db.update(voucherEntries)
                          .set({ creditAmount: expectedLocalTotal.toFixed(2), debitAmount: "0" })
                          .where(eq(voucherEntries.id, entry.id));
                      }
                    }
                  }
                  updatedLocalVouchers++;
                }
              }
            }

            // ── Compute container number for this PO (used by parent sync) ──
            const poContainerId = po.containerId;
            const cNum = poContainerId ? (containerNumberMap.get(poContainerId) ?? String(poContainerId)) : String(po.id);

            // ── Fix the parent INTERCO-PARENT voucher ───────────────────────
            if (parentCompanyId && po.companyId !== parentCompanyId) {
              const svResult = await syncIntercoParentVoucher(
                db, po.poNumber, grossTotal, cNum,
                hasParentFreight ? { freightAmount: poFreight, freightParentAccountId: poFreightParentAccountId! } : undefined,
              );
              if (svResult.updated) {
                updatedParentVouchers++;
              } else if (!svResult.found) {
                notFoundParentVouchers.push(`PO ${po.poNumber}: no INTERCO-PARENT voucher in parent company`);
              }
            }
            // ── Stale FREIGHT- voucher cleanup / missing parent freight account warning ──
            const freightVoucherNum = `FREIGHT-${cNum}-${po.poNumber}`;
            if (poFreightPaidBy === 'parent' && poFreight > 0 && !((po as any).freightParentAccountId)) {
              missingParentFreightAccount.push(`PO ${po.poNumber}: freight set to parent-paid but no parent account configured`);
            }

            // Freight is now embedded inside the purchase voucher — delete any stale FREIGHT- voucher.
            {
              const [staleFV] = await db
                .select({ id: vouchers.id })
                .from(vouchers)
                .where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, freightVoucherNum)))
                .limit(1);
              if (staleFV) {
                await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, staleFV.id));
                await db.delete(vouchers).where(eq(vouchers.id, staleFV.id));
                updatedFreightVouchers++;
              }
            }

            // INTERCO-FREIGHT vouchers are no longer created — freight is recorded
            // directly inside the purchase voucher. Legacy ones are left in place
            // (they can be deleted manually from the daybook if no longer needed).
          } catch (poErr: any) {
            errors.push(`PO ${po.poNumber}: ${poErr.message}`);
            console.error(`[SyncAll] Error processing PO ${po.poNumber}:`, poErr);
          }
        }

        // ── Update container totals ──────────────────────────────────────────
        let updatedContainers = 0;
        const containerIds = [...new Set(allPos.map((p) => p.containerId))];
        for (const cid of containerIds) {
          try {
            const containerPos = allPos.filter((p) => p.containerId === cid);
            const containerItemsTotal = containerPos.reduce((sum, p) => sum + parseFloat(p.itemsTotal || "0"), 0);
            const containerChargesTotal = containerPos.reduce((sum, p) => {
              return sum +
                parseFloat(p.freight || "0") +
                parseFloat(p.surcharge || "0") +
                parseFloat(p.fumigation || "0") +
                parseFloat(p.documentCharges || "0") -
                parseFloat(p.discount || "0") +
                parseFloat(p.otherCharges || "0");
            }, 0);
            const containerGrandTotal = containerItemsTotal + containerChargesTotal;

            const [existingContainer] = await db
              .select({ id: containers.id, itemsTotal: containers.itemsTotal, chargesTotal: containers.chargesTotal, grandTotal: containers.grandTotal })
              .from(containers)
              .where(eq(containers.id, cid))
              .limit(1);

            if (existingContainer) {
              const curItems = parseFloat(existingContainer.itemsTotal || "0");
              const curCharges = parseFloat(existingContainer.chargesTotal || "0");
              const curGrand = parseFloat(existingContainer.grandTotal || "0");
              const mismatch =
                Math.abs(curItems - containerItemsTotal) > 0.001 ||
                Math.abs(curCharges - containerChargesTotal) > 0.001 ||
                Math.abs(curGrand - containerGrandTotal) > 0.001;
              if (mismatch) {
                await db.update(containers)
                  .set({
                    itemsTotal: containerItemsTotal.toFixed(2),
                    chargesTotal: containerChargesTotal.toFixed(2),
                    grandTotal: containerGrandTotal.toFixed(2),
                  })
                  .where(eq(containers.id, cid));
                updatedContainers++;
              }
            }

            // ── Repair container_charges rows ────────────────────────────────
            // Aggregate each charge type across all POs for this container
            if (cid) {
              const summedCharges = [
                { chargeType: "Freight",          amount: containerPos.reduce((s, p) => s + parseFloat(p.freight || "0"), 0) },
                { chargeType: "Surcharge",        amount: containerPos.reduce((s, p) => s + parseFloat(p.surcharge || "0"), 0) },
                { chargeType: "Fumigation",       amount: containerPos.reduce((s, p) => s + parseFloat(p.fumigation || "0"), 0) },
                { chargeType: "Document Charges", amount: containerPos.reduce((s, p) => s + parseFloat(p.documentCharges || "0"), 0) },
                { chargeType: "Discount",         amount: -containerPos.reduce((s, p) => s + parseFloat(p.discount || "0"), 0) },
                { chargeType: "Other Charges",    amount: containerPos.reduce((s, p) => s + parseFloat(p.otherCharges || "0"), 0) },
              ];
              for (const { chargeType, amount } of summedCharges) {
                const [existingCharge] = await db
                  .select({ id: containerCharges.id, amount: containerCharges.amount })
                  .from(containerCharges)
                  .where(and(
                    eq(containerCharges.containerId, cid),
                    eq(containerCharges.chargeType, chargeType),
                  ))
                  .limit(1);
                if (amount === 0) {
                  if (existingCharge) {
                    await db.delete(containerCharges).where(eq(containerCharges.id, existingCharge.id));
                    updatedContainerCharges++;
                  }
                } else {
                  const currentAmt = parseFloat(existingCharge?.amount || "0");
                  if (Math.abs(currentAmt - amount) > 0.001) {
                    if (existingCharge) {
                      await db.update(containerCharges)
                        .set({ amount: amount.toFixed(2) })
                        .where(eq(containerCharges.id, existingCharge.id));
                    } else {
                      await db.insert(containerCharges).values({ containerId: cid, chargeType, amount: amount.toFixed(2) });
                    }
                    updatedContainerCharges++;
                  }
                }
              }
            }
          } catch (cErr: any) {
            errors.push(`Container ${cid}: ${cErr.message}`);
          }
        }

        const scannedContainers = containerIds.length;
        console.log(`[SyncAll] Done. POs=${scannedPOs} Containers=${scannedContainers} LocalVouchers=${updatedLocalVouchers} ParentVouchers=${updatedParentVouchers} FreightVouchers=${updatedFreightVouchers} ContainerCharges=${updatedContainerCharges} ContainerTotals=${updatedContainers} Skipped=${skipped.length} NotFound=${notFoundParentVouchers.length} Errors=${errors.length}`);

        res.json({
          scannedPOs,
          scannedContainers,
          updatedLocalVouchers,
          updatedParentVouchers,
          updatedFreightVouchers,
          updatedContainerCharges,
          updatedContainers,
          skipped,
          notFoundParentVouchers,
          missingParentFreightAccount,
          errors,
          message: `Scanned ${scannedPOs} POs. Updated ${updatedLocalVouchers} local vouchers, ${updatedParentVouchers} parent JVs, ${updatedContainers} container totals.`,
        });
      } catch (error: any) {
        console.error("[SyncAll] Fatal error:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
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
          numberPlate: container.numberPlate || "",
          status: container.status,
          importDate: container.importDate,
          itemsTotal: container.itemsTotal,
          chargesTotal: container.chargesTotal,
          grandTotal: container.grandTotal,
          itemName: container.itemName,
          ratePerKg: container.ratePerKg,
          totalKg: container.totalKg,
        },
        supplier: {
          code: (supplier as any)?.code || "",
          legalName: supplier?.legalName || "",
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

  // Create a manual container (ERP only — SP companies must use /api/sp/containers)
  app.post("/api/containers", requireAuth, requireNonPOS, requireNonSP, async (req, res) => {
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

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "containers",
          recordId: container.id,
          recordIdentifier: container.containerNumber || `Container #${container.id}`,
          changes: {
            containerNumber: { new: container.containerNumber },
            status: { new: container.status },
            importDate: { new: container.importDate },
            supplierId: { new: container.supplierId },
          },
        });
      } catch { /* non-fatal */ }
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
        const containerId = parseId(req.params.id);
        if (containerId === null) return res.status(400).json({ message: "Invalid id" });
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

  // Offload container to location (ERP only — SP companies must use /api/sp/offload)
  app.post(
    "/api/containers/:id/offload",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const containerId = parseId(req.params.id);
        if (containerId === null) return res.status(400).json({ message: "Invalid id" });

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
          agentChargeLines = [],
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
                      ${vouchers.voucherNumber} LIKE 'XFER-%' OR
                      ${vouchers.voucherNumber} LIKE ${'SP-OTW-REV-ERP-' + containerId + '-%'} OR
                      ${vouchers.voucherNumber} LIKE ${'SP-AGENT-SETTLE-' + containerId + '-%'}
                    )`,
                  ),
                );

              for (const voucher of oldVouchers) {
                await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));
                await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
              }

              // Also delete HADI L'SHI side SP agent vouchers (companyId=1) for this container
              const hadiAgentVouchers = await tx
                .select()
                .from(vouchers)
                .where(
                  and(
                    eq(vouchers.companyId, 1),
                    sql`${vouchers.voucherNumber} LIKE ${'SP-AGENT-ERP-' + containerId + '-%'}`,
                  ),
                );
              for (const v of hadiAgentVouchers) {
                await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
                await tx.delete(vouchers).where(eq(vouchers.id, v.id));
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

        // ── SP company: all SP-specific journals in one atomic transaction ──
        // Detect company type first (outside the tx — read-only, no side effects)
        const spCompanyRow = await db.execute(
          sql`SELECT company_type FROM companies WHERE id = ${container.companyId} LIMIT 1`
        );
        const spCompanyType = (spCompanyRow as any).rows?.[0]?.company_type ?? (spCompanyRow as any)[0]?.company_type;
        const isSpCompany = spCompanyType === "supplier_partner";

        if (isSpCompany) {
          const vDate = offloadDate || getClientDate(req);
          const validAgentLines = agentChargeLines.filter(l => l.amountUsd > 0);
          const totalAgentAmt = validAgentLines.reduce((s, l) => s + l.amountUsd, 0);
          const pos = await storage.getPurchaseOrdersByContainer(containerId);
          const totalOtw = pos.reduce((s, po) => s + parseFloat(po.grandTotal || "0"), 0);

          // Pre-fetch all required ledger accounts in parallel (outside tx)
          const [
            otwAcct,
            otwClrAcct,
            hadiSpInterco,
            spHadiIcAcct,
            spPrepaidExpAcct,
          ] = await Promise.all([
            db.select().from(ledgerAccounts).where(
              and(eq(ledgerAccounts.companyId, container.companyId), eq(ledgerAccounts.subType, "sp_goods_otw"), isNull(ledgerAccounts.deletedAt))
            ).then(r => r[0]),
            db.select().from(ledgerAccounts).where(
              and(eq(ledgerAccounts.companyId, container.companyId), eq(ledgerAccounts.subType, "sp_otw_clearing"), isNull(ledgerAccounts.deletedAt))
            ).then(r => r[0]),
            validAgentLines.length > 0
              ? db.select().from(ledgerAccounts).where(
                  and(eq(ledgerAccounts.companyId, 1), eq(ledgerAccounts.subType, "hadi_sp_intercompany"), isNull(ledgerAccounts.deletedAt))
                ).then(r => r[0])
              : Promise.resolve(undefined),
            validAgentLines.length > 0
              ? db.select().from(ledgerAccounts).where(
                  and(eq(ledgerAccounts.companyId, container.companyId), eq(ledgerAccounts.subType, "sp_hadi_intercompany"), isNull(ledgerAccounts.deletedAt))
                ).then(r => r[0])
              : Promise.resolve(undefined),
            validAgentLines.length > 0
              ? db.select().from(ledgerAccounts).where(
                  and(eq(ledgerAccounts.companyId, container.companyId), eq(ledgerAccounts.subType, "sp_prepaid_expenses"), isNull(ledgerAccounts.deletedAt))
                ).then(r => r[0])
              : Promise.resolve(undefined),
          ]);

          if (!otwAcct || !otwClrAcct) {
            throw new Error("SP OTW accounts not found. Run SP Setup first.");
          }
          if (validAgentLines.length > 0) {
            if (!hadiSpInterco) throw new Error("HADI L'SHI intercompany account not found. Contact admin.");
            if (!spHadiIcAcct) throw new Error("SP intercompany account (SP-HADI-IC) not found. Run SP Setup first.");
            if (!spPrepaidExpAcct) throw new Error("SP Prepaid Expenses account not found. Run SP Setup first.");
          }

          // ── Single transaction: Voucher A + agent journals ──
          // Note: Voucher B (Dr sp_stock / Cr sp_cost_clearing) in the native SP offload
          // creates a stock asset. For ERP containers, inventory is managed through
          // storage.offloadContainer (bales/products tables), so no separate stock ledger
          // entry is needed — sp_goods_otw and sp_otw_clearing are fully cleared by Voucher A.
          await db.transaction(async (tx) => {

            // ── Voucher A: Reverse Goods OTW (clears OTW asset + OTW Clearing liability) ──
            // OTW Clearing Dr lines carry supplierId → zeroes the supplier sub-ledger balance.
            // Mirrors the same step in POST /api/sp/offload for native SP containers.
            if (totalOtw > 0) {
              const [voucherA] = await tx.insert(vouchers).values({
                companyId: container.companyId,
                voucherType: "Journal",
                voucherNumber: `SP-OTW-REV-ERP-${containerId}-${Date.now()}`,
                voucherDate: vDate,
                description: `Goods OTW Reversal — ERP container #${containerId}`,
                totalAmount: String(totalOtw),
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              }).returning();

              // Dr OTW Clearing per PO (with supplierId — zeroes supplier sub-ledger balance)
              for (const po of pos) {
                const poTotal = parseFloat(po.grandTotal || "0");
                if (poTotal <= 0) continue;
                await tx.insert(voucherEntries).values({
                  voucherId: voucherA.id,
                  ledgerAccountId: otwClrAcct.id,
                  supplierId: po.supplierId || null,
                  debitAmount: String(poTotal),
                  creditAmount: "0",
                  narration: `OTW Clearing reversal — ERP container #${containerId}`,
                });
              }

              // Cr Goods OTW (full total — reduces the OTW asset to zero)
              await tx.insert(voucherEntries).values({
                voucherId: voucherA.id,
                ledgerAccountId: otwAcct.id,
                debitAmount: "0",
                creditAmount: String(totalOtw),
                narration: `Goods OTW reversal — ERP container #${containerId}`,
              });
            }

            // ── Agent settlement journals (only when agent charges exist) ──
            if (validAgentLines.length > 0 && spHadiIcAcct && spPrepaidExpAcct && hadiSpInterco) {
              // Journal in SP Test Co: Dr SP-HADI-IC / Cr SP-PREEXP
              const [settlementVoucher] = await tx.insert(vouchers).values({
                companyId: container.companyId,
                voucherType: "Journal",
                voucherNumber: `SP-AGENT-SETTLE-${containerId}-${Date.now()}`,
                voucherDate: vDate,
                description: `Agent charge settlement via HADI L'SHI — container #${containerId}`,
                totalAmount: String(totalAgentAmt),
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              }).returning();
              await tx.insert(voucherEntries).values({
                voucherId: settlementVoucher.id,
                ledgerAccountId: spHadiIcAcct.id,
                debitAmount: String(totalAgentAmt),
                creditAmount: "0",
                narration: `Agent charges via HADI L'SHI — ERP container #${containerId}`,
              });
              await tx.insert(voucherEntries).values({
                voucherId: settlementVoucher.id,
                ledgerAccountId: spPrepaidExpAcct.id,
                debitAmount: "0",
                creditAmount: String(totalAgentAmt),
                narration: `Prepaid expenses used for agent charges — ERP container #${containerId}`,
              });

              // Voucher C in HADI L'SHI: Dr HADI-SP-IC / Cr Agent (per line)
              const [voucherC] = await tx.insert(vouchers).values({
                companyId: 1,
                voucherType: "Journal",
                voucherNumber: `SP-AGENT-ERP-${containerId}-${Date.now()}`,
                voucherDate: vDate,
                description: `Agent charges for ERP offload — container #${containerId}`,
                totalAmount: String(totalAgentAmt),
                currency: "USD",
                exchangeRate: "1",
                sourceModule: "SP",
              }).returning();
              await tx.insert(voucherEntries).values({
                voucherId: voucherC.id,
                ledgerAccountId: hadiSpInterco.id,
                debitAmount: String(totalAgentAmt),
                creditAmount: "0",
                narration: `ERP container offload agent charges — container #${containerId}`,
              });
              for (const line of validAgentLines) {
                await tx.insert(voucherEntries).values({
                  voucherId: voucherC.id,
                  ledgerAccountId: line.parentAgentAccountId,
                  debitAmount: "0",
                  creditAmount: String(line.amountUsd),
                  narration: `Agent credit for ERP container #${containerId}${line.description ? ` — ${line.description}` : ""}`,
                });
              }
            }
          });
        }

        res.json(offload);
      } catch (error: any) {
        console.error("Container offload error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Reverse container offload — ERP only (Admin, Owner, or Manager)
  app.post(
    "/api/containers/:id/reverse-offload",
    requireAuth,
    requireRole("Admin", "Owner", "Manager"),
    requireNonSP,
    async (req, res) => {
      try {
        const containerId = parseId(req.params.id);
        if (containerId === null) return res.status(400).json({ message: "Invalid id" });
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
        const containerId = parseId(req.params.id);
        if (containerId === null) return res.status(400).json({ message: "Invalid id" });
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

          // Keep containers.dutyFee in sync with the actual duties entered so the
          // Agent/Duty FIFO tab always uses the real duty amount.
          if (parseFloat(duties) > 0) {
            await tx
              .update(containers)
              .set({ dutyFee: duties })
              .where(eq(containers.id, containerId));
          }

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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }

      // Check role permissions - only Admin and Owner can view purchase orders
      const userRole = req.session.currentRole;
      if (!userRole || (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer")) {
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
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
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
      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
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

        // Capture freight in outer scope so the post-transaction parent-freight sync
        // can access it without a ReferenceError.
        let _b1FreightForSync = parseFloat(existingPO.freight ?? "0");

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
          _b1FreightForSync = freight; // lift into outer scope for post-tx sync
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
              ...(req.body.freightPaidBy !== undefined ? { freightPaidBy: req.body.freightPaidBy } : {}),
              ...(req.body.freightOwnAccountId !== undefined ? { freightOwnAccountId: req.body.freightOwnAccountId === null ? null : Number(req.body.freightOwnAccountId) } : {}),
              ...(req.body.freightParentAccountId !== undefined ? { freightParentAccountId: req.body.freightParentAccountId === null ? null : Number(req.body.freightParentAccountId) } : {}),
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
          
          // Compute totals. intercoTotal = supplier share (excludes freight when own/parent-paid).
          const poGrandTotal = itemsTotal + freight + surcharge + fumigation + documentCharges - discount + otherCharges;
          const b1FreightPaidBy: string = req.body.freightPaidBy ?? existingPO.freightPaidBy ?? 'supplier';
          const b1IntercoTotal = (b1FreightPaidBy === 'own' || b1FreightPaidBy === 'parent') && freight > 0
            ? itemsTotal + surcharge + fumigation + documentCharges - discount + otherCharges
            : poGrandTotal;

          // Update the associated voucher — use supplier share (intercoTotal) so freight excluded
          // when it's paid via own-account or parent-company voucher.
          if (existingPO.voucherId) {
            await tx.update(vouchers)
              .set({ totalAmount: b1IntercoTotal.toFixed(2) })
              .where(eq(vouchers.id, existingPO.voucherId));
            
            const existingEntries = await tx
              .select()
              .from(voucherEntries)
              .where(eq(voucherEntries.voucherId, existingPO.voucherId));
            
            for (const entry of existingEntries) {
              if (parseFloat(entry.debitAmount || "0") > 0) {
                await tx.update(voucherEntries)
                  .set({ debitAmount: b1IntercoTotal.toFixed(2), creditAmount: "0" })
                  .where(eq(voucherEntries.id, entry.id));
              } else if (parseFloat(entry.creditAmount || "0") > 0) {
                await tx.update(voucherEntries)
                  .set({ creditAmount: b1IntercoTotal.toFixed(2), debitAmount: "0" })
                  .where(eq(voucherEntries.id, entry.id));
              }
            }
          }

          // ── Inter-company sync: use freightPaidBy-aware supplier total for the parent voucher.
          {
            const _b1IntercoTotal = b1IntercoTotal;
            const _b1NewPoNum = req.body.poNumber && req.body.poNumber !== existingPO.poNumber
              ? req.body.poNumber as string : null;
            const _b1PoNums = _b1NewPoNum ? [existingPO.poNumber, _b1NewPoNum] : existingPO.poNumber;
            const _b1ContainerRow = existingPO.containerId
              ? (await tx.select({ containerNumber: containers.containerNumber }).from(containers).where(eq(containers.id, existingPO.containerId)).limit(1))[0]
              : undefined;
            const _b1Sync = await syncIntercoParentVoucher(tx, _b1PoNums, _b1IntercoTotal, _b1ContainerRow?.containerNumber);
            if (!_b1Sync.found) {
              console.warn(`[PO-PATCH items] No INTERCO-PARENT voucher for PO(s): ${Array.isArray(_b1PoNums) ? _b1PoNums.join(", ") : _b1PoNums}`);
            }
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
        
        try {
          const _poItemChanges: Record<string, any> = {};
          const _oldItemMap = new Map((existingLineItems as any[]).map((it: any) => [it.id, it]));
          const _addedItems: string[] = [];
          const _removedItems: string[] = [];
          const _changedItems: string[] = [];
          for (const newIt of lineItems as any[]) {
            if (newIt.id && _oldItemMap.has(newIt.id)) {
              const oldIt = _oldItemMap.get(newIt.id)!;
              const diffs: string[] = [];
              if (String(oldIt.quantity ?? "") !== String(newIt.quantity ?? "")) diffs.push(`qty: ${oldIt.quantity}→${newIt.quantity}`);
              if (String(oldIt.unitPrice ?? oldIt.rate ?? "") !== String(newIt.unitPrice ?? newIt.rate ?? "")) diffs.push(`price changed`);
              if (diffs.length) _changedItems.push(`${newIt.stockItemCode || newIt.stockItemId}: ${diffs.join(", ")}`);
            } else {
              _addedItems.push(newIt.stockItemCode || String(newIt.stockItemId || "new"));
            }
          }
          const _newIdSet = new Set((lineItems as any[]).filter((it: any) => it.id).map((it: any) => it.id));
          for (const [oldId, oldIt] of _oldItemMap) {
            if (!_newIdSet.has(oldId)) _removedItems.push((oldIt as any).stockItemCode || String(oldId));
          }
          if (_addedItems.length) _poItemChanges.itemsAdded = { new: _addedItems.join(", ") };
          if (_removedItems.length) _poItemChanges.itemsRemoved = { old: _removedItems.join(", ") };
          if (_changedItems.length) _poItemChanges.itemsChanged = { new: _changedItems.join("; ") };
          if (existingPO.poNumber !== updatedPO?.poNumber) _poItemChanges.poNumber = { old: existingPO.poNumber, new: updatedPO?.poNumber };
          if (existingPO.itemsTotal !== updatedPO?.itemsTotal) _poItemChanges.itemsTotal = { old: existingPO.itemsTotal, new: updatedPO?.itemsTotal };
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "update",
            tableName: "purchase_orders",
            recordId: id,
            recordIdentifier: existingPO.poNumber || `PO #${id}`,
            changes: _poItemChanges,
          });
        } catch { /* non-fatal */ }

        // INTERCO-FREIGHT sync removed — freight is now inside the purchase voucher itself.

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
      if (req.body.freightPaidBy !== undefined)
        allowedUpdates.freightPaidBy = req.body.freightPaidBy;
      if (req.body.freightOwnAccountId !== undefined)
        allowedUpdates.freightOwnAccountId = req.body.freightOwnAccountId === null ? null : (req.body.freightOwnAccountId ? Number(req.body.freightOwnAccountId) : null);
      if (req.body.freightParentAccountId !== undefined)
        allowedUpdates.freightParentAccountId = req.body.freightParentAccountId === null ? null : (req.body.freightParentAccountId ? Number(req.body.freightParentAccountId) : null);
      
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
      
      // Freight paid-by-own / parent: supplier voucher total excludes freight
      const newFreightPaidBy: string = req.body.freightPaidBy ?? existingPO.freightPaidBy ?? 'supplier';
      const newFreightOwnAccountId: number | null =
        req.body.freightOwnAccountId !== undefined
          ? (req.body.freightOwnAccountId === null ? null : Number(req.body.freightOwnAccountId))
          : ((existingPO as any).freightOwnAccountId ?? null);
      const newFreightParentAccountId: number | null =
        req.body.freightParentAccountId !== undefined
          ? (req.body.freightParentAccountId === null ? null : Number(req.body.freightParentAccountId))
          : ((existingPO as any).freightParentAccountId ?? null);
      const oldFreightPaidBy: string = (existingPO as any).freightPaidBy ?? 'supplier';

      // Use centralised calculator — single source of truth for both branches
      const { grossTotal: newGrandTotal, intercoTotal: supplierTotal } = calcPoAmounts({
        itemsTotal: newItemsTotal, freight: newFreight, surcharge: newSurcharge,
        fumigation: newFumigation, documentCharges: newDocumentCharges,
        discount: newDiscount, otherCharges: newOtherCharges,
        freightPaidBy: newFreightPaidBy,
      });
      const { grossTotal: oldGrandTotal, intercoTotal: oldSupplierTotal } = calcPoAmounts({
        itemsTotal: oldItemsTotal, freight: oldFreight, surcharge: oldSurcharge,
        fumigation: oldFumigation, documentCharges: oldDocumentCharges,
        discount: oldDiscount, otherCharges: oldOtherCharges,
        freightPaidBy: oldFreightPaidBy,
      });
      const freightPaidByChanged = newFreightPaidBy !== oldFreightPaidBy;
      const freightOwnAccountChanged = newFreightOwnAccountId !== ((existingPO as any).freightOwnAccountId ?? null);
      const freightParentAccountChanged = newFreightParentAccountId !== ((existingPO as any).freightParentAccountId ?? null);
      // Determine embedded-freight state (freight lives inside the purchase voucher)
      const newHasOwnFreight    = newFreightPaidBy === 'own'    && newFreight > 0 && !!newFreightOwnAccountId;
      const newHasParentFreight = newFreightPaidBy === 'parent' && newFreight > 0 && !!newFreightParentAccountId;
      const newHasEmbeddedFreight = newHasOwnFreight || newHasParentFreight;
      const newFreightAccountId = newHasParentFreight ? newFreightParentAccountId
                                : newHasOwnFreight    ? newFreightOwnAccountId
                                : null;
      // Local voucher total = grossTotal when freight is parent-paid (child always owes
      // the parent the full amount including freight, regardless of whether the freight
      // account has been configured yet) or when freight is own-embedded.
      const newLocalVoucherTotal =
        (newHasEmbeddedFreight || (newFreightPaidBy === 'parent' && newFreight > 0))
          ? newGrandTotal
          : supplierTotal;
      const oldHasEmbeddedFreight = (oldFreightPaidBy === 'own' || oldFreightPaidBy === 'parent');
      const oldLocalVoucherTotal  = oldHasEmbeddedFreight ? oldGrandTotal : oldSupplierTotal;
      const freightVoucherNeedsUpdate = newFreightPaidBy === 'own' && (
        freightPaidByChanged || freightOwnAccountChanged || Math.abs(newFreight - oldFreight) > 0.001
      );
      const freightParentVoucherNeedsUpdate = freightPaidByChanged || freightParentAccountChanged || (
        newFreightPaidBy === 'parent' && Math.abs(newFreight - oldFreight) > 0.001
      );
      
      // Update PO
      const updated = await storage.updatePurchaseOrder(id, allowedUpdates);

      // Fetch actual current voucher total from DB so we catch vouchers that were
      // created before the freight-embedding fix (their stored total is wrong even
      // though the PO fields haven't "changed").
      let actualDbVoucherTotal: number | null = null;
      if (existingPO.voucherId) {
        const [currentVoucher] = await db
          .select({ totalAmount: vouchers.totalAmount })
          .from(vouchers)
          .where(eq(vouchers.id, existingPO.voucherId))
          .limit(1);
        if (currentVoucher) {
          actualDbVoucherTotal = parseFloat(currentVoucher.totalAmount || "0");
        }
      }
      const voucherTotalMismatch = actualDbVoucherTotal !== null &&
        Math.abs(newLocalVoucherTotal - actualDbVoucherTotal) > 0.001;

      // Update voucher entries when local voucher total, freight payer, or own-account changes,
      // OR when the actual DB voucher total doesn't match the expected total.
      if (voucherTotalMismatch || Math.abs(newLocalVoucherTotal - oldLocalVoucherTotal) > 0.001 || freightPaidByChanged || freightOwnAccountChanged || freightVoucherNeedsUpdate || freightParentVoucherNeedsUpdate) {
        await db.transaction(async (tx) => {
          // Update the purchase voucher linked to the PO
          if (existingPO.voucherId && (voucherTotalMismatch || Math.abs(newLocalVoucherTotal - oldLocalVoucherTotal) > 0.001 || freightPaidByChanged || freightOwnAccountChanged || freightParentVoucherNeedsUpdate)) {
            // Update voucher total amount
            await tx.update(vouchers)
              .set({ totalAmount: newLocalVoucherTotal.toFixed(2) })
              .where(eq(vouchers.id, existingPO.voucherId));

            const existingEntries = await tx
              .select()
              .from(voucherEntries)
              .where(eq(voucherEntries.voucherId, existingPO.voucherId));

            if (newHasParentFreight && newFreightParentAccountId) {
              // Parent-paid freight: child's voucher must NEVER reference freightParentAccountId.
              // Correct child structure:
              //   DR Purchases (supplierTotal — goods)
              //   DR Purchases (newFreight — freight, same account)
              //   CR parentCreditAccountId (newGrandTotal — full intercompany payable)
              //
              // Strategy: locate the single parent-credit CR entry to preserve, then
              // DELETE everything else and rebuild DR entries fresh so a previously
              // bad sync (with double DRs) cannot leave stale entries behind.
              const childSettings = await storage.getCompanySettings(existingPO.companyId);
              const parentCreditAcctId = childSettings?.parentCreditAccountId ?? null;

              let parentCreditEntryId: number | null = null;
              let purchasesAcctId: number | null = null;
              const toDeleteIds: number[] = [];

              for (const entry of existingEntries) {
                const acctId = (entry as any).ledgerAccountId as number | null;
                const isDebit  = parseFloat(entry.debitAmount  || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
                const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount  || "0") === 0;

                if (isCredit && acctId === parentCreditAcctId && parentCreditEntryId === null) {
                  // Keep this one — we'll update it to newGrandTotal
                  parentCreditEntryId = entry.id;
                } else {
                  // Everything else (wrong freight DRs/CRs, extra goods DRs, etc.) — delete
                  toDeleteIds.push(entry.id);
                  // Capture purchases account from any non-freight DR
                  if (isDebit && acctId !== newFreightParentAccountId && !purchasesAcctId) {
                    purchasesAcctId = acctId;
                  }
                }
              }

              // Delete all stale entries in one shot
              if (toDeleteIds.length > 0) {
                await tx.delete(voucherEntries).where(inArray(voucherEntries.id, toDeleteIds));
              }

              // Update or insert the parent credit CR (newGrandTotal)
              if (parentCreditEntryId !== null) {
                await tx.update(voucherEntries)
                  .set({ creditAmount: newGrandTotal.toFixed(2), debitAmount: "0" })
                  .where(eq(voucherEntries.id, parentCreditEntryId));
              } else if (parentCreditAcctId) {
                await tx.insert(voucherEntries).values({
                  voucherId: existingPO.voucherId, companyId: existingPO.companyId,
                  ledgerAccountId: parentCreditAcctId,
                  debitAmount: "0", creditAmount: newGrandTotal.toFixed(2),
                  narration: `PO ${existingPO.poNumber} - Credit to parent`,
                });
              }

              // Re-insert goods DR + freight DR fresh
              if (purchasesAcctId) {
                await tx.insert(voucherEntries).values([
                  {
                    voucherId: existingPO.voucherId, companyId: existingPO.companyId,
                    ledgerAccountId: purchasesAcctId,
                    debitAmount: supplierTotal.toFixed(2), creditAmount: "0",
                    narration: `PO ${existingPO.poNumber}`,
                  },
                  {
                    voucherId: existingPO.voucherId, companyId: existingPO.companyId,
                    ledgerAccountId: purchasesAcctId,
                    debitAmount: newFreight.toFixed(2), creditAmount: "0",
                    narration: `Freight - PO ${existingPO.poNumber}`,
                  },
                ]);
              }
            } else if (newHasOwnFreight && newFreightOwnAccountId) {
              // Own-paid freight: split inside purchase voucher
              //   DR Purchases (supplierTotal) + DR FreightOwn (newFreight)
              //   CR Supplier (supplierTotal)  + CR FreightOwn (newFreight)
              let purchasesAcctId: number | null = null;
              let freightCrFound = false;
              for (const entry of existingEntries) {
                const isDebit  = parseFloat(entry.debitAmount  || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
                const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount  || "0") === 0;
                if (isDebit) {
                  if (!purchasesAcctId) purchasesAcctId = (entry as any).ledgerAccountId ?? null;
                  if ((entry as any).ledgerAccountId !== newFreightOwnAccountId) {
                    await tx.update(voucherEntries)
                      .set({ debitAmount: supplierTotal.toFixed(2), creditAmount: "0" })
                      .where(eq(voucherEntries.id, entry.id));
                  } else {
                    // Existing freight DR entry — keep/update
                    await tx.update(voucherEntries)
                      .set({ debitAmount: newFreight.toFixed(2) })
                      .where(eq(voucherEntries.id, entry.id));
                  }
                } else if (isCredit) {
                  if ((entry as any).ledgerAccountId === newFreightOwnAccountId) {
                    freightCrFound = true;
                    await tx.update(voucherEntries)
                      .set({ creditAmount: newFreight.toFixed(2), ledgerAccountId: newFreightOwnAccountId })
                      .where(eq(voucherEntries.id, entry.id));
                  } else {
                    await tx.update(voucherEntries)
                      .set({ creditAmount: supplierTotal.toFixed(2), debitAmount: "0" })
                      .where(eq(voucherEntries.id, entry.id));
                  }
                }
              }
              if (!freightCrFound && purchasesAcctId) {
                await tx.insert(voucherEntries).values([
                  {
                    voucherId: existingPO.voucherId, companyId: existingPO.companyId,
                    ledgerAccountId: purchasesAcctId,
                    debitAmount: newFreight.toFixed(2), creditAmount: "0",
                    narration: `Freight - PO ${existingPO.poNumber}`,
                  },
                  {
                    voucherId: existingPO.voucherId, companyId: existingPO.companyId,
                    ledgerAccountId: newFreightOwnAccountId,
                    debitAmount: "0", creditAmount: newFreight.toFixed(2),
                    narration: `Freight - PO ${existingPO.poNumber}`,
                  },
                ]);
              }
            } else {
              // Standard: all entries to newLocalVoucherTotal (no embedded freight)
              // If switching away from embedded freight, remove freight entries first
              const freightEntryIds = existingEntries
                .filter((e: any) => {
                  const acct = e.ledgerAccountId;
                  return acct === ((existingPO as any).freightOwnAccountId ?? -1)
                      || acct === ((existingPO as any).freightParentAccountId ?? -1);
                })
                .map((e: any) => e.id);
              if (freightEntryIds.length > 0) {
                await tx.delete(voucherEntries).where(inArray(voucherEntries.id, freightEntryIds));
              }
              // Also remove the matching freight DR entries (identified by narration)
              const remainingEntries = existingEntries.filter((e: any) => !freightEntryIds.includes(e.id));
              for (const entry of remainingEntries) {
                if (parseFloat(entry.debitAmount || "0") > 0) {
                  await tx.update(voucherEntries)
                    .set({ debitAmount: newLocalVoucherTotal.toFixed(2) })
                    .where(eq(voucherEntries.id, entry.id));
                } else if (parseFloat(entry.creditAmount || "0") > 0) {
                  await tx.update(voucherEntries)
                    .set({ creditAmount: newLocalVoucherTotal.toFixed(2) })
                    .where(eq(voucherEntries.id, entry.id));
                }
              }
            }
          }

          // (interco sync moved to unconditional block below the transaction)
          
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

          // ── Freight own-account voucher ───────────────────────────────────
          // When the user pays freight themselves, we create/update a separate
          // Payment voucher (Debit Purchases / Credit own account) so the
          // freight cost never touches the supplier's balance.
          const freightVoucherNum = `FREIGHT-${container?.containerNumber ?? existingPO.containerId}-${existingPO.poNumber}`;
          if (freightVoucherNeedsUpdate && newFreight > 0 && newFreightOwnAccountId) {
            // Find the Purchases account used as debit in the supplier voucher
            let purchasesAcctId: number | null = null;
            if (existingPO.voucherId) {
              const svEntries = await tx.select().from(voucherEntries)
                .where(eq(voucherEntries.voucherId, existingPO.voucherId));
              purchasesAcctId = (svEntries.find((e: any) => parseFloat(e.debitAmount || "0") > 0) as any)?.ledgerAccountId ?? null;
            }
            const [existingFV] = await tx.select().from(vouchers)
              .where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, freightVoucherNum)))
              .limit(1);
            if (existingFV) {
              // Update existing freight voucher
              await tx.update(vouchers)
                .set({ totalAmount: newFreight.toFixed(2) })
                .where(eq(vouchers.id, existingFV.id));
              const fEntries = await tx.select().from(voucherEntries)
                .where(eq(voucherEntries.voucherId, existingFV.id));
              for (const fe of fEntries) {
                if (parseFloat(fe.debitAmount || "0") > 0) {
                  await tx.update(voucherEntries)
                    .set({ debitAmount: newFreight.toFixed(2) })
                    .where(eq(voucherEntries.id, fe.id));
                } else {
                  await tx.update(voucherEntries)
                    .set({ creditAmount: newFreight.toFixed(2), ledgerAccountId: newFreightOwnAccountId })
                    .where(eq(voucherEntries.id, fe.id));
                }
              }
            } else if (purchasesAcctId) {
              // Create new freight payment voucher
              const today = new Date().toISOString().split('T')[0];
              const [newFV] = await tx.insert(vouchers).values({
                companyId,
                voucherNumber: freightVoucherNum,
                voucherType: 'Payment',
                voucherDate: today,
                description: `Freight (own account) - ${container?.containerNumber} / ${existingPO.poNumber}`,
                totalAmount: newFreight.toFixed(2),
                sourceModule: 'FACTORY',
              }).returning();
              await tx.insert(voucherEntries).values([
                {
                  voucherId: newFV.id, companyId,
                  ledgerAccountId: purchasesAcctId,
                  debitAmount: newFreight.toFixed(2), creditAmount: "0",
                  narration: `Freight - ${container?.containerNumber}`,
                },
                {
                  voucherId: newFV.id, companyId,
                  ledgerAccountId: newFreightOwnAccountId,
                  debitAmount: "0", creditAmount: newFreight.toFixed(2),
                  narration: `Freight - ${container?.containerNumber}`,
                },
              ]);
            }
          } else if (oldFreightPaidBy === 'own' && newFreightPaidBy === 'supplier') {
            // Switched back to supplier — remove the standalone freight voucher
            const [existingFV] = await tx.select().from(vouchers)
              .where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, freightVoucherNum)))
              .limit(1);
            if (existingFV) {
              await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, existingFV.id));
              await tx.delete(vouchers).where(eq(vouchers.id, existingFV.id));
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
      
      // ── Inter-company sync — runs unconditionally after every charges-only update.
      // (Branch 1/items path runs its own sync inside the transaction above.)
      {
        const _b2ParentId = await storage.getParentCompanyId();
        if (_b2ParentId && existingPO.companyId !== _b2ParentId) {
          const _b2NewPoNum = req.body.poNumber && req.body.poNumber !== existingPO.poNumber
            ? req.body.poNumber as string : null;
          const _b2PoNums = _b2NewPoNum ? [existingPO.poNumber, _b2NewPoNum] : existingPO.poNumber;
          const _b2ContainerRow = existingPO.containerId
            ? (await db.select({ containerNumber: containers.containerNumber }).from(containers).where(eq(containers.id, existingPO.containerId)).limit(1))[0]
            : undefined;
          const _b2Sync = await syncIntercoParentVoucher(db, _b2PoNums, supplierTotal, _b2ContainerRow?.containerNumber);
          if (!_b2Sync.found) {
            console.warn(`[PO-PATCH charges] No INTERCO-PARENT voucher for PO(s): ${Array.isArray(_b2PoNums) ? _b2PoNums.join(", ") : _b2PoNums}`);
          }
        }
      }

      // INTERCO-FREIGHT sync removed — freight is now inside the purchase voucher itself.

      try {
        const _poChanges: Record<string, any> = {};
        for (const _f of ["poNumber", "currency", "status", "freight", "surcharge", "fumigation", "documentCharges", "discount", "otherCharges", "itemsTotal"] as const) {
          if (String((existingPO as any)[_f] ?? "") !== String((updated as any)[_f] ?? "")) {
            _poChanges[_f] = { old: (existingPO as any)[_f], new: (updated as any)[_f] };
          }
        }
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "purchase_orders",
          recordId: id,
          recordIdentifier: existingPO.poNumber || `PO #${id}`,
          changes: _poChanges,
        });
      } catch { /* non-fatal */ }
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
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ message: "Invalid id" });
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
        try {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "delete",
            tableName: "purchase_orders",
            recordId: existingPO.id,
            recordIdentifier: existingPO.poNumber || `PO #${id}`,
            changes: {
              poNumber: { old: existingPO.poNumber },
              supplier: { old: existingPO.supplierId },
              itemsTotal: { old: existingPO.itemsTotal || "0" },
              status: { old: existingPO.status },
            },
          });
        } catch { /* non-fatal */ }
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
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ message: "Invalid id" });
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
        try {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "delete",
            tableName: "containers",
            recordId: existingContainer.id,
            recordIdentifier: existingContainer.containerNumber || `Container #${id}`,
            changes: {
              containerNumber: { old: existingContainer.containerNumber },
              status: { old: existingContainer.status },
              importDate: { old: existingContainer.importDate },
            },
          });
        } catch { /* non-fatal */ }
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

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
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

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
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
