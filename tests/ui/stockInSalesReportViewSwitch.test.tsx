/**
 * StockInSalesReport — mount coverage for the three views it serves.
 *
 * All three live at the same path and differ only by `?view=`. The dispatch used
 * to sit at the top of the summary component, ahead of its ~20 hooks, so
 * changing `?view=` on a mounted component changed how many hooks ran between
 * renders. It is now its own hook-free component.
 *
 * What that defect actually did, measured rather than assumed: nothing visible.
 * React picks the mount dispatcher when the previous render had zero hooks
 * (`current.memoizedState === null`), and the "rendered fewer hooks" check only
 * fires once at least one hook has been consumed — so both directions of the
 * switch silently remounted the summary's hook state instead of throwing. The
 * cost was the filter state quietly resetting, not a crash.
 *
 * It was one edit away from being a crash, though. Adding a single hook above
 * the dispatch — an ordinary thing to do — puts the component on the update
 * dispatcher with a truncated hook list, and the switch throws "Rendered fewer
 * hooks than expected." That was confirmed against the pre-fix file.
 *
 * So these tests are NOT a regression test for the hook-order bug: they pass
 * against the broken version too, because the broken version did not throw.
 * `react-hooks/rules-of-hooks` is what guards that, and it is an error now.
 * What these add is mount coverage for a page that had none, and a check that
 * each `?view=` value reaches the right screen.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { stubFetch } from "./helpers";

beforeAll(() => stubFetch());

afterEach(() => window.history.replaceState({}, "", "/"));

/**
 * The two sibling views are stubbed. What is under test is the dispatch, not
 * what those screens render — mounting them for real would drag their own data
 * requirements in and make a failure here ambiguous.
 */
vi.mock("@/pages/StockInSalesReportDetail", () => ({
  default: () => <div data-testid="stub-detail-view" />,
}));

vi.mock("@/pages/StockInSalesReportComparison", () => ({
  default: () => <div data-testid="stub-comparison-view" />,
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { id: 1, name: "Test Co", code: "TC", active: true, companyType: "erp" as const },
    companies: [],
    isLoading: false,
    selectCompany: vi.fn(),
  }),
  CompanyProvider: ({ children }: any) => <>{children}</>,
}));

const money = (v: any) => `$${Number(v ?? 0).toFixed(2)}`;
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    selectedCurrency: "USD",
    formatAmount: money,
    formatAmountRaw: money,
    convertToDisplay: (v: number) => v,
    convertToUSD: (v: number) => v,
  }),
}));

vi.mock("@/contexts/DateFormatContext", () => ({
  useDateFormat: () => ({
    formatDisplayDate: (d: any) => String(d),
    formatShortDate: (d: any) => String(d),
  }),
}));

function renderReport(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

function setView(view: string | null): void {
  window.history.replaceState({}, "", view ? `/?view=${view}` : "/");
}

describe("StockInSalesReport view dispatch", () => {
  it("renders the summary when no view is requested", async () => {
    setView(null);
    const { default: StockInSalesReport } = await import("@/pages/StockInSalesReport");
    renderReport(<StockInSalesReport />);

    expect(await screen.findByTestId("period-filter-stock-in-sales-report")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-detail-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stub-comparison-view")).not.toBeInTheDocument();
  });

  it("changes the report grouping with the selected period", async () => {
    const user = userEvent.setup();
    setView(null);
    const { default: StockInSalesReport } = await import("@/pages/StockInSalesReport");
    renderReport(<StockInSalesReport />);

    expect(
      await screen.findByText("Monthly stock movement and profitability · Click a month for full details")
    ).toBeInTheDocument();
    expect(screen.getByText("Month", { selector: "th" })).toBeInTheDocument();

    await user.click(screen.getByTestId("period-filter-stock-in-sales-report"));
    await user.click(await screen.findByTestId("period-preset-all-time"));

    expect(
      await screen.findByText("Yearly stock movement and profitability · Click a year for full details")
    ).toBeInTheDocument();
    expect(screen.getByText("Year", { selector: "th" })).toBeInTheDocument();

    await user.click(screen.getByTestId("period-filter-stock-in-sales-report"));
    await user.click(await screen.findByTestId("period-preset-today"));

    expect(
      await screen.findByText("Daily stock movement and profitability · Click a day for that day's full details")
    ).toBeInTheDocument();
    expect(screen.getByText("Day", { selector: "th" })).toBeInTheDocument();
  });

  it("renders the detail view for ?view=detail", async () => {
    setView("detail");
    const { default: StockInSalesReport } = await import("@/pages/StockInSalesReport");
    renderReport(<StockInSalesReport />);

    expect(await screen.findByTestId("stub-detail-view")).toBeInTheDocument();
    expect(screen.queryByTestId("period-filter-stock-in-sales-report")).not.toBeInTheDocument();
  });

  it("renders the comparison view for ?view=comparison", async () => {
    setView("comparison");
    const { default: StockInSalesReport } = await import("@/pages/StockInSalesReport");
    renderReport(<StockInSalesReport />);

    expect(await screen.findByTestId("stub-comparison-view")).toBeInTheDocument();
    expect(screen.queryByTestId("period-filter-stock-in-sales-report")).not.toBeInTheDocument();
  });

  it("switches views in place without unmounting the element", async () => {
    setView(null);
    const { default: StockInSalesReport } = await import("@/pages/StockInSalesReport");
    const { client, rerender } = renderReport(<StockInSalesReport />);
    expect(await screen.findByTestId("period-filter-stock-in-sales-report")).toBeInTheDocument();

    // Same element, same provider, changed query string — the sequence the app
    // performs when the user follows a ?view= link from this screen.
    setView("detail");
    rerender(
      <QueryClientProvider client={client}>
        <StockInSalesReport />
      </QueryClientProvider>
    );
    expect(await screen.findByTestId("stub-detail-view")).toBeInTheDocument();

    setView(null);
    rerender(
      <QueryClientProvider client={client}>
        <StockInSalesReport />
      </QueryClientProvider>
    );
    expect(await screen.findByTestId("period-filter-stock-in-sales-report")).toBeInTheDocument();
  });
});
