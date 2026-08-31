import { describe, expect, it } from "vitest";

import { normalizeProformaImportLines } from "./proformaImportValidation";

describe("normalizeProformaImportLines", () => {
  it("accepts the supplier rows used by the CSV import flow", () => {
    const result = normalizeProformaImportLines([
      {
        barcode: "MJS31006",
        itemName: "CHILDREN BOOT CREME 20 KGS",
        qty: 1,
        weightPerBale: "0",
        pricePerBale: "240",
      },
      {
        barcode: "MJS31001",
        itemName: "LADY SANDAL CREME 15 KGS",
        qty: 1,
        weightPerBale: "0",
        pricePerBale: "200",
      },
      {
        barcode: "MJS31014",
        itemName: "HIGH HEEL SHOES CREME 25 KGS",
        qty: 1,
        weightPerBale: "0",
        pricePerBale: "150",
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      {
        barcode: "MJS31006",
        itemName: "CHILDREN BOOT CREME 20 KGS",
        qty: 1,
        weightPerBale: "0.000",
        pricePerBale: "240.00",
      },
      {
        barcode: "MJS31001",
        itemName: "LADY SANDAL CREME 15 KGS",
        qty: 1,
        weightPerBale: "0.000",
        pricePerBale: "200.00",
      },
      {
        barcode: "MJS31014",
        itemName: "HIGH HEEL SHOES CREME 25 KGS",
        qty: 1,
        weightPerBale: "0.000",
        pricePerBale: "150.00",
      },
    ]);
  });

  it("accepts comma decimal values without exposing them to PostgreSQL unparsed", () => {
    const result = normalizeProformaImportLines([
      {
        Barcode: "MJS31099",
        "Item Name": "TEST ITEM",
        Qty: "2",
        "Weight per Bale": "20,5",
        "Price per Bale": "240,50",
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.lines[0]).toMatchObject({ weightPerBale: "20.500", pricePerBale: "240.50" });
  });

  it("rejects rows that would violate the database columns before insertion", () => {
    const result = normalizeProformaImportLines([
      {
        barcode: "X".repeat(201),
        itemName: "",
        qty: 1.5,
        weightPerBale: "bad-value",
        pricePerBale: "99999999999999",
      },
    ]);

    expect(result.lines).toEqual([]);
    expect(result.errors.join(" ")).toContain("Barcode is longer than 200 characters");
    expect(result.errors.join(" ")).toContain("Item Name is required");
    expect(result.errors.join(" ")).toContain("Qty must be a whole number");
    expect(result.errors.join(" ")).toContain("Weight per Bale is not a valid number");
    expect(result.errors.join(" ")).toContain("Price per Bale is too large");
  });
});
