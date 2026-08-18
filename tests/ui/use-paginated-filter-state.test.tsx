import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { persistFilters, readPersistedFilters, usePaginatedFilterState } from "@/hooks/use-paginated-filter-state";

type TestFilters = {
  search: string;
  selectedIds: number[];
  includeArchived: boolean;
  period: {
    fromDate: string;
    toDate: string;
  };
};

const createFilters = (): TestFilters => ({
  search: "",
  selectedIds: [],
  includeArchived: false,
  period: { fromDate: "2026-08-01", toDate: "2026-08-18" },
});

describe("usePaginatedFilterState", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns to the first page whenever a filter changes", () => {
    const { result } = renderHook(() =>
      usePaginatedFilterState<TestFilters>({
        createInitialFilters: createFilters,
        storageKey: "filters:test",
      })
    );

    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);

    act(() => result.current.setFilter("search", "PAY-101"));
    expect(result.current.filters.search).toBe("PAY-101");
    expect(result.current.page).toBe(1);

    act(() => result.current.setPage(3));
    act(() => result.current.updateFilters({ selectedIds: [4, 5], includeArchived: true }));
    expect(result.current.filters.selectedIds).toEqual([4, 5]);
    expect(result.current.page).toBe(1);
  });

  it("persists filters for a remount and resets them intentionally", async () => {
    const first = renderHook(() =>
      usePaginatedFilterState<TestFilters>({
        createInitialFilters: createFilters,
        storageKey: "filters:persisted",
      })
    );

    act(() => first.result.current.setFilter("search", "supplier"));
    await waitFor(() => expect(sessionStorage.getItem("filters:persisted")).toContain("supplier"));
    first.unmount();

    const second = renderHook(() =>
      usePaginatedFilterState<TestFilters>({
        createInitialFilters: createFilters,
        storageKey: "filters:persisted",
      })
    );
    expect(second.result.current.filters.search).toBe("supplier");
    expect(second.result.current.hasActiveFilters).toBe(true);

    act(() => second.result.current.resetFilters());
    expect(second.result.current.filters).toEqual(createFilters());
    expect(second.result.current.hasActiveFilters).toBe(false);
  });

  it("isolates stored filters by scope key", async () => {
    const { result, rerender } = renderHook(
      ({ storageKey }) =>
        usePaginatedFilterState<TestFilters>({
          createInitialFilters: createFilters,
          storageKey,
        }),
      { initialProps: { storageKey: "filters:company-4" } }
    );

    act(() => result.current.setFilter("selectedIds", [4]));
    await waitFor(() => expect(sessionStorage.getItem("filters:company-4")).toContain("[4]"));

    rerender({ storageKey: "filters:company-5" });
    await waitFor(() => expect(result.current.filters.selectedIds).toEqual([]));
    act(() => result.current.setFilter("selectedIds", [5]));

    rerender({ storageKey: "filters:company-4" });
    await waitFor(() => expect(result.current.filters.selectedIds).toEqual([4]));
  });

  it("rejects corrupt or shape-incompatible stored values", () => {
    sessionStorage.setItem("filters:broken-json", "{");
    expect(readPersistedFilters("filters:broken-json", createFilters())).toEqual(createFilters());

    persistFilters("filters:wrong-shape", {
      search: 42,
      selectedIds: "4,5",
      includeArchived: "yes",
      period: { fromDate: false, toDate: "2026-08-31" },
    });
    expect(readPersistedFilters("filters:wrong-shape", createFilters())).toEqual({
      ...createFilters(),
      period: { fromDate: "2026-08-01", toDate: "2026-08-31" },
    });
  });
});
