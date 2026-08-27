import type { Express, Request, Response } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  bankAccounts,
  ledgerAccounts,
  locations,
  spContainerLines,
  spContainers,
  spOffloadCharges,
  spOffloads,
  spStockMovements,
  stockItems,
  voucherEntries,
  vouchers,
} from "@shared/schema";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { releaseDebtEnglish } from "../../i18n/finalCloseoutEnglish";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { resultRows } from "../../lib/queryResult";
import {
  privilegedMutationRateLimit,
  privilegedReadRateLimit,
  privilegedRequestBudget,
} from "../../middleware/privilegedEndpointSecurity";
import {
  PostingValidationError,
  postBalancedVoucherTx,
  type CentralPostingResult,
  type PostingActor,
} from "../../services/accounting/centralPostingEngine";
import { createDatabasePostingDependencies } from "../../services/accounting/databasePostingDependencies";
import {
  getGoldenCoastAccountDefinition,
  type GoldenCoastAccountRole,
} from "../../services/accounting/goldenCoastPhase2Accounts";
import {
  GOLDEN_COAST_CUTOVER_DATE,
  GOLDEN_COAST_CUTOVER_FIFO_SOURCE,
} from "../../services/accounting/goldenCoastPhase4CutoverFifo";
import {
  GOLDEN_COAST_PHASE8_OFFLOAD_FIFO_SOURCE,
  GOLDEN_COAST_PHASE8_SOURCE_TYPE,
  GoldenCoastPhase8Error,
  buildGoldenCoastPhase8FundingPosting,
  buildGoldenCoastPhase8OffloadPosting,
  parseGoldenCoastPhase8ContainerInput,
  parseGoldenCoastPhase8OffloadInput,
  planGoldenCoastPhase8Funding,
  planGoldenCoastPhase8Offload,
  type GoldenCoastPhase8FundedContainerState,
  type GoldenCoastPhase8PostingAccount,
  type GoldenCoastPhase8RoleAccounts,
} from "../../services/accounting/goldenCoastPhase8ContainerOffload";
import { adjustSpInventoryAtomic, respondToSpInventoryIntegrityError } from "../../services/sp/spInventoryIntegrity";
import {
  goldenCoastPhase3VoucherNumber,
  isGoldenCoastCompany,
  type DbLike,
} from "./spGoldenCoastPhase4CutoverFifoRoutes";
import { requireSpCompany } from "./spHelpers";

const postingDependencies = createDatabasePostingDependencies();
const phase8RequestBudget = privilegedRequestBudget({ maxBodyBytes: 64 * 1024, maxCollectionItems: 100 });
const PHASE8_MAX_LINES = 100;
const PHASE8_MAX_CHARGES = 50;
const PHASE8_ROLES = [
  "stock_otw",
  "stock_in_hand",
  "container_reserve",
  "hassan_equity",
  "hassan_savings",
] as const satisfies readonly GoldenCoastAccountRole[];

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type PersistedPostingResult = CentralPostingResult<typeof vouchers.$inferSelect, typeof voucherEntries.$inferSelect>;

class GoldenCoastPhase8RouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "GC_PHASE8_INVALID", status = 400) {
    super(releaseDebtEnglish(message));
    this.name = "GoldenCoastPhase8RouteError";
    this.code = code;
    this.status = status;
  }
}

function actorFromRequest(req: Request): PostingActor {
  return {
    userId: req.user?.id ?? req.session.userId ?? null,
    username: req.session.username ?? null,
    reason: "Golden Coast Phase 8 container/offload",
  };
}

