import cron from "node-cron";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";
import { createSchedulerTick } from "./schedulerTickGuard";

// Guards startScheduler against a double start.
let schedulerStarted = false;

async function checkAndRunScheduledDailyExport(): Promise<void> {
  try {
    const { hasTodayExportSucceeded, isTodayExportRunning } = await import("./daily-export-state");
    const r = await pool.query(
      `SELECT schedule_enabled, schedule_hour, schedule_timezone FROM export_settings WHERE id = 1`
    );
    if (!r.rows.length) return;
    const row = r.rows[0];

    if (!row.schedule_enabled) return;

    const configuredHour: number = row.schedule_hour ?? 18;
    const tz: string = row.schedule_timezone || "America/New_York";

    const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const currentHour = nowInTz.getHours();

    if (currentHour !== configuredHour) return;

    if (await hasTodayExportSucceeded()) {
      logger.info("[DailyExport] Hourly check: today's export already succeeded — skipping.");
      return;
    }
    if (await isTodayExportRunning()) {
      logger.info("[DailyExport] Hourly check: export is currently running — skipping.");
      return;
    }

    logger.info(`[DailyExport] Hourly check: time matches (${configuredHour}:00 ${tz}) — starting export.`);
    const { runDailyExport } = await import("./daily-export");
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ok = await runDailyExport();
      if (ok) {
        if (attempt > 1) logger.info(`[DailyExport] Succeeded on retry attempt ${attempt}.`);
        break;
      }
      if (attempt < MAX_ATTEMPTS) {
        logger.info(`[DailyExport] Attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in 15 minutes...`);
        await new Promise<void>((res) => setTimeout(res, 15 * 60 * 1000));
      } else {
        logger.error(`[DailyExport] All ${MAX_ATTEMPTS} attempts failed.`);
      }
    }
  } catch (err: unknown) {
    logger.error("[DailyExport] checkAndRunScheduledDailyExport error:", { error: getErrorMessage(err) || err });
  }
}

/**
 * Auto-post monthly rent accrual vouchers for every active rental contract
 * across all modules (ERP, FACTORY, PROPERTIES) and all companies.
 * Safe to run multiple times — already-accrued rows are skipped.
 */
