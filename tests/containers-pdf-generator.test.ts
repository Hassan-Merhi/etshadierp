import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: { query: harness.poolQuery },
}));

import { generateContainersPdf } from "../server/helpers/generateContainersPdf";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("containers OTW PDF generator", () => {
  it("renders active containers, company groups, delays, and fallbacks into a valid PDF", async () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    harness.poolQuery.mockResolvedValue({
      rows: [
        {
          container_number: "MRKU000001",
          company_name: "Alpha Co",
          shop_name: "Main Shop",
          supplier_name: "Supplier A",
          number_plate: null,
          tracking_location: "Port",
          eta: past,
          status: "In Transit",
          transporter: "Transport A",
          agent: "Agent A",
          tracking_description: "Awaiting customs",
        },
        {
          container_number: "MRKU000002",
          company_name: "Alpha Co",
          shop_name: null,
          supplier_name: null,
          number_plate: "TRK-22",
          tracking_location: null,
          eta: past,
          status: "Arrived",
          transporter: null,
          agent: null,
          tracking_description: null,
        },
        {
          container_number: "MSKU000003",
          company_name: "Beta Co",
          shop_name: "Branch",
          supplier_name: "Supplier B",
          number_plate: null,
          tracking_location: "Sea",
          eta: future,
          status: "Sailing",
          transporter: "Transport B",
          agent: "Agent B",
          tracking_description: "On vessel",
        },
      ],
    });

    const result = await generateContainersPdf();

    expect(result.rowCount).toBe(3);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(result.buffer.length).toBeGreaterThan(1500);
    expect(harness.poolQuery).toHaveBeenCalledTimes(1);
    expect(String(harness.poolQuery.mock.calls[0][0])).toContain("WHERE c.status NOT IN");
  });

  it("renders an empty report without failing", async () => {
    harness.poolQuery.mockResolvedValue({ rows: [] });

    const result = await generateContainersPdf();

    expect(result.rowCount).toBe(0);
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("paginates long reports", async () => {
    harness.poolQuery.mockResolvedValue({
      rows: Array.from({ length: 80 }, (_, index) => ({
        container_number: `CTR-${String(index + 1).padStart(4, "0")}`,
        company_name: index < 40 ? "Alpha Co" : "Beta Co",
        shop_name: "Shop",
        supplier_name: "Supplier",
        number_plate: null,
        tracking_location: "Transit",
        eta: null,
        status: "In Transit",
        transporter: "Transporter",
        agent: "Agent",
        tracking_description: "Moving",
      })),
    });

    const result = await generateContainersPdf();

    expect(result.rowCount).toBe(80);
    expect(result.buffer.length).toBeGreaterThan(5000);
  });
});
