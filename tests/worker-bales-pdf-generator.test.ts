import { describe, expect, it } from "vitest";
import { generateWorkerBalesPdf } from "../server/lib/workerBalesPdfGenerator";

describe("worker bales PDF generator", () => {
  it("renders grouped worker details and summary into a valid PDF", async () => {
    const pdf = await generateWorkerBalesPdf(
      [
        {
          workerName: "Adam",
          productName: "Mixed Clothes",
          articleCode: "MC",
          baleCount: 2,
          totalWeight: 100,
          bales: [
            {
              referenceNumber: "BL-001",
              workerName: "Adam",
              productName: "Mixed Clothes",
              articleCode: "MC",
              weightKg: "50",
            },
            {
              referenceNumber: "BL-002",
              workerName: "Adam",
              productName: "Shoes",
              articleCode: "SH",
              weightKg: 50,
            },
          ],
        },
        {
          workerName: "Beatrice",
          bales: [
            {
              referenceNumber: "BL-003",
              workerName: "Beatrice",
              productName: "Kids Wear",
              articleCode: "KW",
              weightKg: 45.5,
            },
          ],
        },
      ],
      "2026-08-24",
      "HMD International",
    );

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("handles unassigned and empty bale metadata without failing", async () => {
    const pdf = await generateWorkerBalesPdf(
      [
        {
          bales: [
            { referenceNumber: null, workerName: null, productName: null, articleCode: null, weightKg: null },
          ],
        },
      ],
      "2026-08-24",
    );

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("adds additional pages for long worker reports", async () => {
    const bales = Array.from({ length: 70 }, (_, index) => ({
      referenceNumber: `BL-${String(index + 1).padStart(3, "0")}`,
      workerName: index < 35 ? "Worker A" : "Worker B",
      productName: index % 2 === 0 ? "Product A" : "Product B",
      articleCode: index % 2 === 0 ? "PA" : "PB",
      weightKg: 50 + (index % 3),
    }));

    const pdf = await generateWorkerBalesPdf([{ bales }], "2026-08-24", "Factory");

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
