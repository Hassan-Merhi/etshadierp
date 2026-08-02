import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationLanguageProvider } from "@/contexts/ApplicationLanguageContext";

/** Create a fresh QueryClient per test — no retries so tests fail fast. */
function makeTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/**
 * Pages converted to module translation call useApplicationLanguage, so the
 * harness mounts the same language provider the real app does.
 */
export function renderWithProviders(ui: React.ReactElement): RenderResult {
  const client = makeTestClient();
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
