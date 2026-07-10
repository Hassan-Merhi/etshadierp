import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeriodFilter, getDefaultPeriodValue, type PeriodFilterValue } from "@/components/ui/period-filter";

vi.mock("@/contexts/DateFormatContext", () => ({
  useDateFormat: () => ({
    formatDisplayDate: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));

function renderFilter(
  value: PeriodFilterValue = {
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    preset: "this_month",
  },
  onChange = vi.fn(),
  hideCustomInputs = false,
) {
  render(
    <PeriodFilter
      value={value}
      onChange={onChange}
      hideCustomInputs={hideCustomInputs}
    />,
  );
  return onChange;
}

describe("PeriodFilter interactions", () => {
  it("opens the custom-range dialog from the dropdown", async () => {
    const user = userEvent.setup();
    renderFilter();

    await user.click(screen.getByTestId("period-filter-dropdown"));
    await user.click(await screen.findByTestId("period-preset-custom"));

    expect(await screen.findByTestId("period-custom-range-dialog")).toBeInTheDocument();
    expect(screen.getByText("Select date range")).toBeInTheDocument();
  });

  it("closes the custom-range dialog with the Close button", async () => {
    const user = userEvent.setup();
    renderFilter();

    await user.click(screen.getByTestId("period-filter-dropdown"));
    await user.click(await screen.findByTestId("period-preset-custom"));
    expect(await screen.findByTestId("period-custom-range-dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByTestId("period-custom-range-dialog")).not.toBeInTheDocument();
  });

  it("emits a complete value when a preset is selected", async () => {
    const user = userEvent.setup();
    const onChange = renderFilter();

    await user.click(screen.getByTestId("period-filter-dropdown"));
    await user.click(await screen.findByTestId("period-preset-yesterday"));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "yesterday",
        fromDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        toDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("does not expose custom-range controls when they are disabled", async () => {
    const user = userEvent.setup();
    renderFilter(undefined, vi.fn(), true);

    await user.click(screen.getByTestId("period-filter-dropdown"));

    expect(screen.queryByTestId("period-preset-custom")).not.toBeInTheDocument();
    expect(screen.queryByTestId("period-custom-range-dialog")).not.toBeInTheDocument();
  });

  it("creates valid default values for common presets", () => {
    expect(getDefaultPeriodValue("all_time")).toEqual({
      fromDate: "",
      toDate: "",
      preset: "all_time",
    });

    expect(getDefaultPeriodValue("today")).toEqual(
      expect.objectContaining({
        preset: "today",
        fromDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        toDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });
});
