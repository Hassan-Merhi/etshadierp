---
name: Repair-token signing key must be lazy + production-gated
description: Confirmation-token HMAC keys for admin repair flows must be resolved per-call, not cached at module load, and must hard-fail in production without a real secret.
---

`server/services/factory/repairToken.ts` originally computed its HMAC signing key once at module load (`const SIGNING_KEY = process.env.SESSION_SECRET || "dev-fallback-..."`). Two problems: tests that inject `SESSION_SECRET` after the module is already loaded never take effect, and production silently falls back to a shared, guessable dev key if the env var is ever unset at that moment.

**Why:** a repair-token endpoint gates real financial writes (raw-material FX repair, raw-stock recalc) behind a signed token; if every deployment can sign that token with the same public fallback string, the signature provides no security at all in production.

**How to apply:** resolve the signing key fresh inside a function called on every sign/verify, never as a top-level `const`. In production (`NODE_ENV === "production"`), throw a dedicated `RepairTokenConfigurationError` (not a generic error) if `SESSION_SECRET` is unset or still equals the known dev-fallback literal — outside production, the dev fallback is fine for local/test convenience. Every route that calls `signRepairToken`/`verifyRepairToken` must catch this error class specifically and return a configuration-error response without performing any write, rather than letting it fall through to a generic 500 that might imply the request itself was bad.
