import { logger } from "../../lib/logger";

/**
 * Master-password impersonation is an emergency-only capability.
 *
 * Merely setting MASTER_PASSWORD is not enough. Operators must explicitly opt in
 * and provide an ISO timestamp after which the capability automatically disables
 * itself. This policy is evaluated before authRoutes reads MASTER_PASSWORD.
 */
const configuredMasterPassword = process.env.MASTER_PASSWORD;

if (configuredMasterPassword) {
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
