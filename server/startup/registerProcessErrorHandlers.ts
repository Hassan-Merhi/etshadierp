import { logger } from "../lib/logger";

export function registerProcessErrorHandlers() {
  const isProduction = process.env.NODE_ENV === "production";

  process.on("unhandledRejection", (reason: unknown) => {
    const detail =
      reason instanceof Error ? { reason: reason.message, stack: reason.stack ?? "" } : { reason, stack: "" };
    logger.error("[UnhandledRejection]", detail);
    if (isProduction) process.exit(1);
  });

  process.on("uncaughtException", (err: Error) => {
    logger.error("[UncaughtException]", { message: err.message, error: err.stack });
    if (isProduction) process.exit(1);
  });
}
