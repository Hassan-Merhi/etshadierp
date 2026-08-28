import { pool } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  getDatabaseScopeRuntimeContext,
  runWithDatabaseMaintenanceScope,
} from "../security/databaseScopeRuntimeContext";

type DeferredRentReclassificationOrigin = "startup" | "request";

let inFlight: Promise<void> | null = null;
let completed = false;
const completedTenantCompanies = new Set<number>();

const POSTGRES_DEADLOCK_SQLSTATE = "40P01";
const DEADLOCK_RETRY_DELAYS_MS = [100, 250, 500] as const;

const RECLASSIFY_DEFERRED_RENT_SQL = `
DO $reclass$
DECLARE
  company_row RECORD;
  deferred_id INTEGER;
  income_id INTEGER;
  credit_balance NUMERIC;
  transfer_amount NUMERIC;
  created_voucher_id INTEGER;
BEGIN
  -- Serialize this one-time repair across overlapping app instances/deploys.
  -- The per-company lock below still protects each tenant from request retries.
  PERFORM pg_advisory_xact_lock(734209999);

  FOR company_row IN
    SELECT id, name
    FROM companies
    WHERE active = true
      AND company_type = 'properties'
      AND CASE
        WHEN erp_company_scope_maintenance_enabled() THEN true
        ELSE id = erp_current_company_id()
      END
    ORDER BY id
  LOOP
    PERFORM pg_advisory_xact_lock(734210000 + company_row.id);

    SELECT id
    INTO deferred_id
    FROM ledger_accounts
    WHERE company_id = company_row.id
      AND deleted_at IS NULL
      AND (code = 'DEF-RENT-REV' OR LOWER(TRIM(name)) = 'deferred rent revenue')
    ORDER BY CASE WHEN code = 'DEF-RENT-REV' THEN 0 ELSE 1 END, id
    LIMIT 1;

    SELECT id
    INTO income_id
    FROM ledger_accounts
    WHERE company_id = company_row.id
      AND deleted_at IS NULL
      AND (
        code = 'RENT-INC'
        OR LOWER(TRIM(name)) = 'rental income - properties'
        OR LOWER(TRIM(name)) = 'rental income'
      )
    ORDER BY
      CASE
        WHEN code = 'RENT-INC' THEN 0
        WHEN LOWER(TRIM(name)) = 'rental income - properties' THEN 1
        ELSE 2
      END,
      id
    LIMIT 1;

    IF deferred_id IS NOT NULL THEN
      PERFORM 1 FROM ledger_accounts WHERE id = deferred_id FOR UPDATE;

      SELECT
        CASE
          WHEN la.opening_balance_side = 'Dr' THEN -COALESCE(la.opening_balance, 0)::numeric
          ELSE COALESCE(la.opening_balance, 0)::numeric
        END
        + COALESCE(
            SUM(
              CASE
                WHEN v.deleted_at IS NULL THEN
                  COALESCE(ve.base_credit_amount, ve.credit_amount, 0)::numeric
                  - COALESCE(ve.base_debit_amount, ve.debit_amount, 0)::numeric
                ELSE 0
              END
            ),
            0
          )
      INTO credit_balance
      FROM ledger_accounts la
      LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
      LEFT JOIN vouchers v ON v.id = ve.voucher_id
      WHERE la.id = deferred_id
      GROUP BY la.id, la.opening_balance, la.opening_balance_side;

      IF ABS(COALESCE(credit_balance, 0)) >= 0.005 THEN
        IF income_id IS NULL THEN
          RAISE EXCEPTION
            'Properties company % (%) has % in Deferred Rent Revenue but no existing Rental Income account (RENT-INC).',
            company_row.id,
            company_row.name,
            credit_balance;
        END IF;

        transfer_amount := ABS(credit_balance);

        INSERT INTO vouchers (
          company_id,
          voucher_number,
          voucher_type,
          voucher_date,
          description,
          total_amount,
          currency,
          source_module
        )
        VALUES (
          company_row.id,
          FORMAT(
            'RENT-DEF-RECLASS-%s-%s',
            company_row.id,
            (EXTRACT(EPOCH FROM clock_timestamp()) * 1000000)::bigint
          ),
          'Journal',
          CURRENT_DATE,
          'One-time reclassification: Deferred Rent Revenue to Rental Income',
          transfer_amount,
          'USD',
          'ERP'
        )
        RETURNING id INTO created_voucher_id;

        INSERT INTO voucher_entries (
          voucher_id,
          ledger_account_id,
          debit_amount,
          credit_amount,
          narration,
          transaction_currency,
          transaction_debit_amount,
          transaction_credit_amount,
          base_debit_amount,
          base_credit_amount,
          historical_exchange_rate,
          rate_convention
        )
        VALUES
          (
            created_voucher_id,
            deferred_id,
            CASE WHEN credit_balance > 0 THEN transfer_amount ELSE 0 END,
            CASE WHEN credit_balance < 0 THEN transfer_amount ELSE 0 END,
            'One-time reclassification: Deferred Rent Revenue to Rental Income',
            'USD',
            CASE WHEN credit_balance > 0 THEN transfer_amount ELSE 0 END,
            CASE WHEN credit_balance < 0 THEN transfer_amount ELSE 0 END,
            CASE WHEN credit_balance > 0 THEN transfer_amount ELSE 0 END,
            CASE WHEN credit_balance < 0 THEN transfer_amount ELSE 0 END,
            1,
            'IDENTITY'
          ),
          (
            created_voucher_id,
            income_id,
            CASE WHEN credit_balance < 0 THEN transfer_amount ELSE 0 END,
            CASE WHEN credit_balance > 0 THEN transfer_amount ELSE 0 END,
            'One-time reclassification: Deferred Rent Revenue to Rental Income',
            'USD',
            CASE WHEN credit_balance < 0 THEN transfer_amount ELSE 0 END,
            CASE WHEN credit_balance > 0 THEN transfer_amount ELSE 0 END,
            CASE WHEN credit_balance < 0 THEN transfer_amount ELSE 0 END,
            CASE WHEN credit_balance > 0 THEN transfer_amount ELSE 0 END,
            1,
            'IDENTITY'
          );
      END IF;

      UPDATE ledger_accounts
      SET active = false,
          is_hidden = true
      WHERE id = deferred_id;
    END IF;

    UPDATE property_monthly_ledger pml
    SET used_prepaid_account = false
    WHERE pml.used_prepaid_account = true
      AND pml.contract_id IN (
        SELECT pc.id
        FROM property_contracts pc
        JOIN property_units pu ON pu.id = pc.unit_id
        WHERE pc.company_id = company_row.id
          AND pc.module = 'PROPERTIES'
          AND pu.unit_type <> 'SHOP'
      );
  END LOOP;
END
$reclass$;
`;

