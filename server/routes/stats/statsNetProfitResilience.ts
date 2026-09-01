import type { Express, RequestHandler, Response } from "express";
import { logger } from "../../lib/logger";

const FRESH_TTL_MS = 30_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 250;
const MAX_ACTIVE_CALCULATIONS = 1;

type FinancialPayload = Record<string, unknown> & {
  totalIncome: number;
  netPosition: number;
};

type CachedFinancialPayload = {
  payload: FinancialPayload;
  storedAt: number;
};

const lastGoodFinancialPayloads = new Map<string, CachedFinancialPayload>();
const inFlightCalculations = new Map<string, Promise<FinancialPayload>>();

let activeCalculations = 0;
const calculationWaiters: Array<(release: () => void) => void> = [];

function makeRelease(): () => void {
  let released = false;

  return () => {
    if (released) return;
    released = true;

    const next = calculationWaiters.shift();
    if (next) {
      // Transfer the occupied slot directly to the next waiter. Keeping the
      // active count unchanged prevents a race where a third request jumps in.
      next(makeRelease());
      return;
    }

    activeCalculations = Math.max(0, activeCalculations - 1);
  };
}

function acquireCalculationSlot(): Promise<() => void> {
  if (activeCalculations < MAX_ACTIVE_CALCULATIONS) {
    activeCalculations += 1;
    return Promise.resolve(makeRelease());
  }

  return new Promise((resolve) => calculationWaiters.push(resolve));
}

function isFinancialPayload(value: unknown): value is FinancialPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Number.isFinite(Number(candidate.totalIncome)) && Number.isFinite(Number(candidate.netPosition));
}

function buildCacheKey(req: Parameters<RequestHandler>[0]): string | null {
  const companyId = req.session.currentCompanyId;
  if (!companyId) return null;

  const toDate = typeof req.query.toDate === "string" ? req.query.toDate : "";
  return `net-profit:${companyId}:${toDate}`;
}

function getCached(key: string, maxAgeMs: number): CachedFinancialPayload | null {
  const cached = lastGoodFinancialPayloads.get(key);
  if (!cached) return null;
  if (Date.now() - cached.storedAt > maxAgeMs) return null;
  return cached;
}

