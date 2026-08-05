import { shouldDeliverBroadcast } from "../server/lib/broadcastScope";

/**
 * Every write broadcast used to reach every connected client, so a sale in one
 * company made clients in every other company refetch everything on screen.
 */
describe("WebSocket broadcast company scope", () => {
  it("delivers a company's writes to that company", () => {
    expect(shouldDeliverBroadcast(7, 7)).toBe(true);
  });

  it("does not deliver a company's writes to another company", () => {
    expect(shouldDeliverBroadcast(7, 9)).toBe(false);
  });

  it("delivers unscoped messages to everyone", () => {
    // Chat crosses companies, and server-wide notices must not be filtered.
    expect(shouldDeliverBroadcast(7, null)).toBe(true);
    expect(shouldDeliverBroadcast(7, undefined)).toBe(true);
  });

  it("delivers to a socket whose company is not resolved yet", () => {
    // Missing an invalidation leaves stale numbers on screen; one extra refetch
    // does not. The unknown case stays on the safe side.
    expect(shouldDeliverBroadcast(null, 7)).toBe(true);
    expect(shouldDeliverBroadcast(undefined, 7)).toBe(true);
  });
});
