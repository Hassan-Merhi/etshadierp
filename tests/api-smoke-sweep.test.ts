/**
 * API smoke sweep.
 * ---------------
 * Companion to `api-smoke.test.ts`, which hand-checks response *contracts* for
 * ~30 important endpoints. This file instead checks *liveness* across the whole
 * read surface: every parameterless `GET /api/...` route in the committed route
 * manifest is called once as an authenticated admin and must not return 5xx.
 *
 * Why this exists alongside the route manifest:
 *
 *   - The manifest proves a route is still *registered* after a file split. It
 *     cannot prove the handler still *works* — a helper that moved without
 *     being re-exported, or a circular import that resolves to `undefined` at
 *     call time, registers fine and throws only when the handler executes.
 *   - This sweep executes them, so that class of split damage surfaces
 *     immediately instead of in production.
 *
 * Endpoints that legitimately fail without richer seed data are recorded in
 * `config/api-smoke-baseline.json`. That list is a ratchet: entries may be
 * removed as endpoints are fixed or seeding improves, but adding to it means
 * accepting a known-broken endpoint and requires review.
 */
import fs from "node:fs";
import path from "node:path";

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import type { SerializedRouteManifest } from "./helpers/routeManifest";

const TEST_PREFIX = "sweeptest";
const MANIFEST_PATH = path.join(process.cwd(), "config/route-manifest.json");
const BASELINE_PATH = path.join(process.cwd(), "config/api-smoke-baseline.json");
const shouldUpdateBaseline = process.env.UPDATE_API_SMOKE_BASELINE === "1";

/**
 * Per-request deadline. Generous enough for the slowest legitimate read on a
 * cold cache, short enough that a hung handler fails the run quickly.
 */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Routes excluded from the sweep. These are skipped because *calling* them is
 * unsafe or wasteful in a test run, not because they are allowed to be broken:
 *
 *   - mutating or long-running maintenance operations,
 *   - file/report generation, which is slow and produces binary payloads,
 *   - debug endpoints, which exist to introspect a running system.
 *
 * Anything excluded here is not protected by this sweep, so keep the list
 * narrow and prefer the baseline for merely-failing endpoints.
 */
const EXCLUDED_PATTERNS: RegExp[] = [
  /(^|\/)(debug)(\/|$)/i,
  /(repair|recalc|migration|migrate|cutover|backup|restore|reset|seed|rebuild|purge)/i,
  /(^|\/)(run|apply|execute|trigger|sync)(\/|$)/i,
  /(export|download|template)/i,
  /\.(xlsx|pdf|csv|zip)$/i,
];

interface SweepFailure {
  route: string;
  status: number;
  detail: string;
}

function loadManifest(): SerializedRouteManifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as SerializedRouteManifest;
}

/** Parameterless GET /api routes, in manifest order, deduplicated. */
export function selectSweepablePaths(manifest: SerializedRouteManifest): string[] {
  const seen = new Set<string>();
  const selected: string[] = [];

  for (const entry of manifest.routes) {
    const [method, routePath] = entry.split(" ");
    if (method !== "GET") continue;
    if (!routePath?.startsWith("/api/")) continue;
    // Path parameters would need per-route fixture data to be meaningful.
    if (routePath.includes(":")) continue;
    if (routePath.includes("*")) continue;
    if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(routePath))) continue;
    if (seen.has(routePath)) continue;

    seen.add(routePath);
    selected.push(routePath);
  }

  return selected;
}

