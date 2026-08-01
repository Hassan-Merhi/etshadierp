import cron from "node-cron";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";
import { ensureMonthlyForCompany, postRentAccrualForCompany } from "../../routes/rental/_rentalShared";
import { hasTodayExportSucceeded, isTodayExportRunning, runDailyExport } from "./daily-export";

// Guards startScheduler against a double start. Declared here rather than in
// daily-export because this is the only module that reads or writes it, and a
// `let` cannot be reassigned across a module boundary.
let schedulerStarted = false;
import { checkAndRunContainersWhatsApp, purgeOldSoftDeletes } from "./maintenance";
import { checkOverdueCustomers, runMonthlyWhatsAppNetPosition } from "./net-position";
import { checkAndRunNetPositionExport, checkAndRunStockReport } from "./stock-report";

async function checkAndRunScheduledDailyExport(): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT schedule_enabled, schedule_hour, schedule_timezone FROM export_settings WHERE id = 1`
    );
    if (!r.rows.length) return;
    const row = r.rows[0];

    if (!row.schedule_enabled) return;

    const configuredHour: number = row.schedule_hour ?? 18;
    const tz: string = row.schedule_timezone || "America/New_York";

    // Get the current hour in the configured timezone
    const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const currentHour = nowInTz.getHours();

    if (currentHour !== configuredHour) return;

    // Already succeeded today?
    if (await hasTodayExportSucceeded()) {
      logger.info("[DailyExport] Hourly check: today's export already succeeded — skipping.");
      return;
    }
    // Already running?
    if (await isTodayExportRunning()) {
      logger.info("[DailyExport] Hourly check: export is currently running — skipping.");
      return;
    }

    logger.info(`[DailyExport] Hourly check: time matches (${configuredHour}:00 ${tz}) — starting export.`);
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
          await ensureMonthlyForCompany(companyId, module as any);
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
    async () => {
      const _t = Date.now();
      logger.info("cron monthlyNetPosition started", { module: "scheduler", action: "monthlyNetPosition" });
      try {
        await runMonthlyWhatsAppNetPosition();
        logger.info("cron monthlyNetPosition succeeded", {
          module: "scheduler",
          action: "monthlyNetPosition",
          durationMs: Date.now() - _t,
        });
      } catch (err: unknown) {
        logger.error("cron monthlyNetPosition failed", {
          module: "scheduler",
          action: "monthlyNetPosition",
          durationMs: Date.now() - _t,
          error: err,
        });
      }
    },
    {
      timezone: "America/New_York",
    }
  );

  // Run on the 2nd of every month at 6:00 AM EST — auto-post rent accrual vouchers
  cron.schedule(
    "0 6 2 * *",
    async () => {
      const _t = Date.now();
      logger.info("cron monthlyRentalAccrual started", { module: "scheduler", action: "monthlyRentalAccrual" });
      try {
        await runMonthlyRentalAccrual();
        logger.info("cron monthlyRentalAccrual succeeded", {
          module: "scheduler",
          action: "monthlyRentalAccrual",
          durationMs: Date.now() - _t,
        });
      } catch (err: unknown) {
        logger.error("cron monthlyRentalAccrual failed", {
          module: "scheduler",
          action: "monthlyRentalAccrual",
          durationMs: Date.now() - _t,
          error: err,
        });
      }
    },
    {
      timezone: "America/New_York",
    }
  );

  // Every hour: check stock report, net position export, AND the configurable daily export.
  // The daily export fires when the current local hour (in the stored timezone) matches
  // the stored schedule_hour — this replaces the old hardcoded 6 PM EST cron.
  cron.schedule(
    "0 * * * *",
    async () => {
      const _t = Date.now();
      logger.info("cron hourlyChecks started", { module: "scheduler", action: "hourlyChecks" });
      try {
        await checkAndRunStockReport();
        await checkAndRunNetPositionExport();
        await checkAndRunScheduledDailyExport();
        await checkAndRunContainersWhatsApp();
        logger.info("cron hourlyChecks succeeded", {
          module: "scheduler",
          action: "hourlyChecks",
          durationMs: Date.now() - _t,
        });
      } catch (err: unknown) {
        logger.error("cron hourlyChecks failed", {
          module: "scheduler",
          action: "hourlyChecks",
          durationMs: Date.now() - _t,
          error: err,
        });
      }
    },
    {
      timezone: "America/New_York",
    }
  );

  // Overdue customer payment reminder — runs every day at 9:00 AM EST
  cron.schedule(
    "0 9 * * *",
    async () => {
      const _t = Date.now();
      logger.info("cron overdueCheck started", { module: "scheduler", action: "overdueCheck" });
      try {
        await checkOverdueCustomers();
        logger.info("cron overdueCheck succeeded", {
          module: "scheduler",
          action: "overdueCheck",
          durationMs: Date.now() - _t,
        });
      } catch (err: unknown) {
        logger.error("cron overdueCheck failed", {
          module: "scheduler",
          action: "overdueCheck",
          durationMs: Date.now() - _t,
          error: err,
        });
      }
    },
    {
      timezone: "America/New_York",
    }
  );

  // Purge soft-deleted items older than 30 days — runs daily at 2:00 AM EST
  cron.schedule(
    "0 2 * * *",
    async () => {
      const _t = Date.now();
      logger.info("cron softDeletePurge started", { module: "scheduler", action: "softDeletePurge" });
      try {
        await purgeOldSoftDeletes();
        logger.info("cron softDeletePurge succeeded", {
          module: "scheduler",
          action: "softDeletePurge",
          durationMs: Date.now() - _t,
        });
      } catch (err: unknown) {
        logger.error("cron softDeletePurge failed", {
          module: "scheduler",
          action: "softDeletePurge",
          durationMs: Date.now() - _t,
          error: err,
        });
      }
    },
    {
      timezone: "America/New_York",
    }
  );

  // Container auto-tracking — runs every 6 hours (00:00, 06:00, 12:00, 18:00 EST)
  cron.schedule(
    "0 */6 * * *",
    async () => {
      const _t = Date.now();
      logger.info("cron containerTracking started", { module: "scheduler", action: "containerTracking" });
      try {
        const { trackDueContainers } = await import("../container-tracking");
        await trackDueContainers();
      } catch (err: unknown) {
        logger.error("cron containerTracking (ERP) failed", {
          module: "scheduler",
          action: "containerTracking",
          durationMs: Date.now() - _t,
          error: err,
        });
      }
      try {
        const { trackDueFactoryContainers } = await import("../factory-container-tracking");
        await trackDueFactoryContainers();
        logger.info("cron containerTracking succeeded", {
          module: "scheduler",
          action: "containerTracking",
          durationMs: Date.now() - _t,
        });
      } catch (err: unknown) {
        logger.error("cron containerTracking (factory) failed", {
          module: "scheduler",
          action: "containerTracking",
          durationMs: Date.now() - _t,
          error: err,
        });
      }
    },
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
