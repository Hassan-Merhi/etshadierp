import type { Express, NextFunction, Request, Response } from "express";
import { pool } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  buildSpOffloadChargeSignature,
  classifySpOffloadState,
  isCompatibleSpOffloadReplay,
  normalizeSpOffloadDate,
} from "../../services/sp/spOffloadConcurrencyPolicy";
import { requireSpCompany } from "./spHelpers";

async function guardSpOffload(req: Request, res: Response, next: NextFunction): Promise<void> {
  const companyId = await requireSpCompany(req as any, res as any);
  if (!companyId) return;

  const containerId = Number(req.body?.containerId);
  if (!Number.isInteger(containerId) || containerId <= 0) {
    res.status(400).json({ message: "containerId is required" });
    return;
  }

  const locationId = Number(req.body?.locationId);
  if (!Number.isInteger(locationId) || locationId <= 0) {
    res.status(400).json({ message: "locationId is required" });
    return;
  }

  const client = await pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [companyId, containerId]);
    } catch (error) {
      logger.warn("SP offload advisory unlock failed", { companyId, containerId, error });
    } finally {
      client.release();
    }
  };

  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [companyId, containerId]
    );
    if (!lockResult.rows[0]?.locked) {
      client.release();
      released = true;
      res.status(409).json({
        code: "SP_OFFLOAD_IN_PROGRESS",
        message: "This container is currently being offloaded. Wait for the first request to finish before retrying.",
      });
      return;
    }

    res.once("finish", () => void release());
    res.once("close", () => void release());

    const containerResult = await client.query<{ status: string }>(
      "SELECT status FROM sp_containers WHERE id = $1 AND company_id = $2 LIMIT 1",
      [containerId, companyId]
    );
    const container = containerResult.rows[0];
    if (!container) {
      res.status(404).json({ message: "Container not found" });
      return;
    }

    const locationResult = await client.query(
      "SELECT id FROM locations WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL LIMIT 1",
      [locationId, companyId]
    );
    if (!locationResult.rows[0]) {
      res.status(400).json({ message: "Invalid location for this company" });
      return;
    }

    const existingResult = await client.query(
      `SELECT o.id,
              o.company_id AS "companyId",
              o.container_id AS "containerId",
              o.offload_date AS "offloadDate",
              o.total_qty AS "totalQty",
              o.total_base_cost_usd AS "totalBaseCostUsd",
              o.total_landed_cost_usd AS "totalLandedCostUsd",
              o.total_final_cost_usd AS "totalFinalCostUsd",
              o.voucher_id_reversal AS "voucherIdReversal",
              o.voucher_id_stock AS "voucherIdStock",
              o.created_at AS "createdAt",
              (SELECT sm.location_id
               FROM sp_stock_movements sm
               WHERE sm.offload_id = o.id
               ORDER BY sm.id
               LIMIT 1) AS "locationId"
       FROM sp_offloads o
       WHERE o.container_id = $1 AND o.company_id = $2
       ORDER BY o.id DESC
       LIMIT 1`,
      [containerId, companyId]
    );
    const existingOffload = existingResult.rows[0] ?? null;

    let existingChargeSignature = buildSpOffloadChargeSignature([]);
    if (existingOffload) {
      const existingCharges = await client.query(
        `SELECT charge_type AS "chargeType",
                description,
                amount_usd AS "amountUsd",
                prepaid_charge_id AS "prepaidChargeId",
                credit_ledger_account_id AS "creditLedgerAccountId",
                credit_bank_account_id AS "creditBankAccountId"
         FROM sp_offload_charges
         WHERE offload_id = $1 AND company_id = $2`,
        [existingOffload.id, companyId]
      );
      existingChargeSignature = buildSpOffloadChargeSignature(existingCharges.rows);
    }

    const requestedCharges = Array.isArray(req.body?.chargeLines) ? req.body.chargeLines : [];
    const requestedLandedTotal = requestedCharges.reduce(
      (sum: number, charge: any) => sum + (Number.isFinite(Number(charge?.amountUsd)) ? Number(charge.amountUsd) : 0),
      0
    );
    const replayCompatible = existingOffload
      ? isCompatibleSpOffloadReplay(
          {
            offloadDate: normalizeSpOffloadDate(existingOffload.offloadDate),
            locationId: Number(existingOffload.locationId),
            totalLandedCostUsd: Number(existingOffload.totalLandedCostUsd ?? 0),
            chargeSignature: existingChargeSignature,
          },
          {
            offloadDate: normalizeSpOffloadDate(req.body?.offloadDate),
            locationId,
            totalLandedCostUsd: requestedLandedTotal,
            chargeSignature: buildSpOffloadChargeSignature(requestedCharges),
          }
        )
      : false;
    const decision = classifySpOffloadState(container.status, Boolean(existingOffload), replayCompatible);

    if (decision === "replay") {
      const { locationId: _locationId, ...responseOffload } = existingOffload;
      res.setHeader("X-Idempotent-Replay", "true");
      res.json(responseOffload);
      return;
    }
    if (decision === "conflict") {
      res.status(409).json({
        code: "SP_OFFLOAD_REPLAY_MISMATCH",
        message: "This container is already offloaded with different date, location, or charge allocation.",
      });
      return;
    }
    if (decision === "reject") {
      res.status(409).json({
        code: "SP_CONTAINER_NOT_OPEN",
        message: "Container is not open and has no completed offload to replay.",
      });
      return;
    }

    next();
  } catch (error: unknown) {
    await release();
    logger.error("SP offload concurrency guard failed", { companyId, containerId, error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Register before the legacy SP offload route. */
export function registerSpOffloadConcurrencyGuard(app: Express): void {
  app.post("/api/sp/offload", requireAuth, (req, res, next) => {
    void guardSpOffload(req, res, next);
  });
}
