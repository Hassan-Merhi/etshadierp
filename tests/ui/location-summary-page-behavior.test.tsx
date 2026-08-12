import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
}));

const summary = {
  stockGroups: [
    {
      id: 1,
      code: "G1",
      name: "Clothing",
      locationData: {
        11: { quantity: 10, rate: 5, value: 50 },
        12: { quantity: 4, rate: 6, value: 24 },
      },
      items: [
        {
          id: 7,
          code: "SH-1",
          name: "Shirts",
          uom: "Bale",
          locationData: {
            11: { quantity: 6, rate: 5, value: 30 },
            12: { quantity: 2, rate: 6, value: 12 },
          },
        },
        {
          id: 8,
          code: "PT-1",
          name: "Pants",
          uom: "Bale",
          locationData: {
            11: { quantity: 4, rate: 5, value: 20 },
            12: { quantity: 2, rate: 6, value: 12 },
          },
        },
      ],
    },
  ],
  grandTotals: {
    11: { quantity: 10, rate: 5, value: 50 },
    12: { quantity: 4, rate: 6, value: 24 },
  },
  asOfDate: "2026-08-12",
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: any) => {
    if (queryKey?.[0] === "/api/locations") {
      return {
        data: [
          { id: 11, name: "Main", code: "MAIN" },
          { id: 12, name: "Warehouse", code: "WH" },
        ],
      };
    }
    return { data: [] };
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/location-summary", harness.navigate] }));
vi.mock("@/hooks/use-escape-back", () => ({ hasAnyOpenDialog: () => false }));
vi.mock("@/hooks/use-location-summary-bandwidth", () => ({
  useLocationSummaryBandwidth: () => ({ data: summary, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({ formatAmount: (value: unknown) => `$${Number(value).toFixed(2)}` }),
}));
vi.mock("@/hooks/use-date-jump", () => ({ useDateJump: vi.fn() }));
vi.mock("@/components/PageHeader", () => ({
  PageHeader: ({ title, subtitle }: any) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  ),
}));
vi.mock("@/components/ui/period-filter", () => ({
  getDefaultPeriodValue: () => ({ fromDate: "2026-08-12", toDate: "2026-08-12", preset: "today" }),
  PeriodFilter: ({ value }: any) => <div data-testid="period-filter">{value.fromDate}</div>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogTrigger: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

import LocationSummary from "@/pages/LocationSummary";

describe("location summary page behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("locationSummary_selectedLocations", JSON.stringify([11, 12]));
    sessionStorage.setItem(
      "locationSummary_pageState",
      JSON.stringify({ expandedGroups: [1], selectedLocationIndex: 0, highlightedRows: [], hiddenRows: [] })
    );
  });

  it("renders selected locations, group totals, and expanded stock items", () => {
    render(<LocationSummary />);

    expect(screen.getByRole("heading", { name: "Location Summary" })).toBeInTheDocument();
    expect(screen.getByText("Main")).toBeInTheDocument();
    expect(screen.getByText("Warehouse")).toBeInTheDocument();
    expect(screen.getByText("Clothing")).toBeInTheDocument();
    expect(screen.getByText("Shirts")).toBeInTheDocument();
    expect(screen.getByText("Pants")).toBeInTheDocument();
    expect(screen.getByTestId("location-summary-container")).toBeInTheDocument();
  });

  it("persists navigation/highlight state and hides the keyboard-selected row with Alt+R", () => {
    render(<LocationSummary />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "r", altKey: true });

    expect(harness.toast).toHaveBeenCalledWith({ title: "Row hidden (Alt+R)" });
    const saved = JSON.parse(sessionStorage.getItem("locationSummary_pageState") || "{}");
    expect(saved.hiddenRows).toContain("group-1");
  });

  it("navigates an expanded item to the selected location stock history", () => {
    render(<LocationSummary />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(harness.navigate).toHaveBeenCalledWith("/locations/11/stock-items/8/history");
  });
});
