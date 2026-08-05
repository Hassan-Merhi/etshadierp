import { QueryClient, QueryObserver } from "@tanstack/react-query";

/**
 * The WebSocket invalidation fires whenever anyone anywhere in the system
 * writes anything, debounced 800ms. React Query defaults cancelRefetch to true,
 * so a broadcast arriving while the previous broadcast's refetch is still in
 * flight aborts that request and starts another: the work is thrown away, the
 * request count climbs, and the abort propagates to whatever else was sharing
 * that request and surfaces as a load failure.
 */
describe("blanket invalidation", () => {
  interface Probe {
    client: QueryClient;
    signals: AbortSignal[];
    calls: () => number;
    stop: () => void;
  }

  /** A query that has loaded once and whose refetches never settle on their own. */
  async function queryWithRefetchInFlight(): Promise<Probe> {
    const client = new QueryClient();
    const signals: AbortSignal[] = [];
    let calls = 0;

    const observer = new QueryObserver(client, {
      queryKey: ["/api/vouchers"],
      queryFn: ({ signal }) => {
        calls += 1;
        signals.push(signal);
        if (calls === 1) return Promise.resolve("loaded");
        return new Promise<string>(() => {});
      },
      retry: false,
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => {});

    await new Promise((resolve) => setTimeout(resolve, 20));
    void client.invalidateQueries({ refetchType: "active" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    return {
      client,
      signals,
      calls: () => calls,
      stop: () => {
        unsubscribe();
        client.clear();
      },
    };
  }

  it("lets a refetch that is already in flight finish", async () => {
    const probe = await queryWithRefetchInFlight();
    expect(probe.calls()).toBe(2);

    void probe.client.invalidateQueries({ refetchType: "active" }, { cancelRefetch: false });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(probe.signals[1].aborted).toBe(false);
    expect(probe.calls()).toBe(2);
    probe.stop();
  });

  it("aborts and restarts that refetch when cancelRefetch is left at its default", async () => {
    // Pins the behaviour being avoided, so the reason for the option survives
    // the next time this invalidation is touched.
    const probe = await queryWithRefetchInFlight();

    void probe.client.invalidateQueries({ refetchType: "active" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(probe.signals[1].aborted).toBe(true);
    expect(probe.calls()).toBe(3);
    probe.stop();
  });
});
