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

export function registerContainerAccountingRoutes(app: Express) {
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
            sql`UPDATE vouchers SET description = REPLACE(description, ${oldNumber}, ${newNumber}) WHERE description LIKE ${"%" + oldNumber + "%"}`
          );
          await db.execute(
            sql`UPDATE voucher_entries SET narration = REPLACE(narration, ${oldNumber}, ${newNumber}) WHERE narration LIKE ${"%" + oldNumber + "%"}`
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

      const pos = await db.select().from(purchaseOrders).where(eq(purchaseOrders.containerId, id));

      const parentCompanyId = await storage.getParentCompanyId();
      let updatedLocalVouchers = 0;
      let updatedParentVouchers = 0;
      const skipped: string[] = [];
      const errors: string[] = [];

      for (const po of pos) {
        const { grossTotal: poTotal, intercoTotal: poIntercoTotal } = calcPoAmounts({
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
        const poFreight = parseFloat(po.freight || "0");
        const poFreightParentAccountId: number | null = (po as any).freightParentAccountId
          ? Number((po as any).freightParentAccountId)
          : null;
        const poFreightOwnAccountId: number | null = (po as any).freightOwnAccountId
          ? Number((po as any).freightOwnAccountId)
          : null;
        const hasParentFreight = poFreightPaidBy === "parent" && poFreight > 0 && !!poFreightParentAccountId;
        const hasOwnFreight = poFreightPaidBy === "own" && poFreight > 0 && !!poFreightOwnAccountId;
        const hasEmbeddedFreight = hasParentFreight || hasOwnFreight;
        // Which account to credit for freight inside the purchase voucher
        const freightAccountId = hasParentFreight
          ? poFreightParentAccountId
          : hasOwnFreight
            ? poFreightOwnAccountId
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
              await db.update(vouchers).set({ description: expectedDesc }).where(eq(vouchers.id, voucherRow.id));
            }
          }

          const entries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, po.voucherId));

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
              const isDebit = parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
              const isCredit = parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;

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
              await db
                .update(voucherEntries)
                .set({ creditAmount: poTotal.toFixed(2), debitAmount: "0" })
                .where(eq(voucherEntries.id, parentCreditEntryId));
            } else if (parentCreditAcctId) {
              await db.insert(voucherEntries).values({
                voucherId: po.voucherId,
                ledgerAccountId: parentCreditAcctId,
                debitAmount: "0",
                creditAmount: poTotal.toFixed(2),
                narration: `PO ${po.poNumber} - Credit to parent`,
              });
            }

            // Re-insert goods DR + freight DR fresh
            if (purchasesAcctId) {
              await db.insert(voucherEntries).values([
                {
                  voucherId: po.voucherId,
                  ledgerAccountId: purchasesAcctId,
                  debitAmount: poIntercoTotal.toFixed(2),
                  creditAmount: "0",
                  narration: `${po.poNumber}`,
                },
                {
                  voucherId: po.voucherId,
                  ledgerAccountId: purchasesAcctId,
                  debitAmount: poFreight.toFixed(2),
                  creditAmount: "0",
                  narration: `Freight - ${po.poNumber}${container.containerNumber ? ` (${container.containerNumber})` : ""}`,
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
                  await db
                    .update(voucherEntries)
                    .set({ debitAmount: poIntercoTotal.toFixed(2), creditAmount: "0" })
                    .where(eq(voucherEntries.id, entry.id));
                }
              } else if (isCredit) {
                if ((entry as any).ledgerAccountId === freightAccountId) {
                  // Freight CR entry — update to current freight amount
                  freightCrFound = true;
                  await db
                    .update(voucherEntries)
                    .set({ creditAmount: poFreight.toFixed(2) })
                    .where(eq(voucherEntries.id, entry.id));
                } else {
                  // Goods CR entry (supplier account) — update to intercoTotal
                  await db
                    .update(voucherEntries)
                    .set({ creditAmount: poIntercoTotal.toFixed(2), debitAmount: "0" })
                    .where(eq(voucherEntries.id, entry.id));
                }
              }
            }
            // If no freight CR entry exists yet, add the freight pair
            if (!freightCrFound && purchasesAcctId) {
              await db.insert(voucherEntries).values([
                {
                  voucherId: po.voucherId,
                  ledgerAccountId: purchasesAcctId,
                  debitAmount: poFreight.toFixed(2),
                  creditAmount: "0",
                  narration: `Freight - ${po.poNumber}${container.containerNumber ? ` (${container.containerNumber})` : ""}`,
                },
                {
                  voucherId: po.voucherId,
                  ledgerAccountId: freightAccountId,
                  debitAmount: "0",
                  creditAmount: poFreight.toFixed(2),
                  narration: `Freight - ${po.poNumber}${container.containerNumber ? ` (${container.containerNumber})` : ""}`,
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
                await db
                  .update(voucherEntries)
                  .set({ debitAmount: poLocalTotal.toFixed(2), creditAmount: "0" })
                  .where(eq(voucherEntries.id, entry.id));
              } else {
                await db
                  .update(voucherEntries)
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
            db,
            po.poNumber,
            poTotal,
            container.containerNumber,
            hasParentFreight
              ? {
                  freightAmount: poFreight,
                  freightParentAccountId: poFreightParentAccountId!,
                  subsidiaryCompanyId: po.companyId,
                }
              : undefined
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
        const containerNumberMap = new Map<number, string>(allContainerRows.map((c) => [c.id, c.containerNumber]));

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
              itemsTotal: po.itemsTotal,
              freight: po.freight,
              surcharge: po.surcharge,
              fumigation: po.fumigation,
              documentCharges: po.documentCharges,
              discount: po.discount,
              otherCharges: po.otherCharges,
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
              ? Number((po as any).freightParentAccountId)
              : null;
            const poFreightOwnAccountId: number | null = (po as any).freightOwnAccountId
              ? Number((po as any).freightOwnAccountId)
              : null;
            const hasParentFreight = poFreightPaidBy === "parent" && poFreight > 0 && !!poFreightParentAccountId;
            const hasOwnFreight = poFreightPaidBy === "own" && poFreight > 0 && !!poFreightOwnAccountId;
            const hasEmbeddedFreight = hasParentFreight || hasOwnFreight;
            const freightAccountId = hasParentFreight
              ? poFreightParentAccountId
              : hasOwnFreight
                ? poFreightOwnAccountId
                : null;

            const poContainerId = po.containerId;
            const cNum = poContainerId
              ? (containerNumberMap.get(poContainerId) ?? String(poContainerId))
              : String(po.id);
            const isSameCompanyPo = !parentCompanyId || po.companyId === parentCompanyId;

            // ── Fix the local purchase voucher ────────────────────────────────
            // Expected total:
            //   parent-freight (with or without account) → grossTotal (child owes parent the full amount)
            //   own-embedded freight                     → grossTotal
            //   all other cases                          → intercoTotal (goods only)
            const expectedLocalTotal =
              hasEmbeddedFreight || (poFreightPaidBy === "parent" && poFreight > 0) ? grossTotal : intercoTotal;
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
                let freightEntryMissing = false;
                if (hasParentFreight) {
                  if (isSameCompanyPo) {
                    // Same-company: freight CR entry must exist at freightParentAccountId
                    const freightCrEntry = entries.find(
                      (e: any) =>
                        Number(e.ledgerAccountId) === poFreightParentAccountId &&
                        parseFloat(e.creditAmount || "0") > 0 &&
                        parseFloat(e.debitAmount || "0") === 0
                    );
                    freightEntryMissing =
                      !freightCrEntry ||
                      Math.abs(parseFloat((freightCrEntry as any).creditAmount || "0") - poFreight) > 0.001;
                  } else {
                    // Interco: detect old single-DR structure or wrong DR sum → needs rebuild
                    const drEntries = entries.filter(
                      (e: any) => parseFloat(e.debitAmount || "0") > 0 && parseFloat(e.creditAmount || "0") === 0
                    );
                    const drSum = drEntries.reduce((s: number, e: any) => s + parseFloat(e.debitAmount || "0"), 0);
                    const strayFreightCr = poFreightParentAccountId
                      ? entries.some(
                          (e: any) =>
                            Number((e as any).ledgerAccountId) === poFreightParentAccountId &&
                            parseFloat(e.creditAmount || "0") > 0
                        )
                      : false;
                    freightEntryMissing =
                      drEntries.length !== 2 || Math.abs(drSum - grossTotal) > 0.001 || strayFreightCr;
                  }
                } else if (hasOwnFreight) {
                  // Own-freight: freight CR to freightAccountId must exist in child's voucher
                  const freightCrEntry = entries.find(
                    (e: any) => e.ledgerAccountId === freightAccountId && parseFloat(e.creditAmount || "0") > 0
                  );
                  freightEntryMissing = !freightCrEntry;
                }
                const localMismatch = Math.abs(currentLocalTotal - expectedLocalTotal) > 0.001 || freightEntryMissing;

                if (localMismatch) {
                  console.log(
                    `[SyncAll] PO ${po.poNumber}: local voucher #${po.voucherId} ${currentLocalTotal} → ${expectedLocalTotal}`
                  );
                  await db
                    .update(vouchers)
                    .set({ totalAmount: expectedLocalTotal.toFixed(2) })
                    .where(eq(vouchers.id, po.voucherId));

                  if (hasParentFreight) {
                    if (isSameCompanyPo) {
                      // Same-company: embed freight into the PO voucher.
                      // User pays freight themselves — freight account is a payable (CR).
                      //   DR Purchases (grossTotal — goods + freight)
                      //   CR (supplier/payable entry) (intercoTotal — goods only)
                      //   CR freightParentAccountId (freight)
                      let purchasesEntryId: number | null = null;
                      let freightCrEntryId: number | null = null;
                      let mainCrEntryId: number | null = null;
                      const toDeleteIds: number[] = [];
                      const freightCrCandidates3: number[] = [];
                      for (const entry of entries) {
                        const acctId = (entry as any).ledgerAccountId as number | null;
                        const isDebit =
                          parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
                        const isCredit =
                          parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;
                        if (isCredit && acctId === poFreightParentAccountId) {
                          freightCrCandidates3.push(entry.id);
                        } else if (isDebit && purchasesEntryId === null) {
                          purchasesEntryId = entry.id;
                        } else if (isCredit && mainCrEntryId === null) {
                          mainCrEntryId = entry.id;
                        } else {
                          toDeleteIds.push(entry.id);
                        }
                      }
                      freightCrEntryId = freightCrCandidates3[0] ?? null;
                      toDeleteIds.push(...freightCrCandidates3.slice(1));
                      if (toDeleteIds.length > 0)
                        await db.delete(voucherEntries).where(inArray(voucherEntries.id, toDeleteIds));
                      if (purchasesEntryId !== null)
                        await db
                          .update(voucherEntries)
                          .set({ debitAmount: grossTotal.toFixed(2), creditAmount: "0" })
                          .where(eq(voucherEntries.id, purchasesEntryId));
                      if (mainCrEntryId !== null)
                        await db
                          .update(voucherEntries)
                          .set({ creditAmount: intercoTotal.toFixed(2), debitAmount: "0" })
                          .where(eq(voucherEntries.id, mainCrEntryId));
                      const _syncAllFreightNarration = `Freight - ${po.poNumber}${cNum && cNum !== String(po.id) ? ` (${cNum})` : ""}`;
                      if (freightCrEntryId !== null) {
                        await db
                          .update(voucherEntries)
                          .set({
                            creditAmount: poFreight.toFixed(2),
                            debitAmount: "0",
                            ledgerAccountId: poFreightParentAccountId!,
                            narration: _syncAllFreightNarration,
                          })
                          .where(eq(voucherEntries.id, freightCrEntryId));
                      } else {
                        await db.insert(voucherEntries).values({
                          voucherId: po.voucherId,
                          ledgerAccountId: poFreightParentAccountId!,
                          debitAmount: "0",
                          creditAmount: poFreight.toFixed(2),
                          narration: _syncAllFreightNarration,
                        });
                      }
                      updatedFreightVouchers++;
                    } else {
                      // Interco: delete-and-rebuild approach.
                      //   DR Purchases (intercoTotal — goods)
                      //   DR Purchases (freight — same account)
                      //   CR parentCreditAccount (grossTotal)
                      const childSettings = await storage.getCompanySettings(po.companyId);
                      const parentCreditAcctId = childSettings?.parentCreditAccountId ?? null;

                      let parentCreditEntryId: number | null = null;
                      let purchasesAcctId: number | null = null;
                      const toDeleteIds: number[] = [];

                      for (const entry of entries) {
                        const acctId = (entry as any).ledgerAccountId as number | null;
                        const isDebit =
                          parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
                        const isCredit =
                          parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;

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
                        await db
                          .update(voucherEntries)
                          .set({ creditAmount: grossTotal.toFixed(2), debitAmount: "0" })
                          .where(eq(voucherEntries.id, parentCreditEntryId));
                      } else if (parentCreditAcctId) {
                        await db.insert(voucherEntries).values({
                          voucherId: po.voucherId,
                          ledgerAccountId: parentCreditAcctId,
                          debitAmount: "0",
                          creditAmount: grossTotal.toFixed(2),
                          narration: `PO ${po.poNumber} - Credit to parent`,
                        });
                      }

                      if (purchasesAcctId) {
                        await db.insert(voucherEntries).values([
                          {
                            voucherId: po.voucherId,
                            ledgerAccountId: purchasesAcctId,
                            debitAmount: intercoTotal.toFixed(2),
                            creditAmount: "0",
                            narration: `${po.poNumber}`,
                          },
                          {
                            voucherId: po.voucherId,
                            ledgerAccountId: purchasesAcctId,
                            debitAmount: poFreight.toFixed(2),
                            creditAmount: "0",
                            narration: `Freight - ${po.poNumber}${cNum && cNum !== String(po.id) ? ` (${cNum})` : ""}`,
                          },
                        ]);
                      }
                    } // end interco branch
                  } else if (hasOwnFreight) {
                    // Own-freight: DR Purchases (goods) + DR FreightOwnAccount (freight)
                    //              CR Supplier (goods) + CR FreightOwnAccount (freight)
                    let purchasesAcctId: number | null = null;
                    let freightCrFound = false;
                    for (const entry of entries) {
                      const isDebit =
                        parseFloat(entry.debitAmount || "0") > 0 && parseFloat(entry.creditAmount || "0") === 0;
                      const isCredit =
                        parseFloat(entry.creditAmount || "0") > 0 && parseFloat(entry.debitAmount || "0") === 0;
                      if (isDebit) {
                        if (!purchasesAcctId) purchasesAcctId = (entry as any).ledgerAccountId ?? null;
                        if ((entry as any).ledgerAccountId !== freightAccountId) {
                          await db
                            .update(voucherEntries)
                            .set({ debitAmount: intercoTotal.toFixed(2), creditAmount: "0" })
                            .where(eq(voucherEntries.id, entry.id));
                        }
                      } else if (isCredit) {
                        if ((entry as any).ledgerAccountId === freightAccountId) {
                          freightCrFound = true;
                          await db
                            .update(voucherEntries)
                            .set({ creditAmount: poFreight.toFixed(2) })
                            .where(eq(voucherEntries.id, entry.id));
                        } else {
                          await db
                            .update(voucherEntries)
                            .set({ creditAmount: intercoTotal.toFixed(2), debitAmount: "0" })
                            .where(eq(voucherEntries.id, entry.id));
                        }
                      }
                    }
                    if (!freightCrFound && purchasesAcctId) {
                      await db.insert(voucherEntries).values([
                        {
                          voucherId: po.voucherId,
                          ledgerAccountId: purchasesAcctId,
                          debitAmount: poFreight.toFixed(2),
                          creditAmount: "0",
                          narration: `Freight - ${po.poNumber}${cNum && cNum !== String(po.id) ? ` (${cNum})` : ""}`,
                        },
                        {
                          voucherId: po.voucherId,
                          ledgerAccountId: freightAccountId,
                          debitAmount: "0",
                          creditAmount: poFreight.toFixed(2),
                          narration: `Freight - ${po.poNumber}${cNum && cNum !== String(po.id) ? ` (${cNum})` : ""}`,
                        },
                      ]);
                    }
                  } else {
                    // Standard supplier-paid freight: all entries → expectedLocalTotal
                    for (const entry of entries) {
                      const origDebit = parseFloat(entry.debitAmount || "0");
                      const origCredit = parseFloat(entry.creditAmount || "0");
                      const isDebit =
                        origDebit > 0 && origCredit === 0
                          ? true
                          : origCredit > 0 && origDebit === 0
                            ? false
                            : !entry.supplierId;
                      if (isDebit) {
                        await db
                          .update(voucherEntries)
                          .set({ debitAmount: expectedLocalTotal.toFixed(2), creditAmount: "0" })
                          .where(eq(voucherEntries.id, entry.id));
                      } else {
                        await db
                          .update(voucherEntries)
                          .set({ creditAmount: expectedLocalTotal.toFixed(2), debitAmount: "0" })
                          .where(eq(voucherEntries.id, entry.id));
                      }
                    }
                  }
                  updatedLocalVouchers++;
                }
              }
            }

            // ── Fix the parent INTERCO-PARENT voucher ───────────────────────
            if (parentCompanyId && po.companyId !== parentCompanyId) {
              const svResult = await syncIntercoParentVoucher(
                db,
                po.poNumber,
                grossTotal,
                cNum,
                hasParentFreight
                  ? {
                      freightAmount: poFreight,
                      freightParentAccountId: poFreightParentAccountId!,
                      subsidiaryCompanyId: po.companyId,
                    }
                  : undefined
              );
              if (svResult.updated) {
                updatedParentVouchers++;
              } else if (!svResult.found) {
                notFoundParentVouchers.push(`PO ${po.poNumber}: no INTERCO-PARENT voucher in parent company`);
              }
            }
            // ── Stale FREIGHT- voucher cleanup / missing parent freight account warning ──
            const freightVoucherNum = `FREIGHT-${cNum}-${po.poNumber}`;
            if (poFreightPaidBy === "parent" && poFreight > 0 && !(po as any).freightParentAccountId) {
              missingParentFreightAccount.push(
                `PO ${po.poNumber}: freight set to parent-paid but no parent account configured`
              );
            }

            // Freight is now embedded inside the purchase voucher — delete any stale FREIGHT- voucher.
            // Search in the PO's own company, NOT the session company, so the parent company's
            // freight vouchers are never accidentally deleted when processing subsidiary POs.
            {
              const [staleFV] = await db
                .select({ id: vouchers.id })
                .from(vouchers)
                .where(and(eq(vouchers.companyId, po.companyId), eq(vouchers.voucherNumber, freightVoucherNum)))
                .limit(1);
              if (staleFV) {
                await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, staleFV.id));
                await db.delete(vouchers).where(eq(vouchers.id, staleFV.id));
                updatedFreightVouchers++;
              }
            }

            // ── Stale PARENT-FREIGHT- journal cleanup (same-company POs only) ──
            // These journals were wrongly created when a same-company PO had parent freight.
            // Freight is embedded in the PO voucher, so the standalone journal is wrong — delete it.
            if (isSameCompanyPo && poFreightPaidBy === "parent") {
              const parentFreightVoucherNum = `PARENT-FREIGHT-${po.poNumber}`;
              const [stalePFV] = await db
                .select({ id: vouchers.id })
                .from(vouchers)
                .where(and(eq(vouchers.companyId, po.companyId), eq(vouchers.voucherNumber, parentFreightVoucherNum)))
                .limit(1);
              if (stalePFV) {
                await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, stalePFV.id));
                await db.delete(vouchers).where(eq(vouchers.id, stalePFV.id));
                updatedFreightVouchers++;
                console.log(`[SyncAll] Deleted stale PARENT-FREIGHT journal for same-company PO ${po.poNumber}`);
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
              return (
                sum +
                parseFloat(p.freight || "0") +
                parseFloat(p.surcharge || "0") +
                parseFloat(p.fumigation || "0") +
                parseFloat(p.documentCharges || "0") -
                parseFloat(p.discount || "0") +
                parseFloat(p.otherCharges || "0")
              );
            }, 0);
            const containerGrandTotal = containerItemsTotal + containerChargesTotal;

            const [existingContainer] = await db
              .select({
                id: containers.id,
                itemsTotal: containers.itemsTotal,
                chargesTotal: containers.chargesTotal,
                grandTotal: containers.grandTotal,
              })
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
                await db
                  .update(containers)
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
                { chargeType: "Freight", amount: containerPos.reduce((s, p) => s + parseFloat(p.freight || "0"), 0) },
                {
                  chargeType: "Surcharge",
                  amount: containerPos.reduce((s, p) => s + parseFloat(p.surcharge || "0"), 0),
                },
                {
                  chargeType: "Fumigation",
                  amount: containerPos.reduce((s, p) => s + parseFloat(p.fumigation || "0"), 0),
                },
                {
                  chargeType: "Document Charges",
                  amount: containerPos.reduce((s, p) => s + parseFloat(p.documentCharges || "0"), 0),
                },
                {
                  chargeType: "Discount",
                  amount: -containerPos.reduce((s, p) => s + parseFloat(p.discount || "0"), 0),
                },
                {
                  chargeType: "Other Charges",
                  amount: containerPos.reduce((s, p) => s + parseFloat(p.otherCharges || "0"), 0),
                },
              ];
              for (const { chargeType, amount } of summedCharges) {
                const [existingCharge] = await db
                  .select({ id: containerCharges.id, amount: containerCharges.amount })
                  .from(containerCharges)
                  .where(and(eq(containerCharges.containerId, cid), eq(containerCharges.chargeType, chargeType)))
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
                      await db
                        .update(containerCharges)
                        .set({ amount: amount.toFixed(2) })
                        .where(eq(containerCharges.id, existingCharge.id));
                    } else {
                      await db
                        .insert(containerCharges)
                        .values({ containerId: cid, chargeType, amount: amount.toFixed(2) });
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
        console.log(
          `[SyncAll] Done. POs=${scannedPOs} Containers=${scannedContainers} LocalVouchers=${updatedLocalVouchers} ParentVouchers=${updatedParentVouchers} FreightVouchers=${updatedFreightVouchers} ContainerCharges=${updatedContainerCharges} ContainerTotals=${updatedContainers} Skipped=${skipped.length} NotFound=${notFoundParentVouchers.length} Errors=${errors.length}`
        );

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
}