function isPostgresDeadlock(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === POSTGRES_DEADLOCK_SQLSTATE
  );
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runReclassificationWithDeadlockRetry(): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query(RECLASSIFY_DEFERRED_RENT_SQL);
      return;
    } catch (error: unknown) {
      const retryDelayMs = DEADLOCK_RETRY_DELAYS_MS[attempt];
      if (!isPostgresDeadlock(error) || retryDelayMs === undefined) {
        throw error;
      }

      logger.warn("[RentalIncome] Deadlock during deferred-rent reclassification; retrying", {
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        retryDelayMs,
      });
      await wait(retryDelayMs);
    }
  }
}

/**
 * Reclassifies the remaining Properties-mode Deferred Rent Revenue balance into
 * the existing Rental Income account. The SQL block is atomic and idempotent:
 * it locks each Properties company, journals only the current remaining balance,
 * hides the obsolete deferred account, and clears legacy landlord prepaid flags.
 * PostgreSQL deadlocks are retried as a whole statement, so a failed transaction
 * is fully rolled back before the next attempt and cannot create a partial journal.
 *
 * Startup work is explicitly marked and may enter maintenance scope to repair all
 * Properties companies. Request-triggered retries never elevate an unscoped HTTP
 * request: they run only when tenant isolation has already established a verified
 * tenant scope, and each successfully repaired tenant becomes a process no-op.
 */
export function reclassifyLegacyDeferredRentForProperties(
  origin: DeferredRentReclassificationOrigin = "startup"
): Promise<void> {
  const scope = getDatabaseScopeRuntimeContext();
  if (completed) return Promise.resolve();

  if (origin === "request") {
    if (scope?.kind !== "tenant") return Promise.resolve();
    if (completedTenantCompanies.has(scope.companyId)) return Promise.resolve();
  }

  if (!inFlight) {
    const tenantCompanyId = origin === "request" && scope?.kind === "tenant" ? scope.companyId : null;
    const reclassificationPromise =
      origin === "startup"
        ? runWithDatabaseMaintenanceScope(
            "properties-deferred-rent-reclassification",
            runReclassificationWithDeadlockRetry
          )
        : runReclassificationWithDeadlockRetry();

    inFlight = reclassificationPromise
      .then(() => {
        if (origin === "startup") {
          completed = true;
        } else if (tenantCompanyId !== null) {
          completedTenantCompanies.add(tenantCompanyId);
        }
        logger.info("[RentalIncome] Properties deferred-rent reclassification completed", {
          origin,
          tenantCompanyId,
        });
      })
      .catch((error: unknown) => {
        logger.error("[RentalIncome] Properties deferred-rent reclassification failed", {
          error: getErrorMessage(error),
          origin,
          tenantCompanyId,
        });
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}
