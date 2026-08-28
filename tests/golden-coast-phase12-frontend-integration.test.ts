import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("Golden Coast Phase 12 frontend integration", () => {
  it("registers a lazy Golden Coast operations entry point without changing setup routing", () => {
    const routes = read("client/src/routes/AppRoutes.tsx");
    const navigation = read("client/src/lib/supplier-partner-navigation.ts");
    const routeGuard = read("client/src/app/authenticatedAppRouteGuard.ts");

    expect(routes).toContain('const SpGoldenCoast = lazy(() => import("@/pages/sp/SpGoldenCoast"))');
    expect(routes).toContain('location === "/sp/golden-coast"');
    expect(navigation).toContain('releaseDebtEnglish("Golden Coast")');
    expect(navigation).toContain('url: "/sp/golden-coast"');
    expect(navigation).toContain('{ title: "Setup", url: "/sp/setup"');
    expect(navigation).toContain('{ title: "Migration", url: "/sp/setup?tab=migration"');
    expect(routeGuard).toContain('"/sp/golden-coast"');
  });

  it("keeps Phase 6 sales on the existing POS workflow", () => {
    const page = read("client/src/pages/sp/SpGoldenCoast.tsx");

    expect(page).toContain('href: "/pos"');
    expect(page).toContain('phase: "Phase 6"');
    expect(page).not.toContain("/api/sp/golden-coast/phase6");
  });

  it("wires the Phase 7 HADI UI to the approved cross-company endpoints and target-company gate", () => {
    const page = read("client/src/pages/sp/SpGoldenCoast.tsx");

    expect(page).toContain('"/api/sp/golden-coast/phase7/sales-cash-transfer/readiness"');
    expect(page).toContain('"/api/sp/golden-coast/phase7/sales-cash-transfer"');
    expect(page).toContain("targetCompanyId=");
    expect(page).toContain('"collect_via_hadi"');
    expect(page).toContain('"remit_from_hadi"');
    expect(page).toContain("hadiCashAccount: phase7HadiChoice");
    expect(page).toContain("goldenCoastCashAccount: phase7GcChoice");
  });

  it("requires the Phase 9 owner-withdrawal confirmation and live savings cap", () => {
    const page = read("client/src/pages/sp/SpGoldenCoast.tsx");

    expect(page).toContain('"/api/sp/golden-coast/phase9/hassan-savings-withdrawal/readiness"');
    expect(page).toContain('"/api/sp/golden-coast/phase9/hassan-savings-withdrawal"');
    expect(page).toContain('const HASSAN_SAVINGS_CONFIRMATION = "WITHDRAW HASSAN SAVINGS"');
    expect(page).toContain("allowedAmount(phase9Amount, phase9.availableSavingsUsd)");
    expect(page).toContain("confirmation: phase9Confirmation.trim()");
    expect(page).toContain("reason: phase9Reason.trim()");
  });

  it("uses the Phase 10 readiness balance and approved receipt accounts", () => {
    const page = read("client/src/pages/sp/SpGoldenCoast.tsx");

    expect(page).toContain('"/api/sp/golden-coast/phase10/sales-cash-settlement/readiness"');
    expect(page).toContain('"/api/sp/golden-coast/phase10/sales-cash-settlement"');
    expect(page).toContain("allowedAmount(phase10Amount, phase10.collectibleSalesCashUsd)");
    expect(page).toContain("receiptAccount: phase10Choice");
  });

  it("uses only server-derived Phase 11 monthly-close totals and preserves sensitive-action guards", () => {
    const page = read("client/src/pages/sp/SpGoldenCoast.tsx");

    expect(page).toContain('"/api/sp/golden-coast/phase11/profit-splits/monthly-close/readiness"');
    expect(page).toContain('"/api/sp/golden-coast/phase11/profit-splits/monthly-close"');
    expect(page).toContain('const MONTHLY_CLOSE_CONFIRMATION = "FINALIZE SP PROFIT SPLIT"');
    expect(page).toContain("idempotencyKey: phase11RequestId");
    expect(page).toContain("reason: phase11Reason.trim()");
    expect(page).toContain("confirmation: phase11Confirmation.trim()");
    expect(page).not.toContain("splitPct: custom");
    expect(page).not.toContain("totalRevenue:");
    expect(page).not.toContain("totalCogs:");
    expect(page).not.toContain("totalSharedCharges:");
  });

  it("does not add Phase 8, setup, provisioning, or accounting-rule mutation endpoints", () => {
    const page = read("client/src/pages/sp/SpGoldenCoast.tsx");

    expect(page).not.toContain("/phase8/");
    expect(page).not.toContain("/api/sp/setup");
    expect(page).not.toContain("account-provision");
    expect(page).not.toContain("opening-balance");
  });
});