async function resolveCanonicalRoleAccount(
  conn: DbLike,
  companyId: number,
  role: GoldenCoastAccountRole
): Promise<number> {
  const definition = getGoldenCoastAccountDefinition(role);
  const rows = await conn
    .select({ id: ledgerAccounts.id, accountType: ledgerAccounts.accountType, name: ledgerAccounts.name })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.subType, definition.subType),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt)
      )
    )
    .orderBy(asc(ledgerAccounts.id))
    .limit(2);
  if (rows.length !== 1) {
    throw new GoldenCoastPhase8RouteError(
      rows.length === 0
        ? `Golden Coast role ${role} is missing; run Golden Coast account setup first`
        : `Golden Coast role ${role} is ambiguous; repair duplicate ${definition.subType} accounts first`,
      "GC_PHASE8_ROLES_INVALID",
      409
    );
  }
  const row = rows[0];
  if (!definition.acceptedAccountTypes.includes(String(row.accountType))) {
    throw new GoldenCoastPhase8RouteError(
      `Golden Coast role ${role} must use ${definition.acceptedAccountTypes.join(" or ")}; account "${row.name}" is ${row.accountType}`,
      "GC_PHASE8_ROLES_INVALID",
      409
    );
  }
  return Number(row.id);
}

async function resolveRoleAccounts(conn: DbLike, companyId: number): Promise<GoldenCoastPhase8RoleAccounts> {
  const [stockOtw, stockInHand, reserve, hassanEquity, hassanSavings] = await Promise.all(
    PHASE8_ROLES.map((role) => resolveCanonicalRoleAccount(conn, companyId, role))
  );
  return {
    stockOtwAccountId: stockOtw,
    stockInHandAccountId: stockInHand,
    containerReserveAccountId: reserve,
    hassanEquityAccountId: hassanEquity,
    hassanSavingsAccountId: hassanSavings,
  };
}

async function assertPhase8Ready(conn: DbLike, companyId: number): Promise<number> {
  if (!(await isGoldenCoastCompany(conn, companyId))) {
    throw new GoldenCoastPhase8RouteError(
      "Golden Coast account setup is not configured for this company",
      "GC_PHASE8_NOT_CONFIGURED",
      409
    );
  }
  await resolveRoleAccounts(conn, companyId);

  // The durable "the cutover happened" marker is the Phase 3 voucher, not the
  // Phase 4 lot count: Phase 4 skips zero-quantity inventory, so a company that
  // carried no stock in hand across the cutover legitimately ends with an empty
  // FIFO bridge. Gating on the lot count alone would lock those companies out of
  // Phase 8 permanently.
  const cutoverVoucherResult = await conn.execute(sql`
    SELECT id
    FROM vouchers
    WHERE company_id = ${companyId}
      AND voucher_number = ${goldenCoastPhase3VoucherNumber(companyId)}
      AND deleted_at IS NULL
    LIMIT 1
  `);
  if (!resultRows(cutoverVoucherResult)[0]) {
    throw new GoldenCoastPhase8RouteError(
      `Golden Coast ${GOLDEN_COAST_CUTOVER_DATE} cutover must be posted before Phase 8 container activity`,
      "GC_PHASE8_NOT_READY",
      409
    );
  }

  const bridgeResult = await conn.execute(sql`
    SELECT COUNT(*)::int AS lot_count
    FROM sp_stock_movements
    WHERE company_id = ${companyId}
      AND source_type = ${GOLDEN_COAST_CUTOVER_FIFO_SOURCE}
  `);
  const bridgeCount = Number(resultRows(bridgeResult)[0]?.lot_count ?? 0);
  if (bridgeCount <= 0) {
    // No lots yet is only legitimate when there was nothing for Phase 4 to
    // bridge. Mirror the plan builder's own filter: it skips zero-quantity
    // inventory rows and bridges every other one.
    const pendingResult = await conn.execute(sql`
      SELECT COUNT(*)::int AS pending_count
      FROM inventory inv
      INNER JOIN locations loc ON loc.id = inv.location_id AND loc.company_id = ${companyId}
      WHERE inv.company_id = ${companyId}
        AND CAST(inv.quantity AS numeric) <> 0
    `);
    if (Number(resultRows(pendingResult)[0]?.pending_count ?? 0) > 0) {
      throw new GoldenCoastPhase8RouteError(
        `Golden Coast ${GOLDEN_COAST_CUTOVER_DATE} cutover FIFO bridge must be posted before Phase 8 container activity`,
        "GC_PHASE8_NOT_READY",
        409
      );
    }
  }
  return bridgeCount;
}

