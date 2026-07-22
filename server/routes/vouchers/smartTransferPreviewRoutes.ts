import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requireNonPOS } from "../../auth";
import { buildSmartTransferPreview } from "../../services/smartTransferAllocation";

const smartTransferPreviewSchema = z.object({
  destinationLocationId: z.coerce.number().int().positive(),
  sourceLocationIds: z.array(z.coerce.number().int().positive()).min(1).max(30),
  targetQuantity: z.coerce.number().int().positive().max(1_000_000),
  includeOtw: z.boolean().optional().default(true),
  stockGroupIds: z.array(z.coerce.number().int().positive()).max(100).optional().default([]),
  categoryIds: z.array(z.coerce.number().int().positive()).max(100).optional().default([]),
  minimumSourceReserve: z.coerce.number().int().nonnegative().max(100_000).optional().default(0),
  targetCoverageDays: z.coerce.number().int().min(1).max(180).optional().default(21),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "asOfDate must use YYYY-MM-DD")
    .optional(),
});

export type SmartTransferPreviewRequest = z.infer<typeof smartTransferPreviewSchema>;

export function registerSmartTransferPreviewRoutes(app: Express) {
  /**
   * Read-only preview endpoint. It does not create a voucher, reserve stock,
   * move inventory or post accounting entries.
   */
  app.post("/api/stock-transfers/smart-preview", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = smartTransferPreviewSchema.parse(req.body);
      const preview = await buildSmartTransferPreview(
        companyId,
        parsed.sourceLocationIds,
        parsed.destinationLocationId,
        parsed.targetQuantity,
        {
          asOfDate: parsed.asOfDate,
          includeOtw: parsed.includeOtw,
          stockGroupIds: parsed.stockGroupIds,
          categoryIds: parsed.categoryIds,
          minimumSourceReserve: parsed.minimumSourceReserve,
          targetCoverageDays: parsed.targetCoverageDays,
        }
      );

      res.set("Cache-Control", "no-store");
      return res.json(preview);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid smart transfer preview request",
          errors: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      const message = String(error?.message || "");
      const isInputError =
        /valid company|required|positive whole number|source location|destination location|YYYY-MM-DD|not found/i.test(message);
      if (isInputError) return res.status(400).json({ message });

      console.error("[SmartTransferPreview] Failed:", error);
      return res.status(500).json({ message: "Failed to generate smart transfer preview" });
    }
  });
}
