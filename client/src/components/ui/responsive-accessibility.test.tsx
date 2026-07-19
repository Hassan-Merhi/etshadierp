import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  HorizontalScrollRegion,
  LiveRegion,
  ResponsiveActions,
  SkipLink,
} from "./responsive-accessibility";

describe("responsive accessibility primitives", () => {
  it("links keyboard users to the main workspace", () => {
    render(<SkipLink />);
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
  });

  it("uses the requested live-region urgency", () => {
    const { rerender } = render(<LiveRegion>Saved</LiveRegion>);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");

    rerender(<LiveRegion politeness="assertive">Failed</LiveRegion>);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("labels grouped responsive actions", () => {
    render(
      <ResponsiveActions label="Invoice actions">
        <button type="button">Save</button>
      </ResponsiveActions>,
    );
    expect(screen.getByRole("group", { name: "Invoice actions" })).toBeInTheDocument();
  });

  it("makes horizontally scrollable data keyboard discoverable", () => {
    render(
      <HorizontalScrollRegion label="Accounts table">
        <table><tbody><tr><td>Cash</td></tr></tbody></table>
      </HorizontalScrollRegion>,
    );
    const region = screen.getByRole("region", { name: "Accounts table" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("aria-describedby");
  });
});
