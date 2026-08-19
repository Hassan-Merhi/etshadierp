import { render, screen } from "@testing-library/react";

import { WorkspaceConsistencyBoundary, WorkspaceRouteBoundary } from "@/components/ui/workspace-route-boundary";

function PendingRoute(): never {
  throw new Promise(() => undefined);
}

describe("workspace route consistency boundary", () => {
  it("marks every wrapped module with the shared UX contract", () => {
    render(
      <WorkspaceConsistencyBoundary>
        <button type="button">Save</button>
      </WorkspaceConsistencyBoundary>
    );

    expect(
      screen.getByRole("button", { name: "Save" }).closest('[data-ux-consistency-boundary="true"]')
    ).not.toBeNull();
  });

  it("uses the standard accessible loading state while a route is pending", () => {
    render(
      <WorkspaceRouteBoundary
        resetKey="/example"
        loadingTitle="Loading example"
        loadingDescription="Preparing example data."
      >
        <PendingRoute />
      </WorkspaceRouteBoundary>
    );

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading example")).toBeInTheDocument();
    expect(screen.getByText("Preparing example data.")).toBeInTheDocument();
  });
});
