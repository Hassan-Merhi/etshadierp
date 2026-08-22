/**
 * Route manifest extraction.
 * -------------------------
 * Walks a configured Express application and produces a deterministic,
 * order-preserving description of every registered route and every mounted
 * middleware path.
 *
 * This exists to make file splits provably behaviour-preserving. Moving a
 * handler from a 3,000-line route module into a focused module is only safe if
 * three things survive the move:
 *
 *   1. the route still exists (method + path),
 *   2. its guard chain is unchanged (a dropped `requireAuth` is a silent
 *      authorization hole that no type-check or lint rule would catch),
 *   3. its registration order is unchanged (Express resolves first-match, so
 *      reordering silently changes which handler wins for overlapping paths
 *      such as `/api/factory/bales/daily-summary` vs `/api/factory/bales/:id`).
 *
 * The manifest captures all three, so a split that preserves behaviour produces
 * a byte-identical manifest and a split that does not fails loudly.
 */
import type { Express } from "express";

export interface RouteEntry {
  /** Uppercase HTTP method, e.g. `GET`. */
  method: string;
  /** Registered path string exactly as Express recorded it. */
  path: string;
  /**
   * Ordered handler chain by function name. Anonymous handlers (inline arrow
   * functions) are recorded as `<anonymous>`; named middleware such as
   * `requireAuth` keeps its identifier, which is what makes a dropped guard
   * visible in the diff.
   */
  guards: string[];
}

export interface MiddlewareMount {
  /** Mount path recovered from the layer, or the raw pattern when ambiguous. */
  path: string;
  /** Middleware function name, or `<anonymous>`. */
  name: string;
}

export interface RouteManifest {
  routes: RouteEntry[];
  middlewareMounts: MiddlewareMount[];
}

/** Express layers expose no public type; these are the fields we rely on. */
interface ExpressLayer {
  name?: string;
  regexp?: RegExp & { fast_slash?: boolean };
  handle?: { name?: string };
  route?: {
    path?: unknown;
    methods?: Record<string, boolean>;
    /**
     * A route's stack holds the handlers for *every* method registered on that
     * path. Each layer carries the method it belongs to; `undefined` means the
     * handler applies to all methods (as produced by `route.all()`).
     */
    stack?: Array<{ name?: string; method?: string; handle?: { name?: string } }>;
  };
}

const ANONYMOUS = "<anonymous>";

/**
 * Middleware that Express itself installs, or that merely wraps the app. These
 * are not part of the application's routing contract and would otherwise add
 * churn to the manifest.
 */
const IGNORED_MIDDLEWARE = new Set(["query", "expressInit", "router", "bound dispatch"]);

function handlerName(candidate: { name?: string; handle?: { name?: string } } | undefined): string {
  const name = candidate?.name || candidate?.handle?.name;
  if (!name || name === "<anonymous>") return ANONYMOUS;
  // Express prefixes bound handlers; the underlying identity is what matters.
  return name.startsWith("bound ") ? name.slice("bound ".length) : name;
}

/**
 * Recover the original `app.use()` mount path from the compiled layer regexp.
 *
 * Express 4 does not retain the source path for `use()` mounts, so it is
 * reconstructed from the generated pattern. Literal mounts — which is all this
 * codebase uses — round-trip exactly. Anything containing pattern syntax after
 * unescaping is reported as its raw source instead of a misleading path, which
 * keeps the manifest deterministic without pretending to a precision the
 * decode cannot deliver.
 */
export function decodeMountPath(regexp: (RegExp & { fast_slash?: boolean }) | undefined): string {
  if (!regexp) return "/";
  if (regexp.fast_slash) return "/";

  const decoded = regexp.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\/\?\$$/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/");

  // If pattern syntax survived the unescape, the decode is not trustworthy.
  if (/[\\^$*+?()[\]{}|]/.test(decoded)) return `re:${regexp.source}`;
  return decoded === "" ? "/" : decoded;
}

/**
 * Extract the ordered route manifest from a fully configured Express app.
 *
 * Registration order is preserved deliberately — it is part of the behaviour
 * being protected, not an incidental detail.
 */
