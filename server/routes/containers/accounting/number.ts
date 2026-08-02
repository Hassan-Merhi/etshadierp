/**
 * containerAccountingRoutes: ContainerNumber endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth, requireNonPOS } from "../../../auth";
import { containers } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export function registerContainerNumberRoutes(app: Express) {
  app.patch("/api/containers/:id/number", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid container ID" });
      const { containerNumber } = req.body;
      if (!containerNumber || !String(containerNumber).trim()) {
        return res.status(400).json({ message: "Container number is required" });
      }
      const newNumber = String(containerNumber).trim().toUpperCase();
      const [existing] = await db
        .select({ id: containers.id })
        .from(containers)
        .where(and(eq(containers.companyId, companyId), eq(containers.containerNumber, newNumber)))
        .limit(1);
      if (existing && existing.id !== id) {
        return res.status(409).json({ message: `Container number "${newNumber}" is already in use` });
      }
      // Capture old number before updating so we can rewrite voucher descriptions
      const [currentRow] = await db
        .select({ containerNumber: containers.containerNumber })
        .from(containers)
        .where(and(eq(containers.id, id), eq(containers.companyId, companyId)))
        .limit(1);
      const oldNumber = currentRow?.containerNumber;

      const [updated] = await db
        .update(containers)
        .set({ containerNumber: newNumber })
        .where(and(eq(containers.id, id), eq(containers.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Container not found" });

      // ── Rewrite all voucher descriptions and narrations that mention the old container number ──
      // This ensures the supplier ledger regex picks up the new number and builds correct links.
      if (oldNumber && oldNumber !== newNumber) {
        try {
          await db.execute(
            sql`UPDATE vouchers SET description = REPLACE(description, ${oldNumber}, ${newNumber}) WHERE description LIKE ${"%" + oldNumber + "%"}`
          );
          await db.execute(
            sql`UPDATE voucher_entries SET narration = REPLACE(narration, ${oldNumber}, ${newNumber}) WHERE narration LIKE ${"%" + oldNumber + "%"}`
          );
        } catch (syncErr) {
          logger.error("[container number sync] Error updating voucher descriptions:", { error: syncErr });
        }
      }

      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
