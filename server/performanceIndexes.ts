import type { Pool } from "pg";
import { logger } from "./lib/logger";

let installationStarted = false;

const INDEX_STATEMENTS = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS factory_raw_stock_company_live_container_idx
     ON factory_raw_stock (company_id, container_id)
     WHERE deleted_at IS NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS factory_containers_company_live_supplier_status_idx
     ON factory_containers (company_id, supplier_id, status)
     WHERE deleted_at IS NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS factory_supplier_payments_company_supplier_date_idx
     ON factory_supplier_payments (company_id, supplier_id, date)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS factory_supplier_fx_transfers_company_from_date_idx
     ON factory_supplier_fx_transfers (company_id, from_supplier_id, date)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS factory_supplier_fx_transfers_company_to_date_idx
     ON factory_supplier_fx_transfers (company_id, to_supplier_id, date)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS factory_offload_charges_company_supplier_idx
     ON factory_offload_additional_charges (company_id, supplier_id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS factory_container_other_charges_company_container_idx
     ON factory_container_other_charges (company_id, container_id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS voucher_entries_factory_supplier_voucher_idx
     ON voucher_entries (factory_supplier_id, voucher_id)
     WHERE factory_supplier_id IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS vouchers_company_effective_date_idx
     ON vouchers (company_id, effective_date)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_order_bales_order_id_id_idx
     ON customer_order_bales (order_id, id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_order_bale_removals_order_id_id_idx
     ON customer_order_bale_removals (order_id, id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS factory_bales_company_status_created_idx
     ON factory_bales (company_id, status, created_at DESC)`,
] as const;

export function installPerformanceIndexes(pool: Pool): void {
  if (
    installationStarted ||
    process.env.SKIP_PERFORMANCE_INDEX_INSTALL === "1" ||
    process.env.ERP_EXPORT_WORKER === "1"
  ) {
    return;
  }
  installationStarted = true;

  const startDelayMs = Math.max(0, Number(process.env.PERFORMANCE_INDEX_START_DELAY_MS || 60_000));

  const timer = setTimeout(() => {
    void (async () => {
      logger.info("Performance index installation started", {
        module: "performance-indexes",
        action: "start",
        count: INDEX_STATEMENTS.length,
      });

      for (const statement of INDEX_STATEMENTS) {
        const startedAt = Date.now();
        try {
          await pool.query(statement);
          logger.info("Performance index ensured", {
            module: "performance-indexes",
            action: "ensure",
            durationMs: Date.now() - startedAt,
          });
        } catch (error) {
          logger.warn("Performance index could not be installed", {
            module: "performance-indexes",
            action: "ensure-failed",
            durationMs: Date.now() - startedAt,
            error,
          });
        }
      }

      logger.info("Performance index installation finished", {
        module: "performance-indexes",
        action: "complete",
      });
    })();
  }, startDelayMs);

  timer.unref();
}
