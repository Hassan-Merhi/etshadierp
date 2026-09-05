import type { Express, NextFunction, Request, Response } from "express";
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import {
  accountingPostingRequests,
  intercompanyPaymentRequests,
  salesItems,
  voucherEntries,
  vouchers,
} from "@shared/schema";
import { requireAuth, requireRole } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { storage } from "../../storage";
import { getAccessibleCompanyIds } from "../../security/companyAccessBoundary";
import { applyEmployeeBalanceDeltasTx } from "../../services/accounting/employeeBalancePosting";
import { removeFactoryDaybookMirrorTx } from "../../services/accounting/factoryDaybookMirrorRemoval";
import { createDatabaseStockMovementAdapter } from "../../services/inventory/databaseStockMovementAdapter";
import { postStockMovementTx } from "../../services/inventory/stockMovementIntegrityService";
import { getCompanyRequestRuntimeContext, runWithCompanyRequestRuntimeContext } from "../../services/security/companyRequestRuntimeContext";
import {
  createTenantDatabaseScope,
  runWithDatabaseScopeRuntimeContext,
} from "../../services/security/databaseScopeRuntimeContext";
import { adjustInventory } from "../../inventoryHelper";
import { buildVoucherChangesForDelete, logAudit, snapshotVoucherEntries } from "../_helpers";

const GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE = "golden-coast-pos-settlement";
const canonicalStockMovementAdapter = createDatabaseStockMovementAdapter();

type SettlementRole = "payable_reclass" | "gc_cash_transfer" | "hadi_cash_receipt";

type SettlementMarker = {
  id: number;
  companyId: number;
  voucherId: number;
  sourceId: string;
};

function parseSettlementSourceId(sourceId: string): {
  clientSaleId: string;
  digest: string;
  role: SettlementRole;
} | null {
  const parts = sourceId.split(":");
  if (parts.length < 4) return null;
  const role = parts[parts.length - 1] as SettlementRole;
  if (!["payable_reclass", "gc_cash_transfer", "hadi_cash_receipt"].includes(role)) return null;
  const clientSaleId = parts[0]?.trim();
  const digest = parts[1]?.trim();
  if (!clientSaleId || !digest) return null;
  return { clientSaleId, digest, role };
}

function isCashTransferRole(role: SettlementRole): boolean {
  return role === "gc_cash_transfer" || role === "hadi_cash_receipt";
}

function isExactClientPrefix(sourceId: string, clientSaleId: string): boolean {
  return sourceId.startsWith(`${clientSaleId}:`);
}

function isExactDigestPrefix(sourceId: string, clientSaleId: string, digest: string): boolean {
  return sourceId.startsWith(`${clientSaleId}:${digest}:`);
}

async function runWithAccessibleCompanyScope<T>(companyId: number, run: () => Promise<T>): Promise<T> {
  const requestContext = getCompanyRequestRuntimeContext();
  if (!requestContext) throw new Error("Golden Coast POS deletion requires an active company request context");

  const accessible = [...(await getAccessibleCompanyIds(requestContext.userId))];
  if (!accessible.includes(companyId)) throw new Error("Active company is not accessible to the current user");
  const authorizedCompanyIds = accessible.filter((id) => id !== companyId);

  return runWithCompanyRequestRuntimeContext({ ...requestContext, authorizedCompanyIds }, () =>
    runWithDatabaseScopeRuntimeContext(
      createTenantDatabaseScope(companyId, authorizedCompanyIds, "authorized-companies"),
      run
    )
  );
}

async function currentCompanySettlementMarkers(companyId: number, clientSaleId?: string): Promise<SettlementMarker[]> {
  const filters = [
    eq(accountingPostingRequests.companyId, companyId),
    eq(accountingPostingRequests.sourceType, GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE),
  ];
  if (clientSaleId) filters.push(ilike(accountingPostingRequests.sourceId, `${clientSaleId}:%`));

  const rows = await db
    .select({
      id: accountingPostingRequests.id,
      companyId: accountingPostingRequests.companyId,
      voucherId: accountingPostingRequests.voucherId,
      sourceId: accountingPostingRequests.sourceId,
    })
    .from(accountingPostingRequests)
    .where(and(...filters));

  return rows
    .map((row) => ({
      id: Number(row.id),
      companyId: Number(row.companyId),
      voucherId: Number(row.voucherId),
      sourceId: String(row.sourceId),
    }))
    .filter((row) => !clientSaleId || isExactClientPrefix(row.sourceId, clientSaleId));
}

