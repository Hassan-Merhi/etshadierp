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
 * notices must not be filtered. A socket whose company is not resolved yet is
 * never excluded either — missing an invalidation leaves stale numbers on
 * someone's screen, which is worse than one extra refetch.
 */
export function shouldDeliverBroadcast(
  socketCompanyId: number | null | undefined,
  messageCompanyId: number | null | undefined,
): boolean {
  if (messageCompanyId === undefined || messageCompanyId === null) return true;
  if (socketCompanyId === undefined || socketCompanyId === null) return true;
  return socketCompanyId === messageCompanyId;
}
