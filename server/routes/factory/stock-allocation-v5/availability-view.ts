import type { Express, Request, Response } from "express";

const STOCK_ALLOCATION_PATH = "/api/factory/v5/stock-allocation";
export const V5_ALLOCATION_AVAILABILITY_VIEW = "availability";

type AllocationAvailabilityRow = {
  articleCode: unknown;
  freeToPromise: unknown;
};

/**
 * Project the canonical V5 allocation response down to the only two fields
 * Customer Loading needs. The canonical handler still performs all business
 * calculations, filters, auth and company scoping; this function changes only
 * what is serialized over the wire.
 */
export function projectV5AllocationAvailabilityPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;

  const rows = (payload as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return payload;

  return {
    rows: rows.map((row): AllocationAvailabilityRow => {
      const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        articleCode: source.articleCode,
        freeToPromise: source.freeToPromise,
      };
    }),
  };
}

/**
 * Installs a response-only view for GET /api/factory/v5/stock-allocation.
 *
 * Using middleware instead of a second business endpoint prevents the compact
 * response from drifting from the authoritative free-to-promise formula.
 * The existing authenticated allocation route still handles the request.
 */
export function registerV5AllocationAvailabilityView(app: Express): void {
  app.use(STOCK_ALLOCATION_PATH, (req: Request, res: Response, next) => {
    if (req.method !== "GET" || req.path !== "/" || req.query.view !== V5_ALLOCATION_AVAILABILITY_VIEW) {
      next();
      return;
    }

    const originalJson = res.json;
    res.json = ((body: unknown) => {
      res.json = originalJson;
      return originalJson.call(res, projectV5AllocationAvailabilityPayload(body));
    }) as typeof res.json;

    next();
  });
}
