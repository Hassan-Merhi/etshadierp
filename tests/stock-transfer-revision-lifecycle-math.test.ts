import { describe, expect, it } from "vitest";
import {
  mergePendingRevisionTargets,
  normalizePendingRevisionItems,
} from "../server/services/stockTransferRevisionLifecycle";

describe("stock transfer revision lifecycle math", () => {
  it("deduplicates a pending snapshot by item and source", () => {
    const normalized = normalizePendingRevisionItems([
      {
        stockItemId: 10,
        stockItemName: "Bale A",
        sourceLocationId: 2,
        originalQuantity: 10,
        newQuantity: 12,
      },
      {
        stockItemId: 10,
        stockItemName: "Bale A latest",
        sourceLocationId: 2,
        originalQuantity: 10,
        newQuantity: 15,
      },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      stockItemId: 10,
      sourceLocationId: 2,
      originalQuantity: 10,
      newQuantity: 15,
      delta: 5,
    });
  });

  it("drops zero-change rows", () => {
    expect(() =>
      normalizePendingRevisionItems([
        {
          stockItemId: 10,
          stockItemName: "Bale A",
          sourceLocationId: 2,
          originalQuantity: 10,
          newQuantity: 10,
        },
      ])
    ).toThrow(/no effective quantity changes/i);
  });

  it("uses the earliest original quantity and latest target", () => {
    const targets = mergePendingRevisionTargets(
      [
        { id: 8, revisionNumber: 2 },
        { id: 7, revisionNumber: 1 },
      ],
      [
        {
          revisionId: 7,
          stockItemId: 10,
          sourceLocationId: 2,
          originalQuantity: "10",
          newQuantity: "12",
        },
        {
          revisionId: 8,
          stockItemId: 10,
          sourceLocationId: 2,
          originalQuantity: "10",
          newQuantity: "15",
        },
      ]
    );

    expect(targets).toEqual([
      {
        stockItemId: 10,
        sourceLocationId: 2,
        originalQuantity: 10,
        newQuantity: 15,
      },
    ]);
  });

  it.each([
    [[], /at least one changed item/i],
    [
      [{ stockItemId: 0, stockItemName: "Invalid", sourceLocationId: 2, originalQuantity: 1, newQuantity: 2 }],
      /stock item id/i,
    ],
    [
      [{ stockItemId: 1, stockItemName: "Invalid", sourceLocationId: 0, originalQuantity: 1, newQuantity: 2 }],
      /source location id/i,
    ],
    [
      [{ stockItemId: 1, stockItemName: "Invalid", sourceLocationId: 2, originalQuantity: -1, newQuantity: 2 }],
      /original quantity/i,
    ],
  ])("rejects an invalid pending snapshot %#", (items, message) => {
    expect(() => normalizePendingRevisionItems(items)).toThrow(message);
  });

  it("rejects a merged revision item that lost its source-location ownership", () => {
    expect(() =>
      mergePendingRevisionTargets(
        [{ id: 7, revisionNumber: 1 }],
        [
          {
            revisionId: 7,
            stockItemId: 10,
            sourceLocationId: null,
            originalQuantity: "10",
            newQuantity: "12",
          },
        ]
      )
    ).toThrow(/missing its source location/i);
  });
});