export function extractRouteManifest(app: Express): RouteManifest {
  const expressApp = app as unknown as {
    _router?: { stack?: ExpressLayer[] };
    router?: { stack?: ExpressLayer[] };
  };
  // Express 4 stores the configured router on the private `_router` field.
  // Express 5 removed that field and exposes the router through `app.router`.
  // Prefer the Express 4 field so this helper remains compatible with both
  // versions without touching Express 4's deprecated `app.router` getter.
  const stack = expressApp._router?.stack ?? expressApp.router?.stack;
  if (!stack) {
    throw new Error("Express router stack unavailable - the app was not configured before manifest extraction.");
  }

  const routes: RouteEntry[] = [];
  const middlewareMounts: MiddlewareMount[] = [];

  for (const layer of stack) {
    if (layer.route) {
      const rawPath = layer.route.path;
      // Express supports string arrays for one handler registered at multiple
      // paths. Expand them in declared order so the manifest stays stable and
      // each concrete route remains independently diffable.
      const paths = (Array.isArray(rawPath) ? rawPath : [rawPath]).map((path) => {
        if (typeof path !== "string") {
          throw new Error(`Unsupported non-string route path: ${String(path)}`);
        }
        return path;
      });

      const routeStack = layer.route.stack ?? [];
      // Sorted so a multi-method registration cannot reorder between runs.
      const methods = Object.keys(layer.route.methods ?? {})
        .filter((method) => layer.route?.methods?.[method])
        .map((method) => method.toUpperCase())
        .sort();

      for (const path of paths) {
        for (const method of methods) {
          // Select only the handlers that actually run for this method. Without
          // this filter an `app.all()` registration reports every method's chain
          // on every method, which is both wrong and unreadable.
          const guards = routeStack
            .filter((handlerLayer) => handlerLayer.method === undefined || handlerLayer.method.toUpperCase() === method)
            .map(handlerName);

          routes.push({ method, path, guards });
        }
      }
      continue;
    }

    const name = handlerName(layer.handle ?? { name: layer.name });
    if (IGNORED_MIDDLEWARE.has(name) || IGNORED_MIDDLEWARE.has(layer.name ?? "")) continue;

    middlewareMounts.push({ path: decodeMountPath(layer.regexp), name });
  }

  return { routes, middlewareMounts };
}

/** Stable one-line rendering of a route, used for readable diffs. */
export function formatRoute(entry: RouteEntry): string {
  return `${entry.method} ${entry.path} [${entry.guards.join(" > ")}]`;
}

/** Stable one-line rendering of a middleware mount. */
export function formatMount(mount: MiddlewareMount): string {
  return `USE ${mount.path} [${mount.name}]`;
}

export interface SerializedRouteManifest {
  /**
   * Bumped only when the manifest *format* changes, so a stale snapshot fails
   * with a clear reason instead of a confusing content diff.
   */
  formatVersion: number;
  description: string;
  routeCount: number;
  middlewareMountCount: number;
  routes: string[];
  middlewareMounts: string[];
}

export const ROUTE_MANIFEST_FORMAT_VERSION = 1;

export function serializeRouteManifest(manifest: RouteManifest): SerializedRouteManifest {
  return {
    formatVersion: ROUTE_MANIFEST_FORMAT_VERSION,
    description:
      "Ordered snapshot of every registered Express route (method, path, guard chain) and " +
      "middleware mount. Regenerate with UPDATE_ROUTE_MANIFEST=1 only when a route change is " +
      "intended; during a file split the manifest must not change at all.",
    routeCount: manifest.routes.length,
    middlewareMountCount: manifest.middlewareMounts.length,
    routes: manifest.routes.map(formatRoute),
    middlewareMounts: manifest.middlewareMounts.map(formatMount),
  };
}

export interface ManifestDiff {
  added: string[];
  removed: string[];
  reordered: boolean;
}

/**
 * Compare two rendered manifests, separating membership changes from ordering
 * changes. A split that loses a route and a split that merely reshuffles two
 * registrations are very different failures and deserve different messages.
 */
export function diffManifestEntries(expected: string[], actual: string[]): ManifestDiff {
  const expectedCounts = new Map<string, number>();
  for (const entry of expected) {
    expectedCounts.set(entry, (expectedCounts.get(entry) ?? 0) + 1);
  }

  const added: string[] = [];
  for (const entry of actual) {
    const remaining = expectedCounts.get(entry) ?? 0;
    if (remaining > 0) expectedCounts.set(entry, remaining - 1);
    else added.push(entry);
  }

  const removed: string[] = [];
  for (const [entry, count] of expectedCounts) {
    for (let index = 0; index < count; index += 1) removed.push(entry);
  }

  const sameMembership = added.length === 0 && removed.length === 0;
  const reordered = sameMembership && expected.some((entry, index) => entry !== actual[index]);

  return { added, removed, reordered };
}
