import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  logAudit: vi.fn(),
  selectResults: [] as unknown[][],
  updatedValues: vi.fn(),
  updateWhere: vi.fn(),
  insertedValues: vi.fn(),
}));

function selectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  return chain;
}

vi.mock("../server/db", () => ({
  db: {
    select: harness.select,
    update: harness.update,
    insert: harness.insert,
  },
}));

vi.mock("../server/routes/_helpers", () => ({
  logAudit: harness.logAudit,
}));

import {
  assertJobOwnership,
  postRows,
  upsertCorrection,
  validateCustomerRows,
  validateGenericRows,
  validateRows,
  validateStockItemRows,
  validateSupplierRows,
  validateVoucherRows,
} from "../server/routes/ai-import/_helpers";

beforeEach(() => {
  vi.clearAllMocks();
  harness.selectResults.length = 0;
  harness.select.mockImplementation(() => selectChain(harness.selectResults.shift() ?? []));
  harness.updateWhere.mockResolvedValue(undefined);
  harness.updatedValues.mockReturnValue({ where: harness.updateWhere });
  harness.update.mockReturnValue({ set: harness.updatedValues });
  harness.insertedValues.mockResolvedValue(undefined);
  harness.insert.mockReturnValue({ values: harness.insertedValues });
  harness.logAudit.mockResolvedValue(undefined);
});

describe("AI import ownership and correction memory", () => {
  it("returns an owned job and rejects a missing job", async () => {
    harness.selectResults.push([{ id: 5, companyId: 7 }]);
    await expect(assertJobOwnership(5, 7)).resolves.toMatchObject({ id: 5, companyId: 7 });

    harness.selectResults.push([]);
    await expect(assertJobOwnership(6, 7)).rejects.toMatchObject({ message: "Import job not found", status: 404 });
  });

  it("updates existing correction memory and inserts a new correction", async () => {
    harness.selectResults.push([{ id: 10 }]);
    await upsertCorrection({
      companyId: 7,
      userId: "u1",
      memoryType: "item_alias",
      rawValue: "old group",
      resolvedId: 21,
      resolvedValue: "New Group",
      resolvedType: "stock_group",
      confidence: 100,
    });
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.updatedValues).toHaveBeenCalledWith(expect.objectContaining({ resolvedId: 21, confidence: 100 }));

    harness.selectResults.push([]);
    await upsertCorrection({
      companyId: 7,
      userId: "u2",
      memoryType: "ledger_alias",
      rawValue: "cash box",
      resolvedId: 31,
      resolvedValue: "Cash",
      resolvedType: "ledger_account",
    });
    expect(harness.insertedValues).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 7,
        memoryType: "ledger_alias",
        rawValue: "cash box",
        resolvedId: 31,
        confidence: 100,
        createdBy: "u2",
      })
    );
  });
});