async function runMonthlyRentalAccrual() {
  logger.info("[RentalAccrual] Monthly auto-accrual started.");
  try {
    const { ensureMonthlyForCompany, postRentAccrualForCompany } = await import("../../routes/rental/shared");
    const { rows } = await pool.query<{ id: number }>("SELECT id FROM companies");
    const modules: Array<{ module: string; income: string; expense: string }> = [
      { module: "ERP", income: "Rental Income - ERP", expense: "Rent Expense - ERP Shops" },
      { module: "FACTORY", income: "Rental Income - Factory", expense: "Rent Expense - Factory Shops" },
      { module: "PROPERTIES", income: "Rental Income - Properties", expense: "Rent Expense - Property Shops" },
    ];

    let totalAccrued = 0;
    for (const { id: companyId } of rows) {
      for (const { module, income, expense } of modules) {
        try {
          await ensureMonthlyForCompany(companyId, module as unknown as Parameters<typeof ensureMonthlyForCompany>[1]);
          const { accrued } = await postRentAccrualForCompany(companyId, expense, module, income);
          totalAccrued += accrued;
        } catch (err: unknown) {
          logger.error(`[RentalAccrual] company=${companyId} module=${module}: ${getErrorMessage(err)}`);
        }
      }
    }
    logger.info(`[RentalAccrual] Monthly auto-accrual complete — ${totalAccrued} rows accrued.`);
  } catch (err: unknown) {
    logger.error("[RentalAccrual] Fatal error:", { error: getErrorMessage(err) });
  }
}

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Run on the 1st of every month at 7:00 AM EST — send net-position Excel via WhatsApp
  cron.schedule(
    "0 7 1 * *",
    createSchedulerTick("monthlyNetPosition", async () => {
      const { runMonthlyWhatsAppNetPosition } = await import("./net-position");
      await runMonthlyWhatsAppNetPosition();
    }),
    {
      timezone: "America/New_York",
    }
  );

  // Run on the 2nd of every month at 6:00 AM EST — auto-post rent accrual vouchers
  cron.schedule("0 6 2 * *", createSchedulerTick("monthlyRentalAccrual", runMonthlyRentalAccrual), {
    timezone: "America/New_York",
  });

  // Every hour: check stock report, net position export, AND the configurable daily export.
  // Individual modules are loaded only when this tick executes instead of at process startup.
  cron.schedule(
    "0 * * * *",
    createSchedulerTick("hourlyChecks", async () => {
      const stockReport = await import("./stock-report");
      await stockReport.checkAndRunStockReport();
      await stockReport.checkAndRunNetPositionExport();
      await checkAndRunScheduledDailyExport();
      const { checkAndRunContainersWhatsApp } = await import("./maintenance");
      await checkAndRunContainersWhatsApp();
    }),
    {
      timezone: "America/New_York",
    }
  );

  // Wave I: every day at 3:30 AM ET, reconcile accounting/inventory evidence
  // for every company. The runner is read-only and reports mismatches; it never
  // mutates or auto-repairs accounting or inventory data. Each company is read
  // from one repeatable-read snapshot so live posting cannot create false drift.
  cron.schedule(
    "30 3 * * *",
    createSchedulerTick("convergenceReconciliation", async () => {
      const { runScheduledConvergenceReconciliation } =
        await import("../accounting/scheduledConvergenceReconciliation");
      await runScheduledConvergenceReconciliation();
    }),
    {
      timezone: "America/New_York",
    }
  );

  // Overdue customer payment reminder — runs every day at 9:00 AM EST
  cron.schedule(
    "0 9 * * *",
    createSchedulerTick("overdueCheck", async () => {
      const { checkOverdueCustomers } = await import("./net-position");
      await checkOverdueCustomers();
    }),
    {
      timezone: "America/New_York",
    }
  );

  // Purge soft-deleted items older than 30 days — runs daily at 2:00 AM EST
  cron.schedule(
    "0 2 * * *",
    createSchedulerTick("softDeletePurge", async () => {
      const { purgeOldSoftDeletes } = await import("./maintenance");
      await purgeOldSoftDeletes();
    }),
    {
      timezone: "America/New_York",
    }
  );

  // Container auto-tracking — runs every 6 hours (00:00, 06:00, 12:00, 18:00 EST)
  cron.schedule(
    "0 */6 * * *",
    createSchedulerTick("containerTracking", async () => {
      // ERP and factory tracking are reported separately on purpose: one
      // failing is not a reason to skip the other.
      try {
        const { trackDueContainers } = await import("../container-tracking");
        await trackDueContainers();
      } catch (err: unknown) {
        logger.error("cron containerTracking (ERP) failed", {
          module: "scheduler",
          action: "containerTracking",
          error: err,
        });
      }
      const { trackDueFactoryContainers } = await import("../factory-container-tracking");
      await trackDueFactoryContainers();
    }),
    {
      timezone: "America/New_York",
    }
  );

  logger.info("All scheduled jobs registered", {
    module: "scheduler",
    action: "start",
    jobs: [
      "monthlyNetPositionWhatsApp(1st 07:00 EST)",
      "monthlyRentalAccrual(2nd 06:00 EST)",
      "hourlyChecks(stock/export/containers)",
      "convergenceReconciliation(daily 03:30 ET)",
      "overdueCustomers(daily 09:00 EST)",
      "softDeletePurge(daily 02:00 EST)",
      "containerTracking(every 6h EST)",
    ],
  });
}

/**
 * Permanently delete all soft-deleted records older than 30 days.
 * Handles FK dependencies in the correct order.
 */
