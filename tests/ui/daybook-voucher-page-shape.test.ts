import { unwrapPage } from "@/lib/frontendDataArchitecture";

/**
 * The Daybook table used to read `response.data` directly. When /api/vouchers
 * answered with a bare array — its documented non-paginated shape — that read
 * was undefined and the page rendered zero rows for data that had arrived.
 */
describe("Daybook voucher page normalization", () => {
  it("reads rows out of the paginated envelope", () => {
    const page = unwrapPage<{ id: number }>(
      { data: [{ id: 1 }, { id: 2 }], page: 1, pageSize: 100, total: 2, totalPages: 1, hasMore: false },
      { page: 1, pageSize: 100 },
    );
    expect(page.data).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(1);
  });

  it("reads rows out of a bare array response", () => {
    const page = unwrapPage<{ id: number }>([{ id: 1 }, { id: 2 }, { id: 3 }], { page: 1, pageSize: 100 });
    expect(page.data).toHaveLength(3);
    expect(page.total).toBe(3);
    expect(page.page).toBe(1);
  });

  it("treats a missing response as an empty page", () => {
    const page = unwrapPage<{ id: number }>(undefined, { page: 1, pageSize: 100 });
    expect(page.data).toEqual([]);
    expect(page.totalPages).toBe(0);
  });
});
