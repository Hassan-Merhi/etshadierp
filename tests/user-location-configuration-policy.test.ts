import { describe, expect, it } from "vitest";
import { classifyUserLocationConfigurationRoute } from "../server/services/security/userLocationConfigurationPolicy";

describe("user location configuration route policy", () => {
  it("classifies location and cash-account assignment routes", () => {
    expect(
      classifyUserLocationConfigurationRoute("/api/user-locations/user-1/4")
    ).toEqual({ kind: "locations", userId: "user-1", companyId: 4 });
    expect(
      classifyUserLocationConfigurationRoute(
        "/api/user-location-cash-accounts/user%202/7"
      )
    ).toEqual({ kind: "cash-accounts", userId: "user 2", companyId: 7 });
  });

  it("rejects invalid company IDs and unrelated routes", () => {
    expect(
      classifyUserLocationConfigurationRoute("/api/user-locations/user-1/0")
    ).toBeNull();
    expect(
      classifyUserLocationConfigurationRoute("/api/my-locations")
    ).toBeNull();
  });
});
