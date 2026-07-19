import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AlertPanel } from "./AlertPanel";

describe("AlertPanel", () => {
  it("announces non-destructive feedback politely", () => {
    render(<AlertPanel tone="success" title="Saved" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
  });

  it("announces destructive feedback assertively", () => {
    render(<AlertPanel tone="destructive" title="Could not save" />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("provides a named non-submit dismiss button", () => {
    const onDismiss = vi.fn();
    render(<AlertPanel title="Notice" onDismiss={onDismiss} />);
    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
    expect(dismiss).toHaveAttribute("type", "button");
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
