import {
  authenticatedUserSchema,
  companyTypeSchema,
  parseAuthenticatedUser,
  parseSessionCompany,
  parseUserCompanies,
} from "@/contracts/sessionContracts";

describe("session API contracts", () => {
  it("accepts the supported company types", () => {
    for (const companyType of ["erp", "factory", "factory_v2", "properties", "supplier_partner"]) {
      expect(companyTypeSchema.parse(companyType)).toBe(companyType);
    }
  });

  it("normalizes an unknown company type to ERP for backward compatibility", () => {
    const [assignment] = parseUserCompanies([
      {
        companyId: "7",
        companyCode: "GC",
        companyName: "GC Lshi",
        companyActive: true,
        companyType: "legacy",
      },
    ]);

    expect(assignment.companyId).toBe(7);
    expect(assignment.companyType).toBe("erp");
  });

  it("rejects malformed company assignments instead of leaking any into the UI", () => {
    expect(() => parseUserCompanies([{ companyId: "bad", companyName: "" }])).toThrow(
      "Invalid user-companies response",
    );
  });

  it("parses authenticated users and preserves additional server fields", () => {
    const user = parseAuthenticatedUser({
      id: 12,
      username: "hassan",
      role: "Admin",
      customPermission: true,
    });

    expect(user).toMatchObject({ id: 12, username: "hassan", role: "Admin", customPermission: true });
    expect(authenticatedUserSchema.safeParse(user).success).toBe(true);
  });

  it("keeps unauthenticated responses nullable", () => {
    expect(parseAuthenticatedUser(null)).toBeNull();
  });

  it("rejects authenticated-user responses without a username", () => {
    expect(() => parseAuthenticatedUser({ id: 1, role: "Admin" })).toThrow(
      "Invalid authenticated-user response",
    );
  });

  it("coerces valid session company identifiers and accepts null", () => {
    expect(parseSessionCompany({ companyId: "9" })).toEqual({ companyId: 9 });
    expect(parseSessionCompany({ companyId: null })).toEqual({ companyId: null });
  });
});
