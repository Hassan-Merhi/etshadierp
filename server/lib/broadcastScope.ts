/**
 * Who a broadcast is for.
 *
 * Kept free of imports so the policy can be reasoned about — and tested —
 * without starting a WebSocket server or touching the database.
 */

/**
 * Whether a socket belonging to `socketCompanyId` should receive a message
 * scoped to `messageCompanyId`.
 *
 * Unscoped messages reach everyone: chat crosses companies and server-wide
 * notices must not be filtered. Tenant-scoped messages fail closed: a socket
 * whose company has not resolved yet does not receive another tenant's signal.
 * Once its authenticated session resolves, later invalidations are delivered to
 * the exact matching company as normal.
 */
export function shouldDeliverBroadcast(
  socketCompanyId: number | null | undefined,
  messageCompanyId: number | null | undefined,
): boolean {
  if (messageCompanyId === undefined || messageCompanyId === null) return true;
  if (socketCompanyId === undefined || socketCompanyId === null) return false;
  return socketCompanyId === messageCompanyId;
}
