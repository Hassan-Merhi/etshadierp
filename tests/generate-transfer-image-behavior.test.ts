import { describe, expect, it } from "vitest";

import {
  generateRevisedTransferImageBuffer,
  generateTransferImageBuffer,
} from "../server/helpers/generateTransferImage";

function expectPng(buffer: Buffer) {
  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(buffer.length).toBeGreaterThan(1_000);
  expect(Array.from(buffer.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
}

describe("stock transfer image rendering", () => {
  it("renders a regular transfer card with long names, mixed units, and fractional quantities", async () => {
    const buffer = await generateTransferImageBuffer({
      voucherNumber: "ST-2026-000123",
      date: "2026-08-12",
      sourceLocationName: "Lubumbashi Main Warehouse With A Very Long Display Name",
      destLocationName: "Kolwezi Distribution Warehouse With A Very Long Display Name",
      items: [
        { name: "Adult Anorak Premium Mixed Colours Extra Long Product Name", quantity: 12, uom: "bales" },
        { name: "Baby Blankets", quantity: 3.125, uom: "bales" },
        { name: "Hand Bags", quantity: 7.5, uom: "pcs" },
      ],
    });

    expectPng(buffer);
  });

  it("renders a revised transfer card with increases, decreases, unchanged values, and mixed units", async () => {
    const buffer = await generateRevisedTransferImageBuffer({
      voucherNumber: "ST-2026-000124",
      date: "2026-08-12",
      sourceLocationName: "Hadi Warehouse 1",
      destLocationName: "Kolwezi 2",
      items: [
        { name: "Adult Anorak", uom: "bales", before: 10, delta: 3, after: 13 },
        { name: "Bedsheet Mix", uom: "bales", before: 8.5, delta: -2.25, after: 6.25 },
        { name: "Boy Pants", uom: "pcs", before: 4, delta: 0, after: 4 },
      ],
    });

    expectPng(buffer);
  });
});