async function validateFundingAccount(
  conn: DbLike,
  companyId: number,
  account: GoldenCoastPhase8PostingAccount
): Promise<void> {
  if (account.kind === "bank") {
    const [row] = await conn
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, account.id),
          eq(bankAccounts.companyId, companyId),
          eq(bankAccounts.active, true),
          isNull(bankAccounts.deletedAt)
        )
      )
      .limit(1);
    if (!row) {
      throw new GoldenCoastPhase8RouteError(
        "fundingAccount must reference an active bank account in this company",
        "GC_PHASE8_FUNDING_ACCOUNT_INVALID"
      );
    }
    return;
  }
  const [row] = await conn
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.id, account.id),
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt),
        inArray(ledgerAccounts.accountType, ["Cash", "Bank"])
      )
    )
    .limit(1);
  if (!row) {
    throw new GoldenCoastPhase8RouteError(
      "fundingAccount must reference an active Cash/Bank ledger account in this company",
      "GC_PHASE8_FUNDING_ACCOUNT_INVALID"
    );
  }
}

async function validateStockItems(conn: DbLike, companyId: number, ids: readonly number[]): Promise<void> {
  const unique = [...new Set(ids)];
  const rows = await conn
    .select({ id: stockItems.id })
    .from(stockItems)
    .where(
      and(
        eq(stockItems.companyId, companyId),
        inArray(stockItems.id, unique),
        eq(stockItems.active, true),
        isNull(stockItems.deletedAt)
      )
    );
  const found = new Set(rows.map((row) => Number(row.id)));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new GoldenCoastPhase8RouteError(
      `Container lines reference inactive, deleted, or foreign stock item(s): ${missing.join(", ")}`,
      "GC_PHASE8_STOCK_ITEM_INVALID"
    );
  }
}

async function validateSupplier(conn: DbLike, companyId: number, supplierId: number | null): Promise<void> {
  if (supplierId == null) return;
  const result = await conn.execute(sql`
    SELECT s.id
    FROM suppliers s
    INNER JOIN stock_groups sg ON sg.id = s.stock_group_id
    WHERE s.id = ${supplierId}
      AND s.active = true
      AND s.deleted_at IS NULL
      AND sg.company_id = ${companyId}
    LIMIT 1
  `);
  if (!resultRows(result)[0]) {
    throw new GoldenCoastPhase8RouteError(
      "supplierId must reference an active supplier mapped to this company; otherwise omit supplierId and retain supplierName",
      "GC_PHASE8_SUPPLIER_INVALID"
    );
  }
}

async function validateLocation(conn: DbLike, companyId: number, locationId: number): Promise<void> {
  const [row] = await conn
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.id, locationId),
        eq(locations.companyId, companyId),
        eq(locations.active, true),
        isNull(locations.deletedAt)
      )
    )
    .limit(1);
  if (!row) {
    throw new GoldenCoastPhase8RouteError(
      `Location ${locationId} is not an active location in this company`,
      "GC_PHASE8_LOCATION_INVALID"
    );
  }
}

