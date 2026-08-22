import { logger } from "../lib/logger";

export function registerProcessErrorHandlers() {
  const isProduction = process.env.NODE_ENV === "production";

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("[UnhandledRejection]", { error: reason });
    if (isProduction) process.exit(1);
  });

  process.on("uncaughtException", (err: Error) => {
    logger.error("[UncaughtException]", { message: err.message, error: err.stack });
    if (isProduction) process.exit(1);
  });
}
