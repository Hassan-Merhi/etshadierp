import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HorizontalScrollRegion, LiveRegion, ResponsiveActions, SkipLink } from "./responsive-accessibility";

describe("responsive accessibility primitives", () => {
  it("links keyboard users to the main workspace", () => {
    render(<SkipLink />);
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
  });

  it("focuses the main workspace when activated", () => {
    render(
      <>
        <SkipLink />
        <main id="main-content" tabIndex={-1}>
          Workspace
        </main>
      </>
    );
    const main = screen.getByRole("main");
    main.scrollIntoView = vi.fn();

    fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));

    expect(document.activeElement).toBe(main);
    expect(window.location.hash).toBe("#main-content");
    expect(main.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("restores main-workspace focus after hash listeners update the route", () => {
    let refocus: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      refocus = callback;
      return 1;
    });

    render(
      <>
        <SkipLink />
        <main id="main-content" tabIndex={-1}>
          Workspace
        </main>
      </>
    );
    const main = screen.getByRole("main");
    main.scrollIntoView = vi.fn();

    fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
    main.blur();
    refocus?.(0);

    expect(document.activeElement).toBe(main);
    requestAnimationFrame.mockRestore();
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
      </ResponsiveActions>
    );
    expect(screen.getByRole("group", { name: "Invoice actions" })).toBeInTheDocument();
  });

  it("makes horizontally scrollable data keyboard discoverable", () => {
    render(
      <HorizontalScrollRegion label="Accounts table">
        <table>
          <tbody>
            <tr>
              <td>Cash</td>
            </tr>
          </tbody>
        </table>
      </HorizontalScrollRegion>
    );
    const region = screen.getByRole("region", { name: "Accounts table" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("aria-describedby");
  });
});
