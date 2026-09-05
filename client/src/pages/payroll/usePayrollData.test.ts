import { describe, expect, it } from "vitest";
import { buildPayrollLocationViews } from "./usePayrollData";

describe("buildPayrollLocationViews", () => {
  const hadiLocations = [
    { id: 101, name: "Hadi 1", companyId: 1, companyName: "HADI L'SHI" },
    { id: 102, name: "Hadi 2", companyId: 1, companyName: "HADI L'SHI" },
  ];

  it("gives an other company shared locations when it has no owned location rows", () => {
    const { allCompanyLocations } = buildPayrollLocationViews(hadiLocations, 1, [{ id: 2, name: "GC - LSHI" }]);

    expect(allCompanyLocations).toEqual([
      { id: 101, name: "Hadi 1", companyId: 2, companyName: "GC - LSHI" },
      { id: 102, name: "Hadi 2", companyId: 2, companyName: "GC - LSHI" },
    ]);
  });

  it("gives the selected company shared locations when it has no owned location rows", () => {
    const { locations } = buildPayrollLocationViews(hadiLocations, 2, [{ id: 1, name: "HADI L'SHI" }]);

    expect(locations).toEqual([
      { id: 101, name: "Hadi 1", companyId: 2 },
      { id: 102, name: "Hadi 2", companyId: 2 },
    ]);
  });

  it("keeps a company's own locations when they exist", () => {
    const companyLocations = [
      ...hadiLocations,
      { id: 201, name: "GC Main", companyId: 2, companyName: "GC - LSHI" },
    ];

    const { allCompanyLocations } = buildPayrollLocationViews(companyLocations, 1, [{ id: 2, name: "GC - LSHI" }]);

    expect(allCompanyLocations).toEqual([
      { id: 201, name: "GC Main", companyId: 2, companyName: "GC - LSHI" },
    ]);
  });
});