async function handleGoldenCoastPosDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
  const startedAt = Date.now();
  const voucherId = Number(req.params.id);
  const companyId = Number(req.session.currentCompanyId ?? 0);
  const userId = req.session.userId;

  if (!Number.isInteger(voucherId) || voucherId <= 0) {
    res.status(400).json({ message: "Invalid voucher ID" });
    return;
  }
  if (!Number.isInteger(companyId) || companyId <= 0) {
    res.status(400).json({ message: "No company selected" });
    return;
  }

  try {
    const voucher = await storage.getVoucherById(voucherId);
    if (!voucher) {
      res.status(404).json({ message: "Voucher not found" });
      return;
    }
    if (voucher.companyId !== companyId) {
      res.status(403).json({ message: "Access denied: Voucher belongs to a different company" });
      return;
    }

    const saleRows = await db.select({ id: salesItems.id }).from(salesItems).where(eq(salesItems.voucherId, voucherId)).limit(1);
    const possibleSourceClientSaleId = String(voucher.clientSaleId ?? "").trim();
    const sourceSaleCandidate =
      saleRows.length > 0 &&
      possibleSourceClientSaleId.length > 0 &&
      (voucher.voucherType === "Receipt" || voucher.voucherType === "Sales") &&
      !voucher.optional;

    const currentMarkers = await currentCompanySettlementMarkers(
      companyId,
      sourceSaleCandidate ? possibleSourceClientSaleId : undefined
    );
    const selectedMarker = currentMarkers.find((marker) => marker.voucherId === voucherId) ?? null;
    const selectedMarkerSource = selectedMarker ? parseSettlementSourceId(selectedMarker.sourceId) : null;
    const sourceAnchor = sourceSaleCandidate
      ? currentMarkers
          .map((marker) => ({ marker, parsed: parseSettlementSourceId(marker.sourceId) }))
          .find((item) => item.parsed?.clientSaleId === possibleSourceClientSaleId && isCashTransferRole(item.parsed.role)) ?? null
      : null;

    const manualCashTransferDelete = Boolean(selectedMarkerSource && isCashTransferRole(selectedMarkerSource.role));
    const sourcePosDelete = Boolean(sourceSaleCandidate && sourceAnchor);

    // This route only shadows the generic deletion path for the linked Golden
    // Coast cash-settlement lifecycle. Everything else keeps its existing route.
    if (!manualCashTransferDelete && !sourcePosDelete) {
      next();
      return;
    }

    const anchorMarker = manualCashTransferDelete ? selectedMarker! : sourceAnchor!.marker;
    const anchor = parseSettlementSourceId(anchorMarker.sourceId)!;
    const clientSaleId = anchor.clientSaleId;

    const deletion = await runWithAccessibleCompanyScope(companyId, async () => {
      // Resolve the exact company pair from the deterministic settlement digest.
      // This avoids treating a coincidentally reused clientSaleId in another
      // company as part of the same POS transaction.
      const anchorRowsRaw = await db
        .select({
          id: accountingPostingRequests.id,
          companyId: accountingPostingRequests.companyId,
          voucherId: accountingPostingRequests.voucherId,
          sourceId: accountingPostingRequests.sourceId,
        })
        .from(accountingPostingRequests)
        .where(
          and(
            eq(accountingPostingRequests.sourceType, GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE),
            ilike(accountingPostingRequests.sourceId, `${clientSaleId}:${anchor.digest}:%`)
          )
        );
      const anchorRows = anchorRowsRaw.filter((row) =>
        isExactDigestPrefix(String(row.sourceId), clientSaleId, anchor.digest)
      );
      const pairCompanyIds = [...new Set(anchorRows.map((row) => Number(row.companyId)))];
      if (!pairCompanyIds.includes(companyId)) pairCompanyIds.push(companyId);

      // A cash transfer is a two-company posting. Refuse a half-delete when the
      // counterpart exists but is not visible/authorized to this request.
      if (pairCompanyIds.length < 2) {
        throw new Error("Linked Golden Coast/HADI cash-transfer counterpart is missing or not accessible");
      }

      return db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT id FROM vouchers
          WHERE id = ${voucherId} AND company_id = ${companyId}
          FOR UPDATE
        `);

        const [lockedRequestedVoucher] = await tx
          .select()
          .from(vouchers)
          .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)))
          .limit(1);
        if (!lockedRequestedVoucher) throw new Error("Voucher not found");
        if (lockedRequestedVoucher.deletedAt) {
          return {
            replayed: true,
            requestedVoucher: lockedRequestedVoucher,
            requestedEntries: [] as (typeof voucherEntries.$inferSelect)[],
            linkedVoucherIds: [] as number[],
          };
        }

        const markerRowsRaw = await tx
          .select({
            id: accountingPostingRequests.id,
            companyId: accountingPostingRequests.companyId,
            voucherId: accountingPostingRequests.voucherId,
            sourceId: accountingPostingRequests.sourceId,
          })
          .from(accountingPostingRequests)
          .where(
            and(
              eq(accountingPostingRequests.sourceType, GOLDEN_COAST_POS_SETTLEMENT_SOURCE_TYPE),
              inArray(accountingPostingRequests.companyId, pairCompanyIds),
              ilike(accountingPostingRequests.sourceId, `${clientSaleId}:%`)
            )
          );

        const markerRows = markerRowsRaw
          .map((row) => ({
            id: Number(row.id),
            companyId: Number(row.companyId),
            voucherId: Number(row.voucherId),
            sourceId: String(row.sourceId),
          }))
          .filter((row) => isExactClientPrefix(row.sourceId, clientSaleId))
          .filter((row) => {
            if (sourcePosDelete) return true;
            const parsed = parseSettlementSourceId(row.sourceId);
            return Boolean(parsed && isCashTransferRole(parsed.role));
          });

        const linkedVoucherIds = [...new Set(markerRows.map((row) => row.voucherId))];
        const requestedEntries = await tx.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        if (sourcePosDelete) {
          const sourceItems = await tx.select().from(salesItems).where(eq(salesItems.voucherId, voucherId));
          if (!lockedRequestedVoucher.locationId) {
            throw new Error("Cannot delete Golden Coast POS sale: source voucher has no location");
          }

          for (const item of sourceItems) {
            const quantity = Number.parseFloat(item.quantity);
            const costPrice = Number.parseFloat(item.costPrice || "0");
            const inventoryResult = await adjustInventory(
              tx,
              lockedRequestedVoucher.locationId,
              item.stockItemId,
              quantity,
              companyId,
              costPrice
            );
            await postStockMovementTx(
              tx,
              {
                companyId,
                stockItemId: item.stockItemId,
                kind: "adjustment",
                quantity: String(quantity),
                unitCost: String(Math.max(costPrice || inventoryResult.averageRate || 0, 0)),
                toLocationId: lockedRequestedVoucher.locationId,
                occurredAt: new Date().toISOString(),
                source: {
                  sourceType: "voucher_delete_pos_sale",
                  sourceId: String(voucherId),
                  idempotencyKey: `voucher-delete:pos:${companyId}:${voucherId}:${item.id}`,
                },
                actor: {
                  userId: req.session.userId,
                  username: req.session.username,
                  reason: `Delete voucher ${lockedRequestedVoucher.voucherNumber}`,
                },
              },
              canonicalStockMovementAdapter
            );
          }

          await tx.delete(salesItems).where(eq(salesItems.voucherId, voucherId));
          await applyEmployeeBalanceDeltasTx({
            tx,
            companyId,
            entries: requestedEntries,
            direction: "reverse",
            missingEmployeeBehavior: "skip",
          });
          await tx
            .delete(intercompanyPaymentRequests)
            .where(and(eq(intercompanyPaymentRequests.fromVoucherId, voucherId), eq(intercompanyPaymentRequests.status, "pending")));
          await removeFactoryDaybookMirrorTx({ tx, companyId, voucherId });
          await tx
            .update(vouchers)
            .set({ deletedAt: new Date() })
            .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)));
        }

        // Remove idempotency markers first. The vouchers themselves are kept as
        // soft-deleted audit history, while balances/daybook views stop seeing
        // them immediately. The marker removal also makes a later legitimate
        // POS edit able to recreate a manually removed cash transfer cleanly.
        if (markerRows.length > 0) {
          await tx.delete(accountingPostingRequests).where(inArray(accountingPostingRequests.id, markerRows.map((row) => row.id)));
        }

        for (const linkedVoucherId of linkedVoucherIds) {
          const marker = markerRows.find((row) => row.voucherId === linkedVoucherId);
          if (!marker) continue;
          const [linkedVoucher] = await tx
            .select()
            .from(vouchers)
            .where(and(eq(vouchers.id, linkedVoucherId), eq(vouchers.companyId, marker.companyId)))
            .limit(1);
          if (!linkedVoucher || linkedVoucher.deletedAt) continue;
          if (!String(linkedVoucher.voucherNumber || "").startsWith("GC-POS-")) {
            throw new Error(`Refusing to delete non-Golden-Coast POS voucher ${linkedVoucherId}`);
          }
          await removeFactoryDaybookMirrorTx({ tx, companyId: marker.companyId, voucherId: linkedVoucherId });
          await tx
            .update(vouchers)
            .set({ deletedAt: new Date() })
            .where(and(eq(vouchers.id, linkedVoucherId), eq(vouchers.companyId, marker.companyId)));
        }

        return {
          replayed: false,
          requestedVoucher: lockedRequestedVoucher,
          requestedEntries,
          linkedVoucherIds,
        };
      });
    });

    if (!deletion.replayed) {
      try {
        const entrySnapshot = await snapshotVoucherEntries(deletion.requestedEntries);
        await logAudit({
          userId: userId!,
          username: req.session.username || "unknown",
          companyId,
          action: "delete",
          tableName: "vouchers",
          recordId: voucherId,
          recordIdentifier: deletion.requestedVoucher.voucherNumber,
          changes: buildVoucherChangesForDelete(deletion.requestedVoucher, entrySnapshot),
        });
      } catch (auditError: unknown) {
        logger.error("Golden Coast POS linked delete audit failed (non-fatal)", {
          companyId,
          voucherId,
          error: auditError,
        });
      }
    }

    logger.info("Golden Coast POS linked deletion succeeded", {
      module: "vouchers",
      action: sourcePosDelete ? "deleteGoldenCoastPosAndSettlement" : "deleteGoldenCoastCashSettlement",
      userId,
      companyId,
      voucherId,
      clientSaleId,
      linkedVoucherIds: deletion.linkedVoucherIds,
      replayed: deletion.replayed,
      durationMs: Date.now() - startedAt,
    });

    res.json({
      message: sourcePosDelete
        ? "POS sale and linked intercompany cash transfer deleted successfully"
        : "Intercompany cash transfer deleted successfully",
      replayed: deletion.replayed,
      linkedVoucherIds: deletion.linkedVoucherIds,
    });
  } catch (error: unknown) {
    logger.error("Golden Coast POS linked deletion failed", {
      module: "vouchers",
      action: "deleteGoldenCoastPosLinked",
      userId,
      companyId,
      voucherId,
      durationMs: Date.now() - startedAt,
      error,
    });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerGoldenCoastPosSettlementDeleteRoute(app: Express): void {
  app.delete(
    "/api/vouchers/:id",
    requireAuth,
    requireRole("Admin"),
    (req, res, next) => void handleGoldenCoastPosDelete(req, res, next)
  );
}
