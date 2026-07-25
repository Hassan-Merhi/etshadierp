/**
 * Unit tests for server/lib/permissionHelpers.ts — the server-side authorization
 * logic. The per-role-tier semantics are security-critical, so each tier's
 * default (and how an explicit DB row flips it) is pinned down:
 *
 *   Developer / Admin              → always allowed (cannot be restricted)
 *   Normal User                    → DENY by default; enabled=true grants access
 *   Owner / Manager / POS / etc.   → ALLOW by default; enabled=false restricts
 */
import {
  buildPermissionMap,
  canAccessModule,
  canAccessPage,
  canAccessTab,
  canPerformAction,
  canSeeSensitiveField,
  canUseExportPrint,
  canAccess,
  type PermissionRow,
} from "../server/lib/permissionHelpers";

const rows: PermissionRow[] = [
  { role: "Normal User", featureKey: "page_dashboard", enabled: true },
  { role: "Normal User", featureKey: "page_secret", enabled: false },
  { role: "Manager", featureKey: "act_delete_voucher", enabled: false },
  { role: "Manager", featureKey: "page_dashboard", enabled: true },
  { role: "Owner", featureKey: "fld_cost_price", enabled: false },
];

describe("buildPermissionMap", () => {
  it("keeps only the rows for the requested role", () => {
    const map = buildPermissionMap(rows, "Normal User");
    expect(map.get("page_dashboard")).toBe(true);
    expect(map.get("page_secret")).toBe(false);
    expect(map.has("act_delete_voucher")).toBe(false); // Manager's row excluded
  });

  it("returns an empty map for a role with no rows", () => {
    expect(buildPermissionMap(rows, "Developer").size).toBe(0);
  });
});

describe("Developer / Admin — always allowed", () => {
  it("allows regardless of an explicit deny row", () => {
    // Even a map that says enabled=false must not restrict Developer/Admin.
    const denyMap = new Map([["page_x", false]]);
    expect(canAccessPage("Developer", "page_x", denyMap)).toBe(true);
    expect(canAccessPage("Admin", "page_x", denyMap)).toBe(true);
    expect(canPerformAction("Admin", "anything", new Map())).toBe(true);
  });
});

describe("Normal User — deny by default", () => {
  const map = buildPermissionMap(rows, "Normal User");

  it("denies when there is no record", () => {
    expect(canAccessPage("Normal User", "page_unlisted", map)).toBe(false);
  });

  it("allows only with an explicit enabled=true record", () => {
    expect(canAccessPage("Normal User", "page_dashboard", map)).toBe(true);
  });

  it("denies with an explicit enabled=false record", () => {
    expect(canAccessPage("Normal User", "page_secret", map)).toBe(false);
  });
});

describe("Owner / Manager — allow by default", () => {
  const managerMap = buildPermissionMap(rows, "Manager");
  const ownerMap = buildPermissionMap(rows, "Owner");

  it("allows when there is no record", () => {
    expect(canAccessPage("Manager", "page_anything", managerMap)).toBe(true);
    expect(canAccessModule("Owner", "mod_factory", ownerMap)).toBe(true);
  });

  it("blocks only on an explicit enabled=false record", () => {
    expect(canPerformAction("Manager", "act_delete_voucher", managerMap)).toBe(false);
    expect(canSeeSensitiveField("Owner", "fld_cost_price", ownerMap)).toBe(false);
  });

  it("still allows other keys for the same role", () => {
    expect(canAccessPage("Manager", "page_dashboard", managerMap)).toBe(true);
  });
});

describe("all typed wrappers share the same isAllowed semantics", () => {
  it("agree for a given role/key/map", () => {
    const map = new Map([["k", false]]);
    const normalDenied = [
      canAccessModule("Normal User", "k", map),
      canAccessTab("Normal User", "k", map),
      canUseExportPrint("Normal User", "k", map),
      canAccess("Normal User", "k", map),
    ];
    expect(normalDenied.every((v) => v === false)).toBe(true);

    // Manager: allow-by-default, but this key is explicitly false → all deny.
    const managerAll = [
      canAccessTab("Manager", "k", map),
      canUseExportPrint("Manager", "k", map),
      canAccess("Manager", "k", map),
    ];
    expect(managerAll.every((v) => v === false)).toBe(true);
  });
});
