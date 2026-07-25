/**
 * Unit tests for client/src/lib/factoryOfflineQueueSafety.ts — guards against
 * replaying a stale offline bale-loading scan (a POST to
 * /api/factory/customer-orders/:id/bales). Replaying one later can allocate the
 * wrong physical bale or hit a finalized order, so these must be detected and
 * purged from the legacy offline queue.
 */
import {
  isUnsafeFactoryLoadingScanRequest,
  purgeUnsafeFactoryLoadingScans,
} from "@/lib/factoryOfflineQueueSafety";

const QUEUE_KEY = "erp_offline_queue";

describe("isUnsafeFactoryLoadingScanRequest", () => {
  it("flags a POST to the bale-loading-scan endpoint", () => {
    expect(isUnsafeFactoryLoadingScanRequest("POST", "/api/factory/customer-orders/123/bales")).toBe(true);
  });

  it("is case-insensitive on the method", () => {
    expect(isUnsafeFactoryLoadingScanRequest("post", "/api/factory/customer-orders/1/bales")).toBe(true);
  });

  it("does not flag non-POST methods", () => {
    expect(isUnsafeFactoryLoadingScanRequest("GET", "/api/factory/customer-orders/1/bales")).toBe(false);
    expect(isUnsafeFactoryLoadingScanRequest("DELETE", "/api/factory/customer-orders/1/bales")).toBe(false);
  });

  it("anchors the pattern — sub-paths and other endpoints do not match", () => {
    expect(isUnsafeFactoryLoadingScanRequest("POST", "/api/factory/customer-orders/1/bales/9")).toBe(false);
    expect(isUnsafeFactoryLoadingScanRequest("POST", "/api/factory/customer-orders/abc/bales")).toBe(false);
    expect(isUnsafeFactoryLoadingScanRequest("POST", "/api/factory/bales")).toBe(false);
  });
});

describe("purgeUnsafeFactoryLoadingScans", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns 0 when there is no queue", () => {
    expect(purgeUnsafeFactoryLoadingScans()).toBe(0);
  });

  it("returns 0 for malformed (non-array / non-JSON) queue data", () => {
    window.localStorage.setItem(QUEUE_KEY, "not json");
    expect(purgeUnsafeFactoryLoadingScans()).toBe(0);
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify({ not: "an array" }));
    expect(purgeUnsafeFactoryLoadingScans()).toBe(0);
  });

  it("removes only the unsafe loading scans and keeps safe items", () => {
    const queue = [
      { method: "POST", url: "/api/factory/customer-orders/5/bales" }, // unsafe
      { method: "POST", url: "/api/vouchers" }, // safe
      { method: "GET", url: "/api/factory/customer-orders/5/bales" }, // safe (GET)
      { method: "POST", url: "/api/factory/customer-orders/9/bales" }, // unsafe
    ];
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

    const removed = purgeUnsafeFactoryLoadingScans();

    expect(removed).toBe(2);
    const remaining = JSON.parse(window.localStorage.getItem(QUEUE_KEY) as string);
    expect(remaining).toHaveLength(2);
    expect(remaining.every((i: { url: string }) => i.url !== "/api/factory/customer-orders/5/bales" || i.method === "GET")).toBe(true);
  });

  it("dispatches a prune event when something was removed", () => {
    const spy = vi.fn();
    window.addEventListener("erp:offline-queue-pruned", spy);
    window.localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([{ method: "POST", url: "/api/factory/customer-orders/1/bales" }]),
    );

    const removed = purgeUnsafeFactoryLoadingScans();

    expect(removed).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener("erp:offline-queue-pruned", spy);
  });

  it("leaves an all-safe queue untouched and fires no event", () => {
    const spy = vi.fn();
    window.addEventListener("erp:offline-queue-pruned", spy);
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify([{ method: "POST", url: "/api/vouchers" }]));

    expect(purgeUnsafeFactoryLoadingScans()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener("erp:offline-queue-pruned", spy);
  });
});
