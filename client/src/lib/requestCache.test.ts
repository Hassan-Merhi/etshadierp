/**
 * Network-level deduplication for the heavy endpoints.
 *
 * React Query dedupes by query key; this dedupes by URL underneath it, so two
 * components asking the same heavy endpoint for the same thing produce one
 * round trip rather than two. It also holds a ten-second guard after a completed
 * fetch, which is the part that has to be released on mutation — a guard that
 * never lifts means a user saves something and keeps seeing the old list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch, invalidateLargeEndpointCache } from "./requestCache";

const HEAVY = "/api/inventory/summary";
const LIGHT = "/api/companies";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let counter = 0;

/** Each test uses its own URL so the module-level cache cannot leak across them. */
function heavyUrl() {
  counter += 1;
  return `${HEAVY}?probe=${counter}`;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pass-through", () => {
  it("fetches a light endpoint every time it is asked", async () => {
    await guardedFetch(LIGHT);
    await guardedFetch(LIGHT);

    // Only the listed heavy endpoints are guarded; everything else must behave
    // exactly like fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws the server's message when a light request fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Not allowed" }, false, 403));

    await expect(guardedFetch(LIGHT)).rejects.toThrow("Not allowed");
  });
});

describe("heavy endpoints", () => {
  it("serves a repeat request from the guard instead of the network", async () => {
    const url = heavyUrl();
    const first = await guardedFetch(url);
    const second = await guardedFetch(url);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("joins a request that is already in flight", async () => {
    const url = heavyUrl();
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );

    const first = guardedFetch(url);
    const second = guardedFetch(url);
    release(jsonResponse({ shared: true }));

    expect(await first).toEqual({ shared: true });
    expect(await second).toEqual({ shared: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("goes back to the network once the guard and the cache have expired", async () => {
    const url = heavyUrl();
    await guardedFetch(url);

    vi.advanceTimersByTime(6 * 60 * 1000);
    await guardedFetch(url);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("releases the guard when a mutation invalidates the endpoint", async () => {
    const url = heavyUrl();
    await guardedFetch(url);

    invalidateLargeEndpointCache("/api/inventory");
    await guardedFetch(url);

    // Without this a user saves a change and keeps reading the previous list
    // for the next ten seconds with no way to force a refresh.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps serving from the TTL cache once the invalidation window closes", async () => {
    const url = heavyUrl();
    invalidateLargeEndpointCache("/api/inventory");
    await guardedFetch(url);

    vi.advanceTimersByTime(31_000);
    await guardedFetch(url);

    // The bypass marker is temporary; after it expires the ordinary cache is
    // back in charge, and its window is minutes rather than seconds. One
    // invalidation buys one fresh read, not a permanently unguarded endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed request as if it had succeeded", async () => {
    const url = heavyUrl();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Server error" }, false, 500));

    await expect(guardedFetch(url)).rejects.toThrow("Server error");
    await guardedFetch(url);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops holding an in-flight entry after a rejection", async () => {
    const url = heavyUrl();
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(guardedFetch(url)).rejects.toThrow("network down");
    // A retry must not join the promise that already failed.
    await expect(guardedFetch(url)).resolves.toEqual({ ok: true });
  });
});