function rememberSuccessfulPayload(key: string, payload: FinancialPayload): void {
  lastGoodFinancialPayloads.set(key, { payload, storedAt: Date.now() });

  if (lastGoodFinancialPayloads.size <= MAX_CACHE_ENTRIES) return;

  const oldest = [...lastGoodFinancialPayloads.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
  if (oldest) lastGoodFinancialPayloads.delete(oldest[0]);
}

function setFinancialResponseHeaders(res: Response, status: "live" | "cached" | "stale"): void {
  res.setHeader("Cache-Control", "private, max-age=15, stale-if-error=86400");
  res.setHeader("X-Financial-Data-Status", status);
}

function sendCachedPayload(res: Response, cached: CachedFinancialPayload, status: "cached" | "stale"): Response {
  setFinancialResponseHeaders(res, status);
  res.status(200);

  if (status === "cached") return res.json(cached.payload);

  return res.json({
    ...cached.payload,
    _dashboardData: {
      status: "stale",
      lastSuccessfulAt: new Date(cached.storedAt).toISOString(),
      staleAgeSeconds: Math.max(0, Math.round((Date.now() - cached.storedAt) / 1000)),
    },
  });
}

function createDeferredCalculation(): {
  promise: Promise<FinancialPayload>;
  resolve: (payload: FinancialPayload) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (payload: FinancialPayload) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<FinancialPayload>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  // The first request may have no followers awaiting this promise. Attach a
  // handler immediately so a downstream 500 never becomes an unhandled rejection.
  void promise.catch(() => undefined);

  return { promise, resolve, reject };
}

const netProfitResilienceMiddleware: RequestHandler = async (req, res, next) => {
  const cacheKey = buildCacheKey(req);
  if (!cacheKey) {
    next();
    return;
  }

  const fresh = getCached(cacheKey, FRESH_TTL_MS);
  if (fresh) {
    sendCachedPayload(res, fresh, "cached");
    return;
  }

  const existingCalculation = inFlightCalculations.get(cacheKey);
  if (existingCalculation) {
    try {
      const payload = await existingCalculation;
      const cached = getCached(cacheKey, STALE_TTL_MS) ?? { payload, storedAt: Date.now() };
      sendCachedPayload(res, cached, "cached");
      return;
    } catch {
      const stale = getCached(cacheKey, STALE_TTL_MS);
      if (stale) {
        sendCachedPayload(res, stale, "stale");
        return;
      }
      // The leading request failed without a last-known-good result. Continue
      // into the real handler once more rather than returning fabricated zeros.
    }
  }

  const releaseSlot = await acquireCalculationSlot();

  // A queued request may have waited while another company calculation filled
  // this key. Re-check before touching the database.
  const freshAfterQueue = getCached(cacheKey, FRESH_TTL_MS);
  if (freshAfterQueue) {
    releaseSlot();
    sendCachedPayload(res, freshAfterQueue, "cached");
    return;
  }

  const calculationAfterQueue = inFlightCalculations.get(cacheKey);
  if (calculationAfterQueue) {
    releaseSlot();
    try {
      const payload = await calculationAfterQueue;
      const cached = getCached(cacheKey, STALE_TTL_MS) ?? { payload, storedAt: Date.now() };
      sendCachedPayload(res, cached, "cached");
      return;
    } catch {
      const stale = getCached(cacheKey, STALE_TTL_MS);
      if (stale) {
        sendCachedPayload(res, stale, "stale");
        return;
      }
    }
  }

  const deferred = createDeferredCalculation();
  inFlightCalculations.set(cacheKey, deferred.promise);

  const originalJson = res.json.bind(res);
  let settled = false;

  const settle = (outcome: "success" | "failure", payload?: FinancialPayload): void => {
    if (settled) return;
    settled = true;
    inFlightCalculations.delete(cacheKey);
    releaseSlot();

    if (outcome === "success" && payload) deferred.resolve(payload);
    else deferred.reject(new Error("Net-profit calculation failed"));
  };

  res.json = ((body: unknown) => {
    const downstreamStatus = res.statusCode;

    if (downstreamStatus >= 200 && downstreamStatus < 300 && isFinancialPayload(body)) {
      rememberSuccessfulPayload(cacheKey, body);
      setFinancialResponseHeaders(res, "live");
      settle("success", body);
      return originalJson(body);
    }

    if (downstreamStatus >= 500) {
      const stale = getCached(cacheKey, STALE_TTL_MS);
      if (stale) {
        logger.error("[/api/stats/net-profit] Live calculation failed; serving last-known-good dashboard figures", {
          companyId: req.session.currentCompanyId,
          toDate: typeof req.query.toDate === "string" ? req.query.toDate : null,
          downstreamStatus,
          staleAgeSeconds: Math.round((Date.now() - stale.storedAt) / 1000),
          downstreamBody: body,
        });

        settle("success", stale.payload);
        setFinancialResponseHeaders(res, "stale");
        res.statusCode = 200;
        return originalJson({
          ...stale.payload,
          _dashboardData: {
            status: "stale",
            lastSuccessfulAt: new Date(stale.storedAt).toISOString(),
            staleAgeSeconds: Math.max(0, Math.round((Date.now() - stale.storedAt) / 1000)),
          },
        });
      }
    }

    settle("failure");
    return originalJson(body);
  }) as Response["json"];

  res.once("close", () => {
    if (!settled) settle("failure");
  });

  try {
    next();
  } catch (error: unknown) {
    settle("failure");
    next(error);
  }
};

export function registerStatsNetProfitResilience(app: Express): void {
  // Registered immediately before the existing route. It does not replace the
  // accounting calculation; it limits duplicate/concurrent work and only steps
  // in when a transient failure would otherwise blank the dashboard.
  app.get("/api/stats/net-profit", netProfitResilienceMiddleware);
}
