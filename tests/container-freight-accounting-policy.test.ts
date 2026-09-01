import { describe, expect, it } from "vitest";
import { calcPoAmounts } from "../server/routes/containers/containerHelpers";

const basePo = {
  itemsTotal: "1000",
  freight: "150",
  surcharge: "25",
  fumigation: "10",
  documentCharges: "5",
  discount: "20",
  otherCharges: "30",
};

describe("container freight accounting policy", () => {
  it("keeps supplier-paid freight in the supplier share", () => {
    const result = calcPoAmounts({ ...basePo, freightPaidBy: "supplier" });
    expect(result.grossTotal).toBe(1200);
    expect(result.intercoTotal).toBe(1200);
  });

  it("excludes own-account freight from the supplier share", () => {
    const result = calcPoAmounts({ ...basePo, freightPaidBy: "own" });
    expect(result.grossTotal).toBe(1200);
    expect(result.intercoTotal).toBe(1050);
  });

  it("excludes parent-paid freight from the supplier share", () => {
    const result = calcPoAmounts({ ...basePo, freightPaidBy: "parent" });
    expect(result.grossTotal).toBe(1200);
    expect(result.intercoTotal).toBe(1050);
  });

  it("defaults missing freight policy to supplier-paid", () => {
    const result = calcPoAmounts(basePo);
    expect(result.freightPaidBy).toBe("supplier");
    expect(result.intercoTotal).toBe(result.grossTotal);
  });
});
