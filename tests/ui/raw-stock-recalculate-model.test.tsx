/**
 * Raw-stock recalculation: what the operator is shown, and what gets selected.
 *
 * This hook drives the screen that rewrites container costs and the mix-batch
 * costs derived from them. Everything the operator decides from — which rows
 * changed, which are hidden, whether "select all" means all of them — is
 * computed here, and none of it had a test.
 *
 * Two derivations matter more than the rest:
 *
 *   Closed and completed containers are hidden by default, because recomputing
 *   the cost of a container that has already been closed rewrites history. The
 *   count of what is hidden has to be right: an operator who is not told that
 *   fourteen rows are being withheld reads the list as the whole problem.
 *
 *   A row whose exchange rate could not be resolved is neither "changed" nor
 *   "unchanged" — its new cost is unknown. Folding it into either bucket
 *   invites applying a recalculation across rows whose value nobody computed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();

vi.mock("@/lib/factoryApi", () => ({ getApiRequest: () => apiRequest }));
vi.mock("@/contexts/AppModeContext", () => ({ useAppMode: () => "factory", useModePrefix: () => "/factory" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-admin-override", () => ({
  useAdminOverride: () => ({ wrapAdminAction: (run: () => void) => run(), AdminDialog: null }),
}));

import {
  getRawStockErrorMessage,
  useRawStockRecalculate,
} from "@/pages/factory/production-raw-stock/useRawStockRecalculate";

interface Row {
  containerId: number;
  containerStatus: string;
  changed: boolean;
  fxUnresolved?: boolean;
}

function row(containerId: number, overrides: Partial<Row> = {}): Row {
  return { containerId, containerStatus: "OPEN", changed: true, ...overrides };
}

function ok(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

function renderModel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useRawStockRecalculate(), { wrapper });
}

beforeEach(() => {
  apiRequest.mockReset();
});

describe("raw stock recalculation model", () => {
  it("separates changed, unchanged and unresolved-rate rows", async () => {
    apiRequest.mockResolvedValue(
      ok([
        row(1),
        row(2),
        row(3, { changed: false }),
        row(4, { changed: false, fxUnresolved: true }),
        row(5, { changed: false, fxUnresolved: true }),
      ])
    );

    const { result } = renderModel();
    await waitFor(() => expect(result.current.rows).toHaveLength(5));

    // Five rows: two changed, two with an unresolved rate, one genuinely
    // unchanged. Counting the unresolved rows as unchanged would report "1
    // change to review" over a set where three costs are actually in question.
    expect(result.current.visibleChangedRows).toHaveLength(2);
    expect(result.current.fxUnresolvedRows).toHaveLength(2);
    expect(result.current.unchangedCount).toBe(1);
  });

  it("hides closed and completed containers and says how many", async () => {
    apiRequest.mockResolvedValue(
      ok([row(1), row(2, { containerStatus: "CLOSED" }), row(3, { containerStatus: "COMPLETED" })])
    );

    const { result } = renderModel();
    await waitFor(() => expect(result.current.rows).toHaveLength(3));

    expect(result.current.visibleChangedRows.map((entry) => entry.containerId)).toEqual([1]);
    // The count is the whole point: a silently filtered list reads as the
    // complete problem, and an operator stops after fixing what they can see.
    expect(result.current.hiddenHistoricalCount).toBe(2);
  });

  it("shows the history it withheld once the operator asks for it", async () => {
    apiRequest.mockResolvedValue(ok([row(1), row(2, { containerStatus: "CLOSED" })]));

    const { result } = renderModel();
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.setIncludeHistoricalContainers(true));
    await waitFor(() => expect(result.current.visibleChangedRows).toHaveLength(2));
    expect(result.current.hiddenHistoricalCount).toBe(0);
  });

  it("selects only the rows the operator can actually see", async () => {
    apiRequest.mockResolvedValue(
      ok([row(1), row(2), row(3, { containerStatus: "CLOSED" }), row(4, { changed: false })])
    );

    const { result } = renderModel();
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    act(() => result.current.toggleAll());
    await waitFor(() => expect(result.current.allSelected).toBe(true));

    // "Select all" reaching a hidden closed container would apply a
    // recalculation to history the operator was never shown.
    expect(result.current.selectedIds).toEqual([1, 2]);
  });

  it("clears the selection when select-all is used again", async () => {
    apiRequest.mockResolvedValue(ok([row(1), row(2)]));

    const { result } = renderModel();
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.toggleAll());
    await waitFor(() => expect(result.current.selectedIds).toEqual([1, 2]));
    act(() => result.current.toggleAll());
    await waitFor(() => expect(result.current.selectedIds).toEqual([]));
  });

  it("toggles a single container both ways", async () => {
    apiRequest.mockResolvedValue(ok([row(1), row(2)]));

    const { result } = renderModel();
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.toggleOne(2));
    await waitFor(() => expect(result.current.selectedIds).toEqual([2]));
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggleOne(2));
    await waitFor(() => expect(result.current.selectedIds).toEqual([]));
  });

  it("reports nothing selected when there is nothing to select", async () => {
    apiRequest.mockResolvedValue(ok([row(1, { changed: false })]));

    const { result } = renderModel();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    // An empty list satisfies "every row is selected" vacuously, which would
    // light up a select-all checkbox over nothing and enable Apply.
    expect(result.current.allSelected).toBe(false);
  });

  it("surfaces the server's reason when the preview cannot be loaded", async () => {
    apiRequest.mockResolvedValue({
      ok: false,
      json: async () => ({ message: "Exchange rate missing for 2026-03" }),
    } as unknown as Response);

    const { result } = renderModel();
    await waitFor(() => expect(result.current.isPreviewError).toBe(true));

    expect(getRawStockErrorMessage(result.current.previewErrorMsg)).toBe("Exchange rate missing for 2026-03");
  });

  it("falls back to a stated message rather than an empty one", () => {
    expect(getRawStockErrorMessage(new Error(""), "Could not recalculate")).toBe("Could not recalculate");
    expect(getRawStockErrorMessage(undefined, "Could not recalculate")).toBe("Could not recalculate");
    expect(getRawStockErrorMessage({ message: "not an Error" })).toBe("An unexpected error occurred");
  });

  it("keeps the historical replay behind its typed confirmation", async () => {
    apiRequest.mockResolvedValue(ok([]));
    const { result } = renderModel();

    // The replay rewrites finalized history, so the dialog demands the phrase
    // be typed. Pinning the initial state means a future edit that pre-fills
    // the field — turning the gate into an extra click — fails here.
    expect(result.current.showReplayConfirmDialog).toBe(false);
    expect(result.current.replayConfirmText).toBe("");
    expect(result.current.includeFinalizedBales).toBe(false);
    expect(result.current.preparedReplayToken).toBeNull();
  });
});
