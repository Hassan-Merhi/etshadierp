import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { spContainers } from "@shared/schema";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { requireSpCompany } from "./spHelpers";

export function registerSpLifecycleGuards(app: Express) {
  app.patch("/api/sp/containers/:id", requireAuth, async (req: any, res: any, next: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const containerId = Number(req.params.id);
      if (!Number.isInteger(containerId) || containerId <= 0) {
        return res.status(400).json({ message: "Invalid Supplier Partner container ID" });
      }

      const [container] = await db
        .select({ status: spContainers.status })
        .from(spContainers)
        .where(and(eq(spContainers.id, containerId), eq(spContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Supplier Partner container not found" });
      if (container.status !== "open") {
        return res.status(409).json({
          code: "SP_CONTAINER_NOT_EDITABLE",
          message: `Only open Supplier Partner containers can be edited. Current status: ${container.status}.`,
        });
      }

      next();
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
