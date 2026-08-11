import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageHeader } from "./PageHeader";

vi.mock("@/contexts/CursorNavContext", () => ({
  useCursorNav: () => ({ config: null }),
}));

vi.mock("@/hooks/use-back-to-parent", () => ({
  useBackToParent: () => vi.fn(),
}));

vi.mock("@/lib/parent-routes", () => ({
  getParentRoute: () => "/sales-report",
}));

vi.mock("@/lib/erp-navigation-history", () => ({
  canGoBackToPreviousErpLocation: () => false,
}));

vi.mock("@/contexts/AppModeContext", () => ({
  useAppMode: () => "erp",
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/stock-in-sales-report"],
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("PageHeader page-level Back deduplication", () => {
  it("renders the shared Back control when the page has no manual Back owner", async () => {
    render(
      <main className="container">
        <PageHeader title="Stock In & Sales Report" />
      </main>
    );

    const back = await screen.findByTestId("button-back");
    expect(back.getAttribute("data-page-back-owner")).toBe("shared");
  });

  it("suppresses the shared Back control when a legacy page renders its own Back button", async () => {
    render(
      <main className="container">
        <button type="button" data-testid="button-back-stock-in-sales">
          Back
        </button>
        <PageHeader title="Stock In & Sales Report" />
      </main>
    );

    await waitFor(() => expect(screen.queryByTestId("button-back")).toBeNull());
    expect(screen.getByTestId("button-back-stock-in-sales")).toBeTruthy();
  });

  it("also recognizes descriptive legacy controls such as Back to report", async () => {
    render(
      <main className="container">
        <button type="button">Back to report</button>
        <PageHeader title="Stock In & Sales Details" />
      </main>
    );

    await waitFor(() => expect(screen.queryByTestId("button-back")).toBeNull());
    expect(screen.getByRole("button", { name: "Back to report" })).toBeTruthy();
  });

  it("does not let a Back control outside the current page container suppress the shared owner", async () => {
    render(
      <>
        <aside>
          <button type="button">Back</button>
        </aside>
        <main className="container">
          <PageHeader title="Stock In & Sales Report" />
        </main>
      </>
    );

    const back = await screen.findByTestId("button-back");
    expect(back.getAttribute("data-page-back-owner")).toBe("shared");
  });
});
