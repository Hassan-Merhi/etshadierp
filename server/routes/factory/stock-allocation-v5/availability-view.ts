import type { Express, Request, Response } from "express";

const STOCK_ALLOCATION_PATH = "/api/factory/v5/stock-allocation";
export const V5_ALLOCATION_AVAILABILITY_VIEW = "availability";

type AllocationAvailabilityRow = {
  articleCode: unknown;
  freeToPromise: unknown;
};

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
