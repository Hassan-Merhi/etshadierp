import type { Express } from "express";
import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { stockTransferRevisions } from "@shared/schema";

export function registerPosTransferListMetaRoutes(app: Express) {
  app.get("/api/stock-transfers/revision-meta", requireAuth, async (req, res) => {
    try {
      const rawIds = String(req.query.transferIds ?? "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      const transferIds = [...new Set(rawIds)].slice(0, 250);
      if (transferIds.length === 0) return res.json({});

      const revisions = await db
        .select({
          transferId: stockTransferRevisions.transferId,
          revisionNumber: stockTransferRevisions.revisionNumber,
          revisionDate: stockTransferRevisions.revisionDate,
          optional: stockTransferRevisions.optional,
        })
        .from(stockTransferRevisions)
        .where(inArray(stockTransferRevisions.transferId, transferIds));

      const result: Record<number, {
        revisionCount: number;
        pendingRevisionCount: number;
        latestRevisionNumber: number | null;
        latestRevisionDate: Date | null;
      }> = {};

      for (const transferId of transferIds) {
        result[transferId] = {
          revisionCount: 0,
          pendingRevisionCount: 0,
          latestRevisionNumber: null,
          latestRevisionDate: null,
        };
      }

      for (const revision of revisions) {
        const current = result[revision.transferId];
        current.revisionCount += 1;
        if (revision.optional) current.pendingRevisionCount += 1;
        if (current.latestRevisionNumber === null || revision.revisionNumber > current.latestRevisionNumber) {
          current.latestRevisionNumber = revision.revisionNumber;
          current.latestRevisionDate = revision.revisionDate;
        }
      }

      return res.json(result);
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
