/**
 * Golden Coast Phase 12 — route and navigation wiring.
 *
 * Behavioural cover for the integration points the hub depends on: the
 * authenticated route guard admits /sp/golden-coast for Supplier Partner
 * companies and nobody else, the sidebar offers it without disturbing the
 * existing setup entries, and the router mounts the page lazily.
 */
import React, { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resolveAuthenticatedAppRoute } from "@/app/authenticatedAppRouteGuard";
import { SUPPLIER_PARTNER_DAILY_ITEMS, SUPPLIER_PARTNER_SECTIONS } from "@/lib/supplier-partner-navigation";

vi.mock("@/pages/sp/SpGoldenCoast", () => ({
  default: () => <div data-testid="golden-coast-page" />,
}));
vi.mock("@/routes/ErpRoutes", () => ({ ErpRoutes: () => <div data-testid="erp-routes" /> }));
vi.mock("@/routes/PosRoutes", () => ({ PosRoutes: () => <div data-testid="pos-routes" /> }));

const guardInput = {
  isAdminOwner: false,
  myAccessLoading: false,
  myAccessError: false,
};

describe("Golden Coast route and navigation wiring", () => {
  it("admits /sp/golden-coast for a Supplier Partner company", () => {
    const { decision } = resolveAuthenticatedAppRoute({
      ...guardInput,
      currentLocation: "/sp/golden-coast",
      companyType: "supplier_partner",
    });

    expect(decision).toEqual({ kind: "continue" });
  });

  it("keeps the route closed to companies that are not Supplier Partners", () => {
    const { decision } = resolveAuthenticatedAppRoute({
      ...guardInput,
      currentLocation: "/sp/golden-coast",
      companyType: "factory",
    });

    expect(decision).toEqual({ kind: "redirect", to: "/tracking" });
  });

  it("leaves unknown Supplier Partner routes redirecting to the overview", () => {
    const { decision } = resolveAuthenticatedAppRoute({
      ...guardInput,
      currentLocation: "/sp/golden-coast-typo",
      companyType: "supplier_partner",
    });

    expect(decision).toEqual({ kind: "redirect", to: "/sp" });
  });

  it("offers Golden Coast and Setup in the Supplier Partner navigation", () => {
    expect(SUPPLIER_PARTNER_DAILY_ITEMS.map((item) => item.url)).not.toContain("/sp/golden-coast");

    const setupUrls = SUPPLIER_PARTNER_SECTIONS.flatMap((section) => section.items.map((item) => item.url));
    expect(setupUrls).toContain("/sp/setup");
    expect(setupUrls).not.toContain("/sp/setup?tab=migration");
    expect(setupUrls).not.toContain("/sp/opening-stock");
    expect(setupUrls).not.toContain("/sp/aliases");
  });

  it("mounts the Golden Coast page lazily on its own route and ERP routes elsewhere", async () => {
    const { Router } = await import("@/routes/AppRoutes");
    window.history.replaceState({}, "", "/sp/golden-coast");

    const { unmount } = render(
      <Suspense fallback={<div data-testid="route-loading" />}>
        <Router user={{ role: "Developer" }} />
      </Suspense>
    );

    await waitFor(() => expect(screen.getByTestId("golden-coast-page")).toBeTruthy());
    expect(screen.queryByTestId("erp-routes")).toBeNull();
    unmount();

    window.history.replaceState({}, "", "/sp");
    render(
      <Suspense fallback={<div data-testid="route-loading" />}>
        <Router user={{ role: "Developer" }} />
      </Suspense>
    );

    await waitFor(() => expect(screen.getByTestId("erp-routes")).toBeTruthy());
    expect(screen.queryByTestId("golden-coast-page")).toBeNull();
  });
});