describe("AI import validators", () => {
  it("validates stock item names, codes, prices, groups, aliases, and batch duplicates", async () => {
    harness.selectResults.push(
      [{ code: "EXIST" }],
      [{ id: 9, name: "Hardware", code: "HW" }],
      [{ rawValue: "remembered", resolvedId: 10 }]
    );

    const result = await validateStockItemRows(7, [
      { id: 1, rowNumber: 1, rawData: { name: "Hammer", code: "NEW", sellingPrice: 12, stockGroup: "HW" } },
      { id: 2, rowNumber: 2, rawData: { name: "Alias item", code: "SECOND", stockGroup: "remembered" } },
      { id: 3, rowNumber: 3, rawData: { name: "Duplicate", code: "NEW", sellingPrice: -1, stockGroup: "missing" } },
      { id: 4, rowNumber: 4, rawData: { name: "", code: "EXIST", sellingPrice: "bad" } },
      { id: 5, rowNumber: 5, rawData: { name: "No code" } },
    ]);

    expect(result[0]).toMatchObject({ status: "valid", mappedData: expect.objectContaining({ stockGroupId: 9 }) });
    expect(result[1]).toMatchObject({ status: "valid", mappedData: expect.objectContaining({ stockGroupId: 10 }) });
    expect(result[2].status).toBe("error");
    expect(result[2].errors.join(" ")).toContain("duplicated within this import");
    expect(result[2].warnings.join(" ")).toContain("not found");
    expect(result[3].errors).toEqual(expect.arrayContaining(["name is required", 'code "EXIST" already exists']));
    expect(result[4]).toMatchObject({ status: "warning", mappedData: expect.objectContaining({ code: null }) });
  });

  it("validates customer and supplier identity fields and duplicate codes", async () => {
    harness.selectResults.push([{ code: "C-1" }]);
    const customers = await validateCustomerRows(7, [
      { id: 1, rowNumber: 1, rawData: { name: "Alice", code: "C-2", phone: "123" } },
      { id: 2, rowNumber: 2, rawData: { name: "Bob", code: "C-2" } },
      { id: 3, rowNumber: 3, rawData: { name: "", code: "C-1" } },
    ]);
    expect(customers[0]).toMatchObject({
      status: "valid",
      mappedData: expect.objectContaining({ legalName: "Alice" }),
    });
    expect(customers[1].errors.join(" ")).toContain("duplicated within this import");
    expect(customers[2].errors).toEqual(expect.arrayContaining(["name is required", 'code "C-1" already exists']));

    harness.selectResults.push([{ code: "S-1" }]);
    const suppliers = await validateSupplierRows(7, [
      { id: 4, rowNumber: 1, rawData: { legalName: "Supply Co", code: "S-2", openingBalance: "40.50" } },
      { id: 5, rowNumber: 2, rawData: { name: "", code: "S-1" } },
    ]);
    expect(suppliers[0]).toMatchObject({
      status: "valid",
      mappedData: expect.objectContaining({ legalName: "Supply Co", openingBalance: "40.5" }),
    });
    expect(suppliers[1].errors).toEqual(expect.arrayContaining(["legalName is required", 'code "S-1" already exists']));
  });

  it("validates voucher dates, types, account aliases, account lookups, and positive amounts", async () => {
    harness.selectResults.push(
      [
        { id: 101, name: "Cash", code: "1000" },
        { id: 202, name: "Sales", code: "4000" },
      ],
      [{ rawValue: "cashbox", resolvedId: 101, resolvedValue: "Cash" }]
    );

    const result = await validateVoucherRows(7, [
      {
        id: 1,
        rowNumber: 1,
        rawData: { date: "2026-08-24", type: "Payment", debitAccount: "cashbox", creditAccount: "Sales", amount: "25" },
      },
      {
        id: 2,
        rowNumber: 2,
        rawData: { date: "24/08/2026", type: "Unknown", debitAccount: "missing", creditAccount: "", amount: 0 },
      },
    ]);

    expect(result[0]).toMatchObject({
      status: "valid",
      mappedData: expect.objectContaining({ debitAccountId: 101, creditAccountId: 202, amount: "25.00" }),
    });
    expect(result[1].status).toBe("error");
    expect(result[1].errors.join(" ")).toContain("must be YYYY-MM-DD");
    expect(result[1].errors.join(" ")).toContain("type must be Payment, Receipt, or Journal");
    expect(result[1].errors.join(" ")).toContain("creditAccount is required");
    expect(result[1].errors.join(" ")).toContain("amount must be a positive number");
  });

  it("routes known validators and returns a readable generic fallback", async () => {
    const generic = validateGenericRows([{ id: 9, rowNumber: 1, rawData: { anything: true } }]);
    expect(generic[0]).toMatchObject({
      status: "valid",
      mappedData: { anything: true },
      warnings: ["importType not recognized — no validation applied"],
    });

    await expect(validateRows(7, "unknown", [{ id: 10, rowNumber: 1, rawData: { value: 1 } }])).resolves.toMatchObject([
      { id: 10, status: "valid" },
    ]);
  });
});

describe("AI import posters", () => {
  function txWithIds(ids: number[]) {
    return {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: ids.shift() ?? 999 }]),
        })),
      })),
    };
  }

  it("posts stock items, customers, and suppliers and records an audit for each", async () => {
    const stockTx = txWithIds([501]);
    const stock = await postRows(
      7,
      "u1",
      "Operator",
      "stock_items",
      [
        {
          id: 1,
          mappedData: { name: "Hammer", code: "H1", sellingPrice: "10.00", reorderLevel: "2.00", stockGroupId: 9 },
        },
      ],
      stockTx as never
    );
    expect(stock).toEqual([{ rowId: 1, recordType: "stock_item", recordId: 501 }]);

    const customerTx = txWithIds([601]);
    const customer = await postRows(
      7,
      "u1",
      "Operator",
      "customers",
      [
        {
          id: 2,
          mappedData: { name: "Alice", legalName: "Alice Ltd", code: "C1", phone: "1", email: "a@example.com" },
        },
      ],
      customerTx as never
    );
    expect(customer).toEqual([{ rowId: 2, recordType: "customer", recordId: 601 }]);

    const supplierTx = txWithIds([701]);
    const supplier = await postRows(
      7,
      "u1",
      "Operator",
      "suppliers",
      [{ id: 3, mappedData: { legalName: "Supply Co", code: "S1", openingBalance: "50" } }],
      supplierTx as never
    );
    expect(supplier).toEqual([{ rowId: 3, recordType: "supplier", recordId: 701 }]);

    expect(harness.logAudit).toHaveBeenCalledTimes(3);
    expect(await postRows(7, "u1", "Operator", "vouchers", [], supplierTx as never)).toEqual([]);
  });
});
