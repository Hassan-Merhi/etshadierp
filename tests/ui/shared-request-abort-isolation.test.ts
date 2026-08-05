/**
 * A deduplicated GET is shared between callers. When one caller cancels — a
 * React Query key change, a company switch, an unmount — the request must stay
 * alive for the callers that are still waiting on it. Before this was true, the
 * cancelling caller's signal aborted the underlying fetch and every other
 * caller received "The operation was aborted." for a request it never
 * cancelled, which is what left Containers OTW stuck on its error screen.
 */
describe("shared in-flight request abort isolation", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    delete (window as any).__requestStormGuardInstalled;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (window as any).__requestStormGuardInstalled;
    vi.restoreAllMocks();
  });

  async function installGuard(underlying: typeof fetch): Promise<typeof fetch> {
    globalThis.fetch = underlying;
    window.fetch = underlying;
    await import("@/lib/requestStormGuard");
    return window.fetch;
  }

  it("keeps serving the remaining caller after another caller aborts", async () => {
    let observedSignal: AbortSignal | undefined;
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });

    const guardedFetch = await installGuard(((_input: any, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return pending;
    }) as unknown as typeof fetch);

    const firstController = new AbortController();
    const first = guardedFetch("/api/git/containers?page=1", { signal: firstController.signal });
    const second = guardedFetch("/api/git/containers?page=1", {});

    // The first caller walks away; the shared request must not be aborted.
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal?.aborted).toBe(false);

    release(new Response(JSON.stringify({ containers: [] }), { headers: { "Content-Type": "application/json" } }));
    const response = await second;
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ containers: [] });
  });

  it("leaves the response body readable after the only caller is served", async () => {
    // Regression: releasing the shared request on success dropped the waiter
    // count to zero and aborted the controller, which tore down the body stream
    // before the caller could read it. Every deduplicated GET — /api/auth/me
    // included — then failed to parse, which logged the user straight back out.
    let observedSignal: AbortSignal | undefined;
    const guardedFetch = await installGuard(((_input: any, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return Promise.resolve(
        new Response(JSON.stringify({ id: "user-1" }), { headers: { "Content-Type": "application/json" } })
      );
    }) as unknown as typeof fetch);

    const controller = new AbortController();
    const response = await guardedFetch("/api/auth/me", { signal: controller.signal });

    expect(observedSignal?.aborted).toBe(false);
    await expect(response.json()).resolves.toEqual({ id: "user-1" });
  });

  it("does not join a request that has already been abandoned", async () => {
    // The abandoned request's rejection is still in flight when the next caller
    // arrives — inFlightGets has not been cleaned up yet. Joining it hands the
    // newcomer an abort it never asked for ("signal is aborted without reason").
    const seen: AbortSignal[] = [];
    let releaseSecond!: (value: Response) => void;
    const responses = [
      new Promise<Response>(() => {}),
      new Promise<Response>((resolve) => {
        releaseSecond = resolve;
      }),
    ];
    const guardedFetch = await installGuard(((_input: any, init?: RequestInit) => {
      if (init?.signal) seen.push(init.signal);
      return responses.shift() ?? Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch);

    const controller = new AbortController();
    const abandoned = guardedFetch("/api/vouchers?page=1", { signal: controller.signal });
    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });

    // Same key, brand new caller, arriving before the rejection is cleaned up.
    const next = guardedFetch("/api/vouchers?page=1", {});
    releaseSecond(
      new Response(JSON.stringify({ data: [{ id: 1 }] }), {
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect((await next).json()).resolves.toEqual({ data: [{ id: 1 }] });
  });

  it("retries when the shared request aborts for a reason the caller never asked for", async () => {
    // "signal is aborted without reason" is what a guard-internal abort reads
    // like. The caller never cancelled, so it gets a fresh request instead of
    // somebody else's abort.
    let attempt = 0;
    const guardedFetch = await installGuard((() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(new DOMException("signal is aborted without reason", "AbortError"));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), { headers: { "Content-Type": "application/json" } })
      );
    }) as unknown as typeof fetch);

    const response = await guardedFetch("/api/vouchers?page=3", { signal: new AbortController().signal });

    expect(attempt).toBe(2);
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  it("revalidates an expired reference response with If-None-Match and reuses its body on 304", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const headersSeen: Headers[] = [];
    let calls = 0;
    const guardedFetch = await installGuard(((_input: any, init?: RequestInit) => {
      calls += 1;
      headersSeen.push(new Headers(init?.headers));
      if (calls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 1, name: "Lubumbashi" }]), {
            headers: { "Content-Type": "application/json", ETag: 'W/"locations-v1"' },
          })
        );
      }
      return Promise.resolve(new Response(null, { status: 304, headers: { ETag: 'W/"locations-v1"' } }));
    }) as unknown as typeof fetch);

    const first = await guardedFetch("/api/locations", {});
    await expect(first.json()).resolves.toEqual([{ id: 1, name: "Lubumbashi" }]);

    now += 31 * 60_000;
    const second = await guardedFetch("/api/locations", {});
    expect(headersSeen[1].get("if-none-match")).toBe('W/"locations-v1"');
    await expect(second.json()).resolves.toEqual([{ id: 1, name: "Lubumbashi" }]);
    expect(calls).toBe(2);
  });

  it("replaces an expired cached representation when the validator changed", async () => {
    let now = 5_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let calls = 0;
    const guardedFetch = await installGuard(((_input: any, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 1, name: "Old" }]), {
            headers: { "Content-Type": "application/json", ETag: 'W/"locations-v1"' },
          })
        );
      }
      expect(new Headers(init?.headers).get("if-none-match")).toBe('W/"locations-v1"');
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, name: "New" }]), {
          headers: { "Content-Type": "application/json", ETag: 'W/"locations-v2"' },
        })
      );
    }) as unknown as typeof fetch);

    await (await guardedFetch("/api/locations", {})).json();
    now += 31 * 60_000;
    await expect((await guardedFetch("/api/locations", {})).json()).resolves.toEqual([{ id: 1, name: "New" }]);
  });

  it("aborts the underlying request once every caller has let go", async () => {
    let observedSignal: AbortSignal | undefined;
    const guardedFetch = await installGuard(((_input: any, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch);

    const controller = new AbortController();
    const only = guardedFetch("/api/git/containers?page=2", { signal: controller.signal });
    controller.abort();

    await expect(only).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal?.aborted).toBe(true);
  });
});