let ctx: TestContext;
let agent: request.SuperAgentTest;
let failures: SweepFailure[] = [];
let sweptPaths: string[] = [];

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);

  const login = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (login.status !== 200) throw new Error(`Login failed: ${login.status}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });

  sweptPaths = selectSweepablePaths(loadManifest());

  try {
    await sweepAll();
  } finally {
    // Drop this suite's company here rather than in afterAll. Several endpoints
    // are only well-defined when exactly one ERP company exists - supplier
    // opening balances refuse to resolve a parent company otherwise - so
    // leaving a second ERP company alive for even part of another suite's run
    // makes unrelated tests fail. Nothing below needs the fixture: the results
    // are already captured in `failures`.
    await cleanupTestData(TEST_PREFIX);
  }

  if (shouldUpdateBaseline) {
    const baseline = {
      description:
        "Endpoints that return 5xx under the smoke sweep's seed data. This list is a " +
        "ratchet: removing entries is progress, adding one accepts a known-broken " +
        "endpoint. Regenerate with UPDATE_API_SMOKE_BASELINE=1.",
      knownFailing: failures.map((failure) => failure.route).sort(),
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  }
}, 300000);

async function sweepAll(): Promise<void> {
  for (const routePath of sweptPaths) {
    let status = 0;
    let detail = "";

    try {
      // A handler that throws without answering never ends the response cycle.
      // Without an explicit deadline that hangs the whole suite instead of
      // failing it - which is precisely the damage this sweep exists to catch,
      // so it must surface as a failure, not a stall.
      const response = await agent
        .get(routePath)
        .timeout({ response: REQUEST_TIMEOUT_MS, deadline: REQUEST_TIMEOUT_MS });
      status = response.status;
      if (status >= 500) {
        const body = response.body as { message?: string; error?: string } | undefined;
        detail = body?.message || body?.error || response.text?.slice(0, 200) || "";
      }
    } catch (error) {
      const timedOut = Boolean((error as { timeout?: unknown } | undefined)?.timeout);
      status = timedOut ? 598 : 599;
      detail = timedOut
        ? `No response within ${REQUEST_TIMEOUT_MS}ms - the handler likely threw without answering.`
        : error instanceof Error
          ? error.message
          : String(error);
    }

    if (status >= 500) failures.push({ route: routePath, status, detail });
  }
}

afterAll(async () => {
  // The fixture is already removed at the end of beforeAll; this is a safety
  // net for the case where seeding itself failed part-way. cleanupTestData is
  // idempotent.
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("API smoke sweep", () => {
  it("sweeps a broad slice of the read surface", () => {
    // Guards against the selection silently collapsing to nothing, which would
    // make the 5xx assertion below vacuous.
    expect(sweptPaths.length).toBeGreaterThan(250);
  });

  it("returns no unexpected 5xx across swept GET endpoints", () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as {
      knownFailing: string[];
    };
    const known = new Set(baseline.knownFailing);

    const unexpected = failures.filter((failure) => !known.has(failure.route));
    const report = unexpected
      .map((failure) => `  ${failure.status} ${failure.route}\n      ${failure.detail}`)
      .join("\n");

    expect(
      unexpected,
      `Unexpected 5xx responses (${unexpected.length}).\n` +
        "A split that moved a handler without its dependencies looks exactly like this.\n" +
        `${report}\n`
    ).toEqual([]);
  });

  it("reports baseline entries that now pass", () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as {
      knownFailing: string[];
    };
    const stillFailing = new Set(failures.map((failure) => failure.route));
    const stale = baseline.knownFailing.filter((route) => sweptPaths.includes(route) && !stillFailing.has(route));

    // Reported rather than asserted, on purpose. Whether a baselined endpoint
    // fails can depend on the environment rather than the code: GET
    // /api/sessions reads the connect-pg-simple `session` table, which exists
    // once the real server has booted but not under the in-memory session store
    // these tests use. Failing the build on that difference would make the
    // suite environment-sensitive for no safety gain - the invariant that
    // actually protects a split is "no unexpected 5xx", asserted above.
    if (stale.length > 0) {
      console.warn(
        `[api-smoke-sweep] ${stale.length} baselined endpoint(s) now pass and can be removed ` +
          `from config/api-smoke-baseline.json:\n  ${stale.join("\n  ")}`
      );
    }

    expect(stale.every((route) => baseline.knownFailing.includes(route))).toBe(true);
  });
});