async function loadFundedContainer(
  tx: DatabaseTransaction,
  companyId: number,
  containerId: number,
  accounts: GoldenCoastPhase8RoleAccounts
): Promise<GoldenCoastPhase8FundedContainerState> {
  const [container] = await tx
    .select()
    .from(spContainers)
    .where(and(eq(spContainers.id, containerId), eq(spContainers.companyId, companyId)))
    .limit(1)
    .for("update");
  if (!container) {
    throw new GoldenCoastPhase8RouteError(
      "Container was not found in this company",
      "GC_PHASE8_CONTAINER_NOT_FOUND",
      404
    );
  }
  if (!container.goodsOtwVoucherId) {
    throw new GoldenCoastPhase8RouteError(
      "Container does not have a Phase 8 funding voucher",
      "GC_PHASE8_CONTAINER_NOT_FUNDED",
      409
    );
  }
  if (container.status === "cancelled") {
    throw new GoldenCoastPhase8RouteError(
      "Cancelled containers cannot be offloaded",
      "GC_PHASE8_CONTAINER_CLOSED",
      409
    );
  }

  const markerResult = await tx.execute(sql`
    SELECT source_id
    FROM accounting_posting_requests
    WHERE company_id = ${companyId}
      AND voucher_id = ${container.goodsOtwVoucherId}
      AND source_type = ${GOLDEN_COAST_PHASE8_SOURCE_TYPE}
    ORDER BY id
  `);
  const markers = resultRows(markerResult);
  if (markers.length !== 1 || !String(markers[0].source_id ?? "").endsWith(":fund")) {
    throw new GoldenCoastPhase8RouteError(
      "Container funding voucher is not an unambiguous Golden Coast Phase 8 funding posting",
      "GC_PHASE8_CONTAINER_NOT_FUNDED",
      409
    );
  }

  const entries = await tx
    .select()
    .from(voucherEntries)
    .where(eq(voucherEntries.voucherId, container.goodsOtwVoucherId));
  const stockEntry = entries.filter(
    (entry) => Number(entry.ledgerAccountId) === accounts.stockOtwAccountId && Number(entry.debitAmount) > 0
  );
  const reserveEntry = entries.filter(
    (entry) => Number(entry.ledgerAccountId) === accounts.containerReserveAccountId && Number(entry.debitAmount) > 0
  );
  const creditEntries = entries.filter((entry) => Number(entry.creditAmount) > 0);
  if (stockEntry.length !== 1 || reserveEntry.length > 1 || creditEntries.length !== 1) {
    throw new GoldenCoastPhase8RouteError(
      "Phase 8 funding voucher no longer has the expected Stock OTW / Container Reserve / funding shape",
      "GC_PHASE8_FUNDING_CORRUPT",
      409
    );
  }
  const credit = creditEntries[0];
  const fundingAccount: GoldenCoastPhase8PostingAccount = credit.bankAccountId
    ? { kind: "bank", id: Number(credit.bankAccountId) }
    : credit.ledgerAccountId
      ? { kind: "ledger", id: Number(credit.ledgerAccountId) }
      : (() => {
          throw new GoldenCoastPhase8RouteError(
            "Phase 8 funding credit has no bank/ledger target",
            "GC_PHASE8_FUNDING_CORRUPT",
            409
          );
        })();
  await validateFundingAccount(tx, companyId, fundingAccount);

  const goodsCostUsd = Number(stockEntry[0].debitAmount).toFixed(2);
  const reserveUsd = reserveEntry.length === 1 ? Number(reserveEntry[0].debitAmount).toFixed(2) : "0.00";
  const expectedCredit = Number(goodsCostUsd) + Number(reserveUsd);
  if (Math.abs(Number(credit.creditAmount) - expectedCredit) > 0.005) {
    throw new GoldenCoastPhase8RouteError(
      "Phase 8 funding voucher is not balanced to its funded assets",
      "GC_PHASE8_FUNDING_CORRUPT",
      409
    );
  }

  const lineRows = await tx
    .select()
    .from(spContainerLines)
    .where(and(eq(spContainerLines.containerId, containerId), eq(spContainerLines.companyId, companyId)))
    .orderBy(asc(spContainerLines.id));
  if (lineRows.length === 0) {
    throw new GoldenCoastPhase8RouteError("Funded container has no lines", "GC_PHASE8_FUNDING_CORRUPT", 409);
  }
  const lines = lineRows.map((line) => ({
    stockItemId: Number(line.stockItemId),
    articleCode: String(line.articleCode),
    description: line.description == null ? null : String(line.description),
    qty: String(line.qty),
    unitRateUsd: String(line.unitRateUsd),
  }));
  await validateStockItems(
    tx,
    companyId,
    lines.map((line) => line.stockItemId)
  );
  const lineValue = lines.reduce((sum, line) => sum + Number(line.qty) * Number(line.unitRateUsd), 0);
  if (Math.abs(lineValue - Number(goodsCostUsd)) > 0.01) {
    throw new GoldenCoastPhase8RouteError(
      "Container lines no longer reconcile to the funded Stock OTW amount",
      "GC_PHASE8_FUNDING_CORRUPT",
      409
    );
  }

  return {
    containerId,
    companyId,
    fundingVoucherId: Number(container.goodsOtwVoucherId),
    goodsCostUsd,
    reserveUsd,
    fundingAccount,
    lines,
  };
}

