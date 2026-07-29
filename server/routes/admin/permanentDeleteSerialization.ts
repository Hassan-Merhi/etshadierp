import type { NextFunction, Request, Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "../../db";
import { logger } from "../../lib/logger";

const PERMANENT_DELETE_LOCK_NAMESPACE = 20260729;

/**
 * Bulk Deleted Items actions currently issue several DELETE requests together.
 * Factory mix batches can reference one another, so concurrent cleanup
 * transactions can lock the same source rows in opposite order. Hold one
 * PostgreSQL advisory lock per company for the full request lifetime. Advisory
 * locks are database-wide, so this remains correct if the app runs on multiple
 * processes or instances.
 */
export async function serializeDeletedItemPermanentDeletes(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.method !== "DELETE") {
    next();
    return;
  }

  const companyId = req.session.currentCompanyId;
  if (!companyId || !req.session.userId) {
    next();
    return;
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("SELECT pg_advisory_lock($1::integer, $2::integer)", [
      PERMANENT_DELETE_LOCK_NAMESPACE,
      companyId,
    ]);

    let released = false;
    const release = (): void => {
      if (released || !client) return;
      released = true;
      const lockedClient = client;
      client = undefined;

      void lockedClient
        .query("SELECT pg_advisory_unlock($1::integer, $2::integer)", [
          PERMANENT_DELETE_LOCK_NAMESPACE,
          companyId,
        ])
        .catch((error: unknown) => {
          logger.error("Failed to release permanent-delete advisory lock", {
            error,
            companyId,
          });
        })
        .finally(() => lockedClient.release());
    };

    res.once("finish", release);
    res.once("close", release);
    next();
  } catch (error: unknown) {
    client?.release();
    next(error);
  }
}
