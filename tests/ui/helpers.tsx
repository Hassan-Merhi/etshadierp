import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Create a fresh QueryClient per test — no retries so tests fail fast. */
function makeTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(ui: React.ReactElement): RenderResult {
  const client = makeTestClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

/** Stub fetch so any useQuery that actually fires returns an empty payload. */
export function stubFetch(): void {
  (global as any).fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve([]),
    text: () => Promise.resolve(""),
    headers: new Headers(),
  });
}
