/**
 * factoryContainersRoutes: FactoryContainerOtherCharges endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { parseId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { resolveStoredFxRate, UnresolvedExchangeRateError } from "../../../services/factory/currencyConversion";
import { getOrFetchFxRateToUsd, getOrCreateLedgerAccount } from "../_helpers";
import { factoryContainers, voucherEntries, factoryContainerOtherCharges, vouchers } from "@shared/schema";
import { eq, and, inArray, ilike } from "drizzle-orm";
import { normFactoryEntry } from "./_helpers";

export function registerFactoryContainerOtherChargesRoutes(app: Express) {
  app.get("/api/factory/containers/:id/other-charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const charges = await db
        .select()
        .from(factoryContainerOtherCharges)
        .where(
          and(
            eq(factoryContainerOtherCharges.containerId, containerId),
            eq(factoryContainerOtherCharges.companyId, companyId)
          )
        )
        .orderBy(factoryContainerOtherCharges.createdAt);
      res.json(charges);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/containers/:id/other-charges/sync", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const { charges, isCreate } = req.body as {
        charges: { description: string; amount: string; currencyCode?: string; ledgerAccountId?: number | null }[];
        isCreate?: boolean;
      };

      // Void any previously created other-charge vouchers for this container (to avoid duplicates on edit)
      const ocPrefix = `FACTORY-OC-${containerId}-%`;
      const existingVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.sourceModule, "FACTORY"),
            ilike(vouchers.voucherNumber, ocPrefix)
          )
        );
      if (existingVouchers.length > 0) {
        const vIds = existingVouchers.map((v) => v.id);
        await db.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
        await db.delete(vouchers).where(inArray(vouchers.id, vIds));
      }

      await db
        .delete(factoryContainerOtherCharges)
        .where(
          and(
            eq(factoryContainerOtherCharges.containerId, containerId),
            eq(factoryContainerOtherCharges.companyId, companyId)
          )
        );

      let newCharges: any[] = [];
      if (charges && charges.length > 0) {
        const resolvedCharges = await Promise.all(
          charges.map(async (c) => {
            let ledgerAccountId = c.ledgerAccountId || null;
            if (!ledgerAccountId && c.description?.trim()) {
              const code = ("OC_" + c.description.toUpperCase().replace(/[^A-Z0-9]/g, "_")).slice(0, 50);
              ledgerAccountId = await getOrCreateLedgerAccount(companyId, code, c.description);
            }
            return {
              companyId,
              containerId,
              description: c.description,
              amount: c.amount,
              currencyCode: c.currencyCode || "USD",
              ledgerAccountId,
            };
          })
        );
        newCharges = await db.insert(factoryContainerOtherCharges).values(resolvedCharges).returning();
      }

      const total = charges?.reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0) ?? 0;
      await db
        .update(factoryContainers)
        .set({ otherCharges: total.toFixed(2) })
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      // Double-entry for each other charge: Dr Factory Charges Payable / Cr chosen account
      if (newCharges.length > 0) {
        const [container] = await db
          .select({
            supplierId: factoryContainers.supplierId,
            containerNumber: factoryContainers.containerNumber,
            currencyCode: factoryContainers.currencyCode,
            fxRateToUsd: factoryContainers.fxRateToUsd,
            fxRateConfirmed: (factoryContainers as any).fxRateConfirmed,
            arrivalDate: factoryContainers.arrivalDate,
            createdAt: factoryContainers.createdAt,
          })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

        if (container) {
          const today = getClientDate(req);
          const containerCreatedDate = container.createdAt
            ? new Date(container.createdAt).toISOString().slice(0, 10)
            : today;
          const voucherDate = container.arrivalDate || containerCreatedDate;
          for (const charge of newCharges) {
            const chargeAmt = parseFloat(charge.amount || "0");
            if (chargeAmt <= 0 || !charge.ledgerAccountId) continue;
            // Use the charge's own currency, not the container's currency
            const chargeCcy = charge.currencyCode || container.currencyCode || "USD";
            let chargeFxRate: string;
            if (chargeCcy === "USD") {
              chargeFxRate = "1";
            } else if (chargeCcy === (container.currencyCode || "USD")) {
              const { fxRate, looksSet } = resolveStoredFxRate(
                chargeCcy,
                container.fxRateToUsd,
                (container as any).fxRateConfirmed
              );
              if (!looksSet) {
                return res.status(400).json({ message: new UnresolvedExchangeRateError(chargeCcy).message });
              }
              chargeFxRate = String(fxRate);
            } else {
              chargeFxRate = await getOrFetchFxRateToUsd(companyId, chargeCcy, voucherDate);
            }
            const ocVoucherNum = `FACTORY-OC-${containerId}-${charge.id}-${Date.now()}`;
            const [ocVoucher] = await db
              .insert(vouchers)
              .values({
                companyId,
                voucherType: "Journal",
                voucherNumber: ocVoucherNum,
                voucherDate,
                description: `${charge.description} - container ${container.containerNumber}`,
                totalAmount: String(chargeAmt),
                currency: chargeCcy,
                exchangeRate: chargeFxRate,
                sourceModule: "FACTORY",
              })
              .returning();
            // Dr Factory Charges Payable
            const payableAccId = await getOrCreateLedgerAccount(
              companyId,
              "FACTORY_CHARGES_PAYABLE",
              "Factory Charges Payable"
            );
            await db.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: payableAccId,
              ...normFactoryEntry(chargeCcy, String(chargeAmt), "0", chargeFxRate),
              narration: `${charge.description} payable - container ${container.containerNumber}`,
            });
            // Cr chosen account (credit = I owe this person)
            await db.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: charge.ledgerAccountId,
              ...normFactoryEntry(chargeCcy, "0", String(chargeAmt), chargeFxRate),
              narration: `${charge.description} - container ${container.containerNumber}`,
            });
          }
        }
      }

      res.json({ charges: newCharges, total: total.toFixed(2) });
    } catch (error: unknown) {
      logger.error("Error syncing container other charges:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
