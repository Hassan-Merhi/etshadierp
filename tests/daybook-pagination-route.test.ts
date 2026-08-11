import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  assignedLocations: [{ locationId: 17 }, { locationId: 18 }],
  poolQuery: vi.fn(),
}));

vi.mock("../server/auth", () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => harness.assignedLocations }) }),
  },
  pool: { query: harness.poolQuery },
}));
vi.mock("@shared/schema", () => ({
  userLocations: {
    userId: "userLocations.userId",
    companyId: "userLocations.companyId",
    locationId: "userLocations.locationId",
  },
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

import { registerDaybookPaginationRoutes } from "../server/routes/daybookPaginationRoutes";

describe("ERP Daybook pagination route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.handlers.clear();
    harness.poolQuery.mockResolvedValue({
      rows: [
        {
          total: 251,
          items: [
            { _type: "voucher", data: { id: 1, voucherType: "Receipt" } },
            { _type: "offload", data: { id: 2, containerNumber: "CNT-2" } },
          ],
        },
      ],
    });
    registerDaybookPaginationRoutes({
      get: (path: string, ...callbacks: Array<(...args: any[]) => unknown>) => {
        harness.handlers.set(path, callbacks.at(-1)!);
      },
    } as never);
  });

  it("returns a server-filtered POS page with location scope, amount/search filters, and stable pagination metadata", async () => {
    const req = {
      session: { currentCompanyId: 4, currentRole: "POS" },
      user: { id: "user-7" },
      query: {
        startDate: "2026-08-01",
        endDate: "2026-08-11",
        voucherType: "Receipt",
        statusFilter: "active",
        search: "riverside",
        minAmount: "10",
        maxAmount: "500",
        offset: "250",
        limit: "500",
        sortOrder: "asc",
      },
    };
    const headers = new Map<string, string>();
    const res = {
      status: vi.fn(),
      json: vi.fn(),
      setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    };
    res.status.mockReturnValue(res);

    await harness.handlers.get("/api/daybook")!(req, res);

    expect(res.json).toHaveBeenCalledWith({
      items: [
        { _type: "voucher", data: { id: 1, voucherType: "Receipt" } },
        { _type: "offload", data: { id: 2, containerNumber: "CNT-2" } },
      ],
      total: 251,
      page: 2,
      limit: 250,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(headers.get("X-Total-Count")).toBe("251");
    expect(headers.get("X-Page")).toBe("2");
    expect(headers.get("X-Page-Size")).toBe("250");
    expect(headers.get("X-Total-Pages")).toBe("2");
    const [query, values] = harness.poolQuery.mock.calls[0];
    expect(query).toContain("v.voucher_type =");
    expect(query).toContain("v.optional = false");
    expect(query).toContain("v.location_id = ANY");
    expect(query).toContain("ORDER BY sort_date ASC");
    expect(values).toEqual(
      expect.arrayContaining([4, "2026-08-01", "2026-08-11", "Receipt", "%riverside%", 10, 500, [17, 18], true, 250])
    );
  });

  it("rejects an unscoped request before issuing SQL", async () => {
    const req = { session: {}, query: {} };
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);

    await harness.handlers.get("/api/daybook")!(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "No company selected" });
    expect(harness.poolQuery).not.toHaveBeenCalled();
  });
});
