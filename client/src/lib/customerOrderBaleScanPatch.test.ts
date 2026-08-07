import { describe, expect, it } from "vitest";
import {
  isCustomerOrderBaleScanPatch,
  mergeCustomerOrderBaleScanPatch,
  type CustomerOrderBaleScanPatch,
} from "./customerOrderBaleScanPatch";

const patch: CustomerOrderBaleScanPatch = {
  compactBaleScan: true,
  orderId: 42,
  order: {
    id: 42,
    customerId: 7,
    locationId: 3,
    status: "LOADING",
    containerNotes: "keep me",
  },
  bale: {
    id: 103,
    baleId: 903,
    baleReference: "REF-003",
    articleCode: "ART-1",
    baleName: "Article One",
    weight: "55.000",
    priceUsed: "12.50",
  },
  line: {
    id: 501,
    orderId: 42,
    articleCode: "ART-1",
    baleName: "Article One",
    qty: 2,
    weightPerBale: "52.500",
    totalWeight: "105.000",
    pricePerBale: "12.50",
    totalPrice: "25.00",
    pricingMode: "per_bale",
    pricePerKg: null,
  },
  totals: {
    subtotalBales: "45.00",
    freightAmount: "5.00",
    otherChargesTotal: "2.00",
    grandTotal: "52.00",
    totalQtyBales: 3,
    updatedAt: "2026-08-07T10:00:00.000Z",
  },
};

describe("customer order compact bale scan patch", () => {
  it("recognises the compact response contract", () => {
    expect(isCustomerOrderBaleScanPatch(patch)).toBe(true);
    expect(isCustomerOrderBaleScanPatch({ compactBaleScan: true })).toBe(false);
  });

  it("appends only the new bale, replaces the affected line, and preserves charges", () => {
    const current = {
      id: 42,
      customerId: 7,
      locationId: 3,
      status: "LOADING",
      containerNotes: "keep me",
      bales: [
        {
          id: 101,
          baleId: 901,
          baleReference: "REF-001",
          articleCode: "ART-1",
          baleName: "Article One",
          weight: "50.000",
          priceUsed: "12.50",
        },
        {
          id: 102,
          baleId: 902,
          baleReference: "REF-002",
          articleCode: "ART-2",
          baleName: "Article Two",
          weight: "60.000",
          priceUsed: "20.00",
        },
      ],
      lines: [
        { id: 401, orderId: 42, articleCode: "ART-1", qty: 1, totalPrice: "12.50" },
        { id: 402, orderId: 42, articleCode: "ART-2", qty: 1, totalPrice: "20.00" },
      ],
      charges: [{ id: 1, orderId: 42, name: "Freight", amount: "5.00", chargeType: "FREIGHT" }],
      totalQtyBales: 2,
      grandTotal: "39.50",
    };

    const merged = mergeCustomerOrderBaleScanPatch(current, patch);

    expect(merged.bales).toHaveLength(3);
    expect((merged.bales as any[]).map((b) => b.baleReference)).toEqual(["REF-001", "REF-002", "REF-003"]);
    expect(merged.lines).toHaveLength(2);
    expect((merged.lines as any[]).find((line) => line.articleCode === "ART-1")).toMatchObject({
      id: 501,
      qty: 2,
      totalPrice: "25.00",
    });
    expect((merged.lines as any[]).find((line) => line.articleCode === "ART-2")).toMatchObject({
      id: 402,
      qty: 1,
      totalPrice: "20.00",
    });
    expect(merged.charges).toEqual(current.charges);
    expect(merged).toMatchObject({
      totalQtyBales: 3,
      subtotalBales: "45.00",
      freightAmount: "5.00",
      otherChargesTotal: "2.00",
      grandTotal: "52.00",
      containerNotes: "keep me",
    });
  });

  it("uses the server order seed safely when the query cache is empty", () => {
    const merged = mergeCustomerOrderBaleScanPatch(undefined, patch);

    expect(merged).toMatchObject({
      id: 42,
      customerId: 7,
      locationId: 3,
      status: "LOADING",
      totalQtyBales: 3,
      grandTotal: "52.00",
    });
    expect(merged.bales).toEqual([patch.bale]);
    expect(merged.lines).toEqual([patch.line]);
    expect(merged.charges).toEqual([]);
  });
});
