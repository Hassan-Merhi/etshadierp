import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationLanguageProvider } from "@/contexts/ApplicationLanguageContext";

export type SeededQuery = readonly [queryKey: readonly unknown[], data: unknown];

export interface RenderWithProvidersOptions {
  seedQueries?: readonly SeededQuery[];
}

/** Create a fresh QueryClient per test — no retries so tests fail fast. */
function makeTestClient(seedQueries: readonly SeededQuery[] = []): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  // Shell render tests exercise pages that normally mount below the authenticated
  // application shell. Seed the same auth state here so those smoke tests do not
  // fail merely because /api/auth/me has not resolved yet.
  client.setQueryData(["/api/auth/me"], { id: "test-user", role: "Developer" });
  for (const [queryKey, data] of seedQueries) {
    client.setQueryData(queryKey, data);
  }
  return client;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
): RenderResult {
  const client = makeTestClient(options.seedQueries);
  return render(
    <QueryClientProvider client={client}>
      <ApplicationLanguageProvider>{ui}</ApplicationLanguageProvider>
    </QueryClientProvider>
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
