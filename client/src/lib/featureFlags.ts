/**
 * DEVELOPER FEATURE FLAGS
 * ─────────────────────────────────────────────────────────────────────────────
 * Controls system-wide features. Changes here apply to ALL users immediately.
 *
 * OFFLINE_MODE_ENABLED
 *   true  – Full offline/sync system is active (pings server every 30s,
 *            polls IndexedDB every 15s, shows OfflineBanner + PendingSyncIndicator).
 *   false – Offline system is completely disabled. No background polling,
 *            no IndexedDB access, no UI indicators. Best for performance.
 */
export const OFFLINE_MODE_ENABLED = false;
