import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { navigateMock, searchState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  searchState: { value: "" },
}));

vi.mock("wouter", () => ({
  useSearch: () => searchState.value,
  useLocation: () => ["/", navigateMock],
}));

vi.mock("@/pages/StockItems", () => ({ default: () => <div>Stock items content</div> }));
vi.mock("@/pages/StockQuery", () => ({ default: () => <div>Stock query content</div> }));
vi.mock("@/pages/OffloadItemSearch", () => ({ default: () => <div>Offload content</div> }));
vi.mock("@/components/GradesCategoriesManager", () => ({
  GradesCategoriesManager: () => <div>Grades content</div>,
}));
vi.mock("@/pages/LocationInventory", () => ({ default: () => <div>Location inventory content</div> }));
vi.mock("@/pages/StockOTW", () => ({ default: () => <div>On the way content</div> }));
vi.mock("@/pages/ContainersPage", () => ({ default: () => <div>Containers content</div> }));

import StockHub from "@/pages/StockHub";
import InventoryHub from "@/pages/InventoryHub";

describe("hub tab navigation", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    searchState.value = "";
  });

  it("routes StockHub tab clicks through the stock query parameter", async () => {
    const user = userEvent.setup();
    render(<StockHub />);

    expect(screen.getByText("Stock items content")).toBeInTheDocument();
    await user.click(screen.getByTestId("tab-stock-query"));

    expect(navigateMock).toHaveBeenCalledWith("/stock?tab=query", { replace: true });
  });

  it("renders the StockHub tab selected by the URL", () => {
    searchState.value = "?tab=grades";
    render(<StockHub />);

    expect(screen.getByText("Grades content")).toBeInTheDocument();
    expect(screen.queryByText("Stock items content")).not.toBeInTheDocument();
  });

  it("routes InventoryHub tab clicks through the inventory query parameter", async () => {
    const user = userEvent.setup();
    render(<InventoryHub />);

    expect(screen.getByText("Location inventory content")).toBeInTheDocument();
    await user.click(screen.getByTestId("tab-containers"));

    expect(navigateMock).toHaveBeenCalledWith("/inventory?tab=containers", { replace: true });
  });

  it("renders the InventoryHub tab selected by the URL", () => {
    searchState.value = "?tab=on-the-way";
    render(<InventoryHub />);

    expect(screen.getByText("On the way content")).toBeInTheDocument();
    expect(screen.queryByText("Location inventory content")).not.toBeInTheDocument();
  });
});
