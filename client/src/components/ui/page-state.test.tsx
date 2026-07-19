import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState, ErrorState, LoadingState, SuccessState } from "./page-state";

describe("shared page states", () => {
  it("announces loading without aggressive alerts", () => {
    render(<LoadingState title="Loading accounts" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading accounts")).toBeInTheDocument();
  });

  it("announces failures as alerts", () => {
    render(<ErrorState title="Accounts unavailable" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Accounts unavailable");
  });

  it("renders empty and success states through the same contract", () => {
    const onAction = vi.fn();
    const { rerender } = render(<EmptyState title="No accounts" actionLabel="Refresh" onAction={onAction} />);

    screen.getByRole("button", { name: "Refresh" }).click();
    expect(onAction).toHaveBeenCalledOnce();

    rerender(<SuccessState title="Saved" description="The changes were saved." />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("uses non-submit action buttons inside forms", () => {
    render(
      <form>
        <EmptyState title="No results" actionLabel="Try again" onAction={() => undefined} />
      </form>,
    );

    expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute("type", "button");
  });
});
