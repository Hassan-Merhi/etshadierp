import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    inserts: [] as unknown[],
    loggerError: vi.fn(),
    failInsert: false,
  };

  const select = vi.fn(() => {
    const result = state.selectResults.shift() ?? [];
    const builder: any = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  });
  const insert = vi.fn(() => ({
    values: vi.fn(async (value: unknown) => {
      if (state.failInsert) throw new Error("insert failed");
      state.inserts.push(value);
    }),
  }));

  return { ...state, db: { select, insert } };
});

vi.mock("../server/db", () => ({ db: harness.db }));
vi.mock("../server/lib/logger", () => ({ logger: { error: harness.loggerError } }));
vi.mock("../server/services/smartTransferPerformance", () => ({
  roundNumber: (value: number, digits = 2) => Number(value.toFixed(digits)),
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  desc: (column: unknown) => ({ type: "desc", column }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  gte: (column: unknown, value: unknown) => ({ type: "gte", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ type: "inArray", column, values }),
  isNull: (column: unknown) => ({ type: "isNull", column }),
  lte: (column: unknown, value: unknown) => ({ type: "lte", column, value }),
}));
vi.mock("@shared/schema", () => ({
  aiActionLog: {
    companyId: "aiActionLog.companyId",
    userId: "aiActionLog.userId",
    sessionId: "aiActionLog.sessionId",
    actionName: "aiActionLog.actionName",
    createdAt: "aiActionLog.createdAt",
  },
  salesItems: {
    stockItemId: "salesItems.stockItemId",
    voucherId: "salesItems.voucherId",
    quantity: "salesItems.quantity",
  },
  stockTransferItems: {
    transferId: "stockTransferItems.transferId",
    stockItemId: "stockTransferItems.stockItemId",
    sourceLocationId: "stockTransferItems.sourceLocationId",
    quantity: "stockTransferItems.quantity",
  },
  stockTransferVouchers: {
    id: "stockTransferVouchers.id",
    voucherId: "stockTransferVouchers.voucherId",
    destinationLocationId: "stockTransferVouchers.destinationLocationId",
    inventoryApplied: "stockTransferVouchers.inventoryApplied",
    createdAt: "stockTransferVouchers.createdAt",
  },
  vouchers: {
    id: "vouchers.id",
    companyId: "vouchers.companyId",
    voucherType: "vouchers.voucherType",
    deletedAt: "vouchers.deletedAt",
    optional: "vouchers.optional",
    voucherDate: "vouchers.voucherDate",
    locationId: "vouchers.locationId",
  },
}));

import {
  createSmartTransferPreviewFeedback,
  getSmartTransferFeedbackSummary,
  recordSmartTransferImportFeedback,
  resetSmartTransferFeedback,
} from "../server/services/smartTransferFeedback";

describe("smart transfer feedback behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.selectResults.splice(0);
    harness.inserts.splice(0);
    harness.failInsert = false;
  });

  it("normalizes and merges preview lines before logging feedback", async () => {
    const sessionId = await createSmartTransferPreviewFeedback({
      companyId: 4,
      userId: "planner-1",
      requestInput: { targetQuantity: 20 },
      preview: {
        destinationLocationId: 9,
        targetQuantity: 20,
        achievedQuantity: 18,
        lines: [
          { stockItemId: 7, sourceLocationId: 2, quantity: 5.9, forecastDailyRate: 2, itemScore: 80 },
          { stockItemId: 7, sourceLocationId: 2, suggestedQuantity: 3, forecastDailyRate: 4, itemScore: 92 },
          { stockItemId: 8, sourceLocationId: 3, quantity: 10, forecastDailyRate: 1, itemScore: 65 },
          { stockItemId: 0, sourceLocationId: 3, quantity: 99 },
        ],
      },
    });

    expect(sessionId).toMatch(/^stf_/);
    expect(harness.inserts).toHaveLength(1);
    expect(harness.inserts[0]).toMatchObject({
      companyId: 4,
      userId: "planner-1",
      sessionId,
      actionName: "smart_transfer_preview_v4",
      status: "success",
      outputJson: {
        destinationLocationId: 9,
        targetQuantity: 20,
        achievedQuantity: 18,
        averageItemScore: 78.5,
        lines: [
          {
            stockItemId: 7,
            sourceLocationId: 2,
            quantity: 8,
            forecastDailyRate: 4,
            itemScore: 92,
          },
          {
            stockItemId: 8,
            sourceLocationId: 3,
            quantity: 10,
            forecastDailyRate: 1,
            itemScore: 65,
          },
        ],
      },
    });
  });

  it("fails preview feedback closed to null without interrupting the transfer workflow", async () => {
    harness.failInsert = true;
    const sessionId = await createSmartTransferPreviewFeedback({
      companyId: 4,
      userId: "planner-1",
      requestInput: {},
      preview: { destinationLocationId: 9, lines: [] },
    });

    expect(sessionId).toBeNull();
    expect(harness.loggerError).toHaveBeenCalledWith(
      "[SmartTransferFeedback] Preview log failed:",
      expect.objectContaining({ error: "insert failed" })
    );
  });

  it("matches an import to the latest preview and measures quantity/source edits", async () => {
    harness.selectResults.push([
      {
        sessionId: "stf_existing",
        outputJson: {
          destinationLocationId: 9,
          lines: [
            { stockItemId: 7, sourceLocationId: 2, quantity: 10, forecastDailyRate: 2, itemScore: 90 },
            { stockItemId: 8, sourceLocationId: 3, quantity: 5, forecastDailyRate: 1, itemScore: 70 },
          ],
        },
      },
    ]);

    const result = await recordSmartTransferImportFeedback({
      companyId: 4,
      userId: "planner-1",
      destinationLocationId: 9,
      sourceLocationIds: [2, 3, 5],
      importedItems: [
        { stockItemId: 7, sourceLocationId: 2, quantity: 7 },
        { stockItemId: 7, sourceLocationId: 5, quantity: 2 },
        { stockItemId: 8, sourceLocationId: 3, quantity: 6 },
      ],
    });

    expect(result.sessionId).toBe("stf_existing");
    expect(result.matchedPreview).toBe(true);
    expect(result.comparison).toMatchObject({
      suggestedQuantity: 15,
      finalQuantity: 15,
      keptQuantity: 12,
      addedQuantity: 3,
      removedQuantity: 3,
      sourceChangedQuantity: 2,
      edited: true,
      quantityKeptPct: 80,
      lineKeptPct: 100,
      itemKeptPct: 100,
    });
    expect(harness.inserts.at(-1)).toMatchObject({
      sessionId: "stf_existing",
      actionName: "smart_transfer_import_v4",
      outputJson: expect.objectContaining({ matchedPreview: true }),
    });
  });

  it("creates an unmatched import session when no compatible preview exists", async () => {
    harness.selectResults.push([]);
    const result = await recordSmartTransferImportFeedback({
      companyId: 4,
      userId: "planner-2",
      destinationLocationId: 12,
      sourceLocationIds: [2],
      importedItems: [{ stockItemId: 9, sourceLocationId: 2, quantity: 3 }],
      sessionId: "caller-session",
    });

    expect(result).toEqual({ sessionId: "caller-session", matchedPreview: false, comparison: null });
    expect(harness.inserts.at(-1)).toMatchObject({
      actionName: "smart_transfer_import_v4",
      outputJson: expect.objectContaining({ matchedPreview: false, comparison: null }),
    });
  });

  it("summarizes adoption and edit retention while recommending more samples", async () => {
    const now = new Date();
    const preview = {
      id: 1,
      companyId: 4,
      userId: "planner-1",
      sessionId: "stf_a",
      actionName: "smart_transfer_preview_v4",
      createdAt: now,
      outputJson: { destinationLocationId: 9 },
    };
    const comparison = {
      suggestedQuantity: 10,
      finalQuantity: 8,
      keptQuantity: 7,
      addedQuantity: 1,
      removedQuantity: 3,
      suggestedLineCount: 2,
      finalLineCount: 2,
      keptLineCount: 2,
      suggestedItemCount: 2,
      keptItemCount: 2,
      sourceChangedQuantity: 1,
      quantityKeptPct: 70,
      lineKeptPct: 100,
      itemKeptPct: 100,
      sourceKeptPct: 87.5,
      edited: true,
    };
    const imported = {
      id: 2,
      companyId: 4,
      userId: "planner-1",
      sessionId: "stf_a",
      actionName: "smart_transfer_import_v4",
      createdAt: now,
      inputJson: { destinationLocationId: 9 },
      outputJson: { comparison, importedItems: [] },
    };

    harness.selectResults.push(
      [],
      [
        { ...preview, actionName: "smart_transfer_preview_v4" },
        { ...imported, actionName: "smart_transfer_import_v4" },
        { ...imported, actionName: "smart_transfer_approval_v4" },
      ],
      [preview, imported]
    );

    const summary = await getSmartTransferFeedbackSummary(4, 2);

    expect(summary.periodDays).toBe(7);
    expect(summary.counts).toEqual({
      previews: 1,
      imports: 1,
      approvals: 0,
      finalizedPerformanceSamples: 0,
    });
    expect(summary.adoption).toEqual({ importRatePct: 100, approvalRatePct: 0 });
    expect(summary.editing).toMatchObject({
      editedImportPct: 100,
      quantityKeptPct: 70,
      lineKeptPct: 100,
      itemKeptPct: 100,
      sourceKeptPct: 87.5,
      addedQuantity: 1,
      removedQuantity: 3,
      sourceChangedQuantity: 1,
    });
    expect(summary.recommendations).toContain(
      "Collect at least five approved smart transfers before changing forecasting or source-selection weights."
    );
  });

  it("records a reset marker for the current company and user", async () => {
    const sessionId = await resetSmartTransferFeedback({ companyId: 4, userId: "developer" });
    expect(sessionId).toMatch(/^stf_reset_/);
    expect(harness.inserts.at(-1)).toMatchObject({
      companyId: 4,
      userId: "developer",
      sessionId,
      actionType: "write",
      actionName: "smart_transfer_feedback_reset_v4",
      status: "success",
    });
  });
});
