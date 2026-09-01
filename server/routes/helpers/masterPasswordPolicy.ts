import { logger } from "../../lib/logger";

/**
 * Master-password impersonation is an emergency-only development capability.
 *
 * Production never accepts a shared master password. If legacy Render/env
 * configuration is still present, remove it from the process before auth routes
 * snapshot MASTER_PASSWORD so the capability is fail-closed without requiring a
 * production outage just to clean up stale environment variables.
 *
 * Outside production, merely setting MASTER_PASSWORD is still not enough:
 * operators must explicitly opt in and provide a future ISO expiry timestamp.
 */
const configuredMasterPassword = process.env.MASTER_PASSWORD;
const hasAnyMasterPasswordConfiguration = Boolean(
  configuredMasterPassword || process.env.MASTER_PASSWORD_ENABLED || process.env.MASTER_PASSWORD_EXPIRES_AT
);

if (process.env.NODE_ENV === "production") {
  delete process.env.MASTER_PASSWORD;
  delete process.env.MASTER_PASSWORD_ENABLED;
  delete process.env.MASTER_PASSWORD_EXPIRES_AT;

  if (hasAnyMasterPasswordConfiguration) {
    logger.info("[Auth] Ignored legacy master-password configuration; impersonation is disabled in production.");
  }
} else if (configuredMasterPassword) {
  const explicitlyEnabled = process.env.MASTER_PASSWORD_ENABLED === "true";
  const expiresAtRaw = process.env.MASTER_PASSWORD_EXPIRES_AT;
  const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : Number.NaN;
  const hasValidFutureExpiry = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();

  if (!explicitlyEnabled || !hasValidFutureExpiry) {
    delete process.env.MASTER_PASSWORD;
    logger.warn(
      "[Auth] MASTER_PASSWORD ignored. Emergency impersonation requires MASTER_PASSWORD_ENABLED=true and a future MASTER_PASSWORD_EXPIRES_AT ISO timestamp."
    );
  } else {
    logger.warn("[Auth] Emergency master-password impersonation is enabled temporarily.", {
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  }
}
