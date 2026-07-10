import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { parseId } from "../../lib/parseId";
import { eq, desc, and } from "drizzle-orm";
import {
  factoryContainers,
  factoryContainerTrackingEvents,
  factoryContainerTrackingChecks,
} from "../../../shared/schema";
import {
  trackOneFactoryContainerById,
  getFactoryTrackingProgress,
  updateFactoryContainerTrackingSettings,
} from "../../services/factoryContainerTrackingService";

export function registerFactoryContainerTrackingRoutes(app: Express) {
  // GET /api/factory/container-tracking/:id/events — tracking event history
  app.get("/api/factory/container-tracking/:id/events", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid container id" });

      // Verify container belongs to the user's factory company
      const [container] = await db
        .select({ id: factoryContainers.id, companyId: factoryContainers.companyId })
        .from(factoryContainers)
        .where(eq(factoryContainers.id, containerId))
        .limit(1);

      if (!container) return res.status(404).json({ message: "Container not found" });

      const events = await db
        .select()
        .from(factoryContainerTrackingEvents)
        .where(eq(factoryContainerTrackingEvents.containerId, containerId))
        .orderBy(desc(factoryContainerTrackingEvents.eventTime));

      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch tracking events" });
    }
  });

  // GET /api/factory/container-tracking/:id/checks — tracking check history
  app.get("/api/factory/container-tracking/:id/checks", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid container id" });

      const [container] = await db
        .select({ id: factoryContainers.id })
        .from(factoryContainers)
        .where(eq(factoryContainers.id, containerId))
        .limit(1);

      if (!container) return res.status(404).json({ message: "Container not found" });

      const checks = await db
        .select({
          id: factoryContainerTrackingChecks.id,
          provider: factoryContainerTrackingChecks.provider,
          status: factoryContainerTrackingChecks.status,
          checkedAt: factoryContainerTrackingChecks.checkedAt,
          errorMessage: factoryContainerTrackingChecks.errorMessage,
        })
        .from(factoryContainerTrackingChecks)
        .where(eq(factoryContainerTrackingChecks.containerId, containerId))
        .orderBy(desc(factoryContainerTrackingChecks.checkedAt))
        .limit(50);

      res.json(checks);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch tracking checks" });
    }
  });

  // GET /api/factory/container-tracking/:id/progress — live tracking progress (SSE or polling)
  app.get("/api/factory/container-tracking/:id/progress", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid container id" });
      const steps = getFactoryTrackingProgress(containerId);
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch tracking progress" });
    }
  });

  // POST /api/factory/container-tracking/:id/track-now — manually trigger tracking
  app.post("/api/factory/container-tracking/:id/track-now", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid container id" });

      const [container] = await db
        .select({ id: factoryContainers.id, companyId: factoryContainers.companyId })
        .from(factoryContainers)
        .where(eq(factoryContainers.id, containerId))
        .limit(1);

      if (!container) return res.status(404).json({ message: "Container not found" });

      // Fire tracking in background so we never block the HTTP response
      trackOneFactoryContainerById(containerId).catch((err: any) => {
        console.error(`[FactoryTracking] Background track error for container ${containerId}:`, err?.message);
      });

      res.json({ success: true, queued: true, containerId });
    } catch (err: any) {
      const status = err.message?.includes("not found")
        ? 404
        : err.message?.includes("disabled")
          ? 400
          : err.message?.includes("quota")
            ? 429
            : 500;
      res.status(status).json({ message: err.message || "Tracking failed" });
    }
  });

  // PATCH /api/factory/container-tracking/:id/settings — enable/disable tracking
  app.patch("/api/factory/container-tracking/:id/settings", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid container id" });
      const { trackingEnabled, trackingAutoUpdate, trackingCarrierHint } = req.body as {
        trackingEnabled?: boolean;
        trackingAutoUpdate?: boolean;
        trackingCarrierHint?: string | null;
      };

      const [container] = await db
        .select({ id: factoryContainers.id })
        .from(factoryContainers)
        .where(eq(factoryContainers.id, containerId))
        .limit(1);

      if (!container) return res.status(404).json({ message: "Container not found" });

      await updateFactoryContainerTrackingSettings(containerId, {
        trackingEnabled,
        trackingAutoUpdate,
        trackingCarrierHint,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to update tracking settings" });
    }
  });
}
