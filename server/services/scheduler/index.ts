/**
 * schedulerService schema, split by domain.
 *
 * Every part is re-exported here, so `@shared/schema` continues to expose
 * exactly the names it did before the split - which is the only thing that
 * has to hold, since these are declarations rather than ordered registrations.
 */
import cron from "node-cron";
import { logger } from "../../lib/logger";
import { startScheduler as startCoreScheduler } from "./scheduled-jobs";
import { checkAndRunLocationStockReports } from "./location-stock-report";
import { createSchedulerTick } from "./schedulerTickGuard";

let locationStockCronStarted = false;

/**
 * Wrap the existing scheduler registration with the Phase-3 location-stock
 * schedule. It stays in the same scheduler service and honours the same global
 * ENABLE_SCHEDULERS gate in server/index.ts.
 */
export function startScheduler(): void {
  startCoreScheduler();
  if (locationStockCronStarted) return;
  locationStockCronStarted = true;

  // Sending a report is network work that can outlast the minute it started in,
  // so the tick refuses to start a second pass while the first is still going.
  // Successful no-op checks stay silent: this runs every minute and should not
  // flood production logs when no location is due.
  const locationStockTick = createSchedulerTick("locationStockWhatsApp", checkAndRunLocationStockReports, {
    quiet: true,
  });

  cron.schedule("* * * * *", () => {
    void locationStockTick();
  });

  logger.info("Location stock WhatsApp scheduler registered", {
    module: "scheduler",
    action: "start",
    jobs: ["locationStockWhatsApp(every minute; per-location timezone/time/day rules)"],
  });
}

export * from "./daily-export";
export * from "./whatsapp-send";
export * from "./stock-report";
export * from "./net-position";
export * from "./maintenance";
export * from "./location-stock-report";
