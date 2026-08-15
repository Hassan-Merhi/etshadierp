import type { Pool } from "pg";

import { logger } from "../../lib/logger";

import { canonicalStockMovementJournal } from "../../startup-schema/021-canonical-stock-movement-journal";

/**
 * Creates the canonical stock movement journal regardless of migration mode.
 *
 * Stock transfers write their canonical evidence inside the same transaction
 * that applies inventory, so these tables must exist wherever the application
 * runs — including production, which skips the ordered startup pass via
 * RUN_STARTUP_MIGRATIONS=false.
 *
 * This rejects rather than resolving on failure. A deployment that cannot
 * record stock evidence must fail loudly at startup instead of serving
 * transfers that apply stock with no journal behind them.
 */
export async function ensureCanonicalStockMovementJournal(pool: Pool): Promise<void> {
  for (const statement of canonicalStockMovementJournal) {
    await pool.query(statement);
  }
  logger.info("[startup] ✓ Canonical stock movement journal ensured");
}