function respondKnownError(res: Response, error: unknown): boolean {
  if (error instanceof GoldenCoastPhase8RouteError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return true;
  }
  if (error instanceof GoldenCoastPhase8Error) {
    const status = error.code === "GC_PHASE8_RESERVE_EXCEEDED" ? 409 : 400;
    res.status(status).json({ code: error.code, message: error.message });
    return true;
  }
  if (error instanceof PostingValidationError) {
    const status = error.code.includes("IDEMPOTENCY") ? 409 : 400;
    res.status(status).json({ code: error.code, message: error.message });
    return true;
  }
  return false;
}

async function handleReadiness(req: Request, res: Response): Promise<void> {
  try {
    const companyId = await requireSpCompany(req, res);
    if (!companyId) return;
    const blockers: string[] = [];
    let bridgeCount = 0;
    try {
      bridgeCount = await assertPhase8Ready(db, companyId);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
    }
    const openResult = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM sp_containers
      WHERE company_id = ${companyId} AND status = 'open'
    `);
    res.json({
      phase: 8,
      cutoverDate: GOLDEN_COAST_CUTOVER_DATE,
      bridgeCount,
      cutoverVoucherNumber: goldenCoastPhase3VoucherNumber(companyId),
      openContainers: Number(resultRows(openResult)[0]?.count ?? 0),
      blockers,
      canPost: blockers.length === 0,
    });
  } catch (error) {
    logger.error("Golden Coast Phase 8 readiness failed", { error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function handleCreateContainer(req: Request, res: Response): Promise<void> {
  let companyId: number | null = null;
  try {
    companyId = await requireSpCompany(req, res);
    if (!companyId) return;
    const selectedCompany = companyId;
    const containerInput = parseGoldenCoastPhase8ContainerInput({
      companyId: selectedCompany,
      body: req.body,
      maxLines: PHASE8_MAX_LINES,
    });
    const plan = planGoldenCoastPhase8Funding(containerInput);
    const actor = actorFromRequest(req);

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`golden-coast-phase8:${selectedCompany}`}))`);
      await assertPhase8Ready(tx, selectedCompany);
      const accounts = await resolveRoleAccounts(tx, selectedCompany);
      await validateFundingAccount(tx, selectedCompany, containerInput.fundingAccount);
      await validateStockItems(
        tx,
        selectedCompany,
        containerInput.lines.map((line) => line.stockItemId)
      );
      await validateSupplier(tx, selectedCompany, containerInput.supplierId);

      const postingRequest = buildGoldenCoastPhase8FundingPosting({ container: containerInput, plan, accounts, actor });
      const posted = (await postBalancedVoucherTx(tx, postingRequest, postingDependencies)) as PersistedPostingResult;
      const [existing] = await tx
        .select()
        .from(spContainers)
        .where(
          and(
            eq(spContainers.companyId, selectedCompany),
            eq(spContainers.goodsOtwVoucherId, Number(posted.voucher.id))
          )
        )
        .limit(1);
      if (existing) {
        const lines = await tx
          .select()
          .from(spContainerLines)
          .where(and(eq(spContainerLines.containerId, existing.id), eq(spContainerLines.companyId, selectedCompany)))
          .orderBy(asc(spContainerLines.id));
        return { container: existing, lines, posting: posted, plan, replayed: true };
      }
      if (posted.replayed) {
        throw new GoldenCoastPhase8RouteError(
          "Phase 8 funding replay exists without its container source document",
          "GC_PHASE8_IDEMPOTENCY_CORRUPT",
          409
        );
      }

      const [container] = await tx
        .insert(spContainers)
        .values({
          companyId: selectedCompany,
          supplierId: containerInput.supplierId,
          supplierName: containerInput.supplierName,
          containerNumber: containerInput.containerNumber,
          invoiceNumber: containerInput.invoiceNumber,
          invoiceDate: containerInput.invoiceDate,
          invoiceTotalUsd: plan.goodsCostUsd,
          discountPct: "0",
          freightEstimateUsd: "0",
          status: "open",
          goodsOtwVoucherId: Number(posted.voucher.id),
          notes: containerInput.notes,
        })
        .returning();
      const lines = await tx
        .insert(spContainerLines)
        .values(
          containerInput.lines.map((line) => ({
            containerId: container.id,
            companyId: selectedCompany,
            articleCode: line.articleCode,
            description: line.description,
            qty: line.qty,
            unitRateUsd: line.unitRateUsd,
            stockItemId: line.stockItemId,
          }))
        )
        .returning();
      return { container, lines, posting: posted, plan, replayed: false };
    });
    res.json(result);
  } catch (error) {
    if (respondKnownError(res, error)) return;
    logger.error("Golden Coast Phase 8 container funding failed", { companyId, error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function handleOffload(req: Request, res: Response): Promise<void> {
  let companyId: number | null = null;
  try {
    companyId = await requireSpCompany(req, res);
    if (!companyId) return;
    const selectedCompany = companyId;
    const offloadInput = parseGoldenCoastPhase8OffloadInput({
      companyId: selectedCompany,
      body: req.body,
      maxCharges: PHASE8_MAX_CHARGES,
    });
    const actor = actorFromRequest(req);

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`golden-coast-phase8:${selectedCompany}`}))`);
      await assertPhase8Ready(tx, selectedCompany);
      const accounts = await resolveRoleAccounts(tx, selectedCompany);
      await validateLocation(tx, selectedCompany, offloadInput.locationId);
      const funded = await loadFundedContainer(tx, selectedCompany, offloadInput.containerId, accounts);
      const plan = planGoldenCoastPhase8Offload({ offload: offloadInput, funded });
      const postingRequest = buildGoldenCoastPhase8OffloadPosting({
        offload: offloadInput,
        funded,
        plan,
        accounts,
        actor,
      });

      const [existingOffload] = await tx
        .select()
        .from(spOffloads)
        .where(and(eq(spOffloads.companyId, selectedCompany), eq(spOffloads.containerId, offloadInput.containerId)))
        .limit(1);
      if (existingOffload) {
        if (!existingOffload.voucherIdStock) {
          throw new GoldenCoastPhase8RouteError(
            "Existing offload has no Phase 8 voucher link",
            "GC_PHASE8_IDEMPOTENCY_CORRUPT",
            409
          );
        }
        const marker = await tx.execute(sql`
          SELECT source_id
          FROM accounting_posting_requests
          WHERE company_id = ${selectedCompany}
            AND voucher_id = ${existingOffload.voucherIdStock}
            AND source_type = ${GOLDEN_COAST_PHASE8_SOURCE_TYPE}
          LIMIT 2
        `);
        const markers = resultRows(marker);
        if (markers.length !== 1 || String(markers[0].source_id ?? "") !== postingRequest.source.sourceId) {
          throw new GoldenCoastPhase8RouteError(
            "Container is already offloaded under a different request or payload",
            "GC_PHASE8_IDEMPOTENCY_CONFLICT",
            409
          );
        }
        const movements = await tx
          .select()
          .from(spStockMovements)
          .where(
            and(eq(spStockMovements.companyId, selectedCompany), eq(spStockMovements.offloadId, existingOffload.id))
          )
          .orderBy(asc(spStockMovements.id));
        return { offload: existingOffload, movements, plan, replayed: true };
      }

      const posted = (await postBalancedVoucherTx(tx, postingRequest, postingDependencies)) as PersistedPostingResult;
      if (posted.replayed) {
        throw new GoldenCoastPhase8RouteError(
          "Phase 8 offload replay exists without its offload source document",
          "GC_PHASE8_IDEMPOTENCY_CORRUPT",
          409
        );
      }
      const [offload] = await tx
        .insert(spOffloads)
        .values({
          companyId: selectedCompany,
          containerId: offloadInput.containerId,
          offloadDate: offloadInput.offloadDate,
          totalQty: plan.totalQty,
          totalBaseCostUsd: plan.goodsCostUsd,
          totalLandedCostUsd: plan.actualChargesUsd,
          totalFinalCostUsd: plan.totalFinalCostUsd,
          voucherIdReversal: null,
          voucherIdStock: Number(posted.voucher.id),
        })
        .returning();
      if (offloadInput.charges.length > 0) {
        await tx.insert(spOffloadCharges).values(
          offloadInput.charges.map((charge) => ({
            offloadId: offload.id,
            companyId: selectedCompany,
            chargeType: charge.chargeType,
            description: charge.description,
            amountUsd: charge.amountUsd,
          }))
        );
      }

      const movementRows = [];
      const lineRows = await tx
        .select()
        .from(spContainerLines)
        .where(
          and(
            eq(spContainerLines.containerId, offloadInput.containerId),
            eq(spContainerLines.companyId, selectedCompany)
          )
        )
        .orderBy(asc(spContainerLines.id));
      const lineIdByStock = new Map(lineRows.map((line) => [Number(line.stockItemId), Number(line.id)]));
      for (const line of plan.lines) {
        const [movement] = await tx
          .insert(spStockMovements)
          .values({
            companyId: selectedCompany,
            containerId: offloadInput.containerId,
            offloadId: offload.id,
            containerLineId: lineIdByStock.get(line.stockItemId) ?? null,
            sourceType: GOLDEN_COAST_PHASE8_OFFLOAD_FIFO_SOURCE,
            articleCode: line.articleCode,
            description: line.description,
            stockItemId: line.stockItemId,
            locationId: offloadInput.locationId,
            qtyIn: line.qty,
            qtyRemaining: line.qty,
            baseUnitCostUsd: line.baseUnitCostUsd,
            landedUnitCostUsd: line.landedUnitCostUsd,
            finalUnitCostUsd: line.finalUnitCostUsd,
          })
          .returning();
        movementRows.push(movement);
        await adjustSpInventoryAtomic(tx, {
          companyId: selectedCompany,
          locationId: offloadInput.locationId,
          stockItemId: line.stockItemId,
          deltaQty: Number(line.qty),
          incomingRate: Number(line.finalUnitCostUsd),
          context: `Golden Coast Phase 8 offload #${offload.id}`,
          sourceVoucherType: GOLDEN_COAST_PHASE8_OFFLOAD_FIFO_SOURCE,
          sourceVoucherId: Number(posted.voucher.id),
        });
      }
      await tx
        .update(spContainers)
        .set({ status: "offloaded" })
        .where(and(eq(spContainers.id, offloadInput.containerId), eq(spContainers.companyId, selectedCompany)));
      return { offload, movements: movementRows, posting: posted, plan, replayed: false };
    });
    res.json(result);
  } catch (error) {
    if (respondToSpInventoryIntegrityError(res, error)) return;
    if (respondKnownError(res, error)) return;
    logger.error("Golden Coast Phase 8 offload failed", { companyId, error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerSpGoldenCoastPhase8ContainerOffloadRoutes(app: Express): void {
  app.get(
    "/api/sp/golden-coast/phase8/container-offload/readiness",
    privilegedReadRateLimit,
    requireAuth,
    (req, res) => void handleReadiness(req, res)
  );
  app.post(
    "/api/sp/golden-coast/phase8/containers",
    privilegedMutationRateLimit,
    phase8RequestBudget,
    requireAuth,
    (req, res) => void handleCreateContainer(req, res)
  );
  app.post(
    "/api/sp/golden-coast/phase8/offload",
    privilegedMutationRateLimit,
    phase8RequestBudget,
    requireAuth,
    (req, res) => void handleOffload(req, res)
  );
}
