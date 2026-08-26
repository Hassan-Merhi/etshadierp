import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function privilegedError(message: string, code: string, details: Record<string, unknown> = {}) {
  return { message, code, ...details };
}

function privilegedRateLimit(max: number, code: string, message: string): RequestHandler {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      return res.status(429).json(privilegedError(message, code));
    },
  });
}

/** Read-only privileged diagnostics and previews. */
export const privilegedReadRateLimit = privilegedRateLimit(
  120,
  "PRIVILEGED_READ_RATE_LIMITED",
  "Too many privileged read requests. Try again later."
);

/** Baseline protection applied across the staged privileged migration namespace. */
export const privilegedMigrationRateLimit = privilegedRateLimit(
  120,
  "PRIVILEGED_MIGRATION_RATE_LIMITED",
  "Too many privileged migration requests. Try again later."
);

/**
 * Privileged imports, bulk writes, repair applies, and migration steps.
 *
 * Keep this as a direct express-rate-limit construction instead of routing it
 * through privilegedRateLimit(). CodeQL models express-rate-limit directly and
 * can therefore prove that sensitive route handlers using this exported
 * middleware are rate-limited, while the runtime policy remains identical to
 * the other privileged limiters.
 */
export const privilegedMutationRateLimit = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    return res.status(429).json(
      privilegedError(
        "Too many privileged mutation requests. Try again later.",
        "PRIVILEGED_MUTATION_RATE_LIMITED"
      )
    );
  },
});

/** Destructive rollback/rebuild-style operations. */
export const privilegedDestructiveRateLimit = privilegedRateLimit(
  8,
  "PRIVILEGED_DESTRUCTIVE_RATE_LIMITED",
  "Too many destructive privileged requests. Try again later."
);

export interface PrivilegedRequestBudgetOptions {
  maxBodyBytes?: number;
  maxCollectionItems?: number;
}

function getRequestBodyBytes(req: Request): number {
  const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody.byteLength;
  if (typeof rawBody === "string") return Buffer.byteLength(rawBody);

  const contentLength = req.get("content-length");
  if (!contentLength) return 0;
  const parsed = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function findOversizedCollection(value: unknown, maxItems: number, path = "body", depth = 0): string | null {
  if (depth > 4 || value == null) return null;

  if (Array.isArray(value)) {
    if (value.length > maxItems) return path;
    return null;
  }

  if (typeof value !== "object") return null;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (Array.isArray(child)) {
      if (child.length > maxItems) return childPath;
      continue;
    }
    const nested = findOversizedCollection(child, maxItems, childPath, depth + 1);
    if (nested) return nested;
  }

  return null;
}

/**
 * Adds a stricter request budget to privileged endpoints than the application's
 * global JSON parser. This prevents a valid privileged session from turning a
 * bulk/import endpoint into an unbounded memory or database work amplifier.
 */
export function privilegedRequestBudget(options: PrivilegedRequestBudgetOptions = {}): RequestHandler {
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const maxCollectionItems = options.maxCollectionItems ?? 2_000;

  return (req: Request, res: Response, next: NextFunction) => {
    const bodyBytes = getRequestBodyBytes(req);
    if (bodyBytes > maxBodyBytes) {
      return res.status(413).json(
        privilegedError("Privileged request body is too large.", "PRIVILEGED_BODY_TOO_LARGE", {
          maxBodyBytes,
        })
      );
    }

    const oversizedCollection = findOversizedCollection(req.body, maxCollectionItems);
    if (oversizedCollection) {
      return res.status(413).json(
        privilegedError("Privileged request contains too many items.", "PRIVILEGED_COLLECTION_TOO_LARGE", {
          field: oversizedCollection,
          maxCollectionItems,
        })
      );
    }

    next();
  };
}

export interface PrivilegedConcurrencyOptions {
  maxConcurrent?: number;
  scope: string;
}

const privilegedInFlight = new Map<string, number>();

/**
 * Per-process overlap guard for expensive privileged work. Rate limiting caps
 * frequency; this separately prevents the same actor from launching overlapping
 * repair/import/migration jobs that can contend on the same data.
 */
export function privilegedConcurrencyLimit(options: PrivilegedConcurrencyOptions): RequestHandler {
  const maxConcurrent = options.maxConcurrent ?? 1;

  return (req: Request, res: Response, next: NextFunction) => {
    const sessionUserId = (req.session as unknown as { userId?: string | number } | undefined)?.userId;
    const actor = String(sessionUserId ?? req.ip ?? "unknown");
    const key = `${options.scope}:${actor}`;
    const current = privilegedInFlight.get(key) ?? 0;

    if (current >= maxConcurrent) {
      return res
        .status(429)
        .json(
          privilegedError(
            "A privileged operation is already in progress for this user.",
            "PRIVILEGED_OPERATION_IN_PROGRESS"
          )
        );
    }

    privilegedInFlight.set(key, current + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = (privilegedInFlight.get(key) ?? 1) - 1;
      if (remaining <= 0) privilegedInFlight.delete(key);
      else privilegedInFlight.set(key, remaining);
    };

    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
