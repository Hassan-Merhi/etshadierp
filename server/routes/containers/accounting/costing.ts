/**
 * containerAccountingRoutes: ContainerCosting endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { storage } from "../../../storage";
import { requireAuth, requireRole, requireNonPOS } from "../../../auth";
import {
  containers,
  containerCharges,
  purchaseOrders,
  vouchers,
  voucherEntries,
  intercompanyPosConfigs,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { calcPoAmounts, syncIntercoParentVoucher } from "../containerHelpers";

export function registerContainerCostingRoutes(app: Express) {
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
              freightPaidBy: po.freightPaidBy,
            });

            if (grossTotal <= 0) {
              skipped.push(`PO ${po.poNumber}: total is 0 — skipped`);
              continue;
            }

            // Resolve freight info from calcPoAmounts result
            const poFreightPaidBy: string = po.freightPaidBy || "supplier";
            const poFreight = parseFloat(po.freight || "0");
            const poFreightParentAccountId: number | null = po.freightParentAccountId
              ? Number(po.freightParentAccountId)
              : null;
            const poFreightOwnAccountId: number | null = po.freightOwnAccountId ? Number(po.freightOwnAccountId) : null;
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
                      (e: unknown) =>
                        Number(e.ledgerAccountId) === poFreightParentAccountId &&
                        parseFloat(e.creditAmount || "0") > 0 &&
                        parseFloat(e.debitAmount || "0") === 0
                    );
                    freightEntryMissing =
                      !freightCrEntry || Math.abs(parseFloat(freightCrEntry.creditAmount || "0") - poFreight) > 0.001;
                  } else {
                    // Interco: detect old single-DR structure or wrong DR sum → needs rebuild
                    const drEntries = entries.filter(
                      (e: unknown) => parseFloat(e.debitAmount || "0") > 0 && parseFloat(e.creditAmount || "0") === 0
                    );
                    const drSum = drEntries.reduce((s: number, e: unknown) => s + parseFloat(e.debitAmount || "0"), 0);
                    const strayFreightCr = poFreightParentAccountId
                      ? entries.some(
                          (e: unknown) =>
                            Number(e.ledgerAccountId) === poFreightParentAccountId &&
                            parseFloat(e.creditAmount || "0") > 0
                        )
                      : false;
                    freightEntryMissing =
                      drEntries.length !== 2 || Math.abs(drSum - grossTotal) > 0.001 || strayFreightCr;
                  }
                } else if (hasOwnFreight) {
                  // Own-freight: freight CR to freightAccountId must exist in child's voucher
                  const freightCrEntry = entries.find(
                    (e: unknown) => e.ledgerAccountId === freightAccountId && parseFloat(e.creditAmount || "0") > 0
                  );
                  freightEntryMissing = !freightCrEntry;
                }
                const localMismatch = Math.abs(currentLocalTotal - expectedLocalTotal) > 0.001 || freightEntryMissing;

                if (localMismatch) {
                  logger.info(
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
                        const acctId = entry.ledgerAccountId as number | null;
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
                        const acctId = entry.ledgerAccountId as number | null;
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
                        if (!purchasesAcctId) purchasesAcctId = entry.ledgerAccountId ?? null;
                        if (entry.ledgerAccountId !== freightAccountId) {
                          await db
                            .update(voucherEntries)
                            .set({ debitAmount: intercoTotal.toFixed(2), creditAmount: "0" })
                            .where(eq(voucherEntries.id, entry.id));
                        }
                      } else if (isCredit) {
                        if (entry.ledgerAccountId === freightAccountId) {
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
            if (poFreightPaidBy === "parent" && poFreight > 0 && !po.freightParentAccountId) {
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
                logger.info(`[SyncAll] Deleted stale PARENT-FREIGHT journal for same-company PO ${po.poNumber}`);
              }
            }

            // INTERCO-FREIGHT vouchers are no longer created — freight is recorded
            // directly inside the purchase voucher. Legacy ones are left in place
            // (they can be deleted manually from the daybook if no longer needed).
          } catch (poErr: unknown) {
            errors.push(`PO ${po.poNumber}: ${getErrorMessage(poErr)}`);
            logger.error(`[SyncAll] Error processing PO ${po.poNumber}:`, { error: poErr });
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
          } catch (cErr: unknown) {
            errors.push(`Container ${cid}: ${getErrorMessage(cErr)}`);
          }
        }

        const scannedContainers = containerIds.length;
        logger.info(
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
      } catch (error: unknown) {
        logger.error("[SyncAll] Fatal error:", { error: error });
        res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );

  // Bulk import container tracking from Excel data
}
