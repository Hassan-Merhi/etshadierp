import { describe, expect, it } from "vitest";
import {
  applyReceiptAdjustmentAmbiguityBlocks,
  findReceiptAdjustmentAmbiguitySupplierIds,
} from "../server/services/factory/historical-replay/timelineAmbiguityV6";

describe("Historical Replay receipt-adjustment chronology", () => {
  it("queries receipt and adjustment timestamps through the supplied executor", async () => {
    let sql = "";
    const executor: any = {
      query: async (query: string, params?: any[]) => {
        sql = query;
        expect(params).toEqual([7]);
        return { rows: [{ supplier_id: 4 }, { supplier_id: 2 }, { supplier_id: 4 }] };
      },
    };
    await expect(findReceiptAdjustmentAmbiguitySupplierIds(executor, 7)).resolves.toEqual([2, 4]);
    expect(sql).toContain("factory_container_receipts");
    expect(sql).toContain("factory_raw_material_adjustments");
    expect(sql).toContain("re.event_created_at = a.created_at");
  });

  it("marks affected suppliers unsafe instead of accepting arbitrary same-day order", () => {
    const preview: any = {
      summary: { ambiguousEventOrdering: 0, safeSuppliers: 2, manualReviewSuppliers: 0 },
      supplierRows: [
        { supplierId: 1, safeToRepair: true, reasons: [] as string[] },
        { supplierId: 2, safeToRepair: true, reasons: [] as string[] },
      ],
    };
    const blocked = applyReceiptAdjustmentAmbiguityBlocks(preview, [2]);
    expect(blocked.supplierRows[0].safeToRepair).toBe(true);
    expect(blocked.supplierRows[1].safeToRepair).toBe(false);
    expect(blocked.supplierRows[1].reasons).toContain("TIMELINE_ORDER_AMBIGUOUS");
    expect(blocked.summary.safeSuppliers).toBe(1);
    expect(blocked.summary.manualReviewSuppliers).toBe(1);
    expect(blocked.summary.ambiguousEventOrdering).toBe(1);
  });
});
