import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Properties canonical route contract", () => {
  it("keeps Properties settings pages inside the Properties namespace", () => {
    const routes = read("client/src/app/PropertiesRoutes.tsx");

    expect(routes).toContain('path="/properties/my-settings"');
    expect(routes).toContain('path="/properties/balance-repair"');
    expect(routes).not.toContain('path="/my-settings"');
    expect(routes).not.toContain('path="/balance-repair"');
  });

  it("normalizes historical global aliases with replacement history", () => {
    const guard = read("client/src/app/authenticatedAppRouteGuard.ts");

    expect(guard).toContain('currentLocation === "/my-settings"');
    expect(guard).toContain('decision = { kind: "redirect", to: "/properties/my-settings" }');
    expect(guard).toContain('currentLocation === "/balance-repair"');
    expect(guard).toContain('decision = { kind: "redirect", to: "/properties/balance-repair" }');
  });

  it("uses replacement navigation for unknown Properties routes", () => {
    const routes = read("client/src/app/PropertiesRoutes.tsx");
    expect(routes).toContain('<Redirect replace to="/properties/daybook" />');
  });

  it("uses the canonical My Settings sidebar destination", () => {
    const sidebar = read("client/src/components/PropertiesSidebar.tsx");
    expect(sidebar).toContain('href="/properties/my-settings"');
    expect(sidebar).not.toContain('href="/my-settings"');
  });
});
