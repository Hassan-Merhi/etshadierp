/**
 * Route manifest snapshot.
 * -----------------------
 * Guards the application's routing contract during the god-file split program.
 *
 * Every route module split must leave this manifest byte-identical. If a split
 * drops a route, drops a guard such as `requireAuth`, or reorders overlapping
 * registrations, this test fails and names the exact entries involved.
 *
 * Intentional route additions may be recorded as exact reviewed deltas in
 * config/ci-ratchet-allowances.json. Any other route change still fails.
 *
 * Intentional full snapshot changes can be regenerated with:
 *
 *     UPDATE_ROUTE_MANIFEST=1 npm run test:backend -- route-manifest
 */
import fs from "node:fs";
import path from "node:path";

import express from "express";
import { describe, expect, it, beforeAll } from "vitest";

import { registerRoutes } from "../server/routes";
import {
  ROUTE_MANIFEST_FORMAT_VERSION,
  diffManifestEntries,
  extractRouteManifest,
  serializeRouteManifest,
  type SerializedRouteManifest,
} from "./helpers/routeManifest";

interface RatchetAllowances {
  routeManifestAdditions: string[];
  routeManifestMountAdditions: string[];
}

const MANIFEST_PATH = path.join(process.cwd(), "config/route-manifest.json");
const ALLOWANCES_PATH = path.join(process.cwd(), "config/ci-ratchet-allowances.json");
const shouldUpdate = process.env.UPDATE_ROUTE_MANIFEST === "1";
const allowances = JSON.parse(fs.readFileSync(ALLOWANCES_PATH, "utf8")) as RatchetAllowances;

/**
 * Registrations that are shadowed by an earlier identical method+path. A
 * one-way ceiling: lower it whenever dead duplicates are removed.
 */
const MAX_SHADOWED_REGISTRATIONS = 142;

let actual: SerializedRouteManifest;

/**
 * Build the app the same way `tests/setup.ts` does, minus the session and body
 * parsers: route registration is synchronous and touches no database, so the
 * manifest can be extracted without a live connection.
 */
async function buildManifest(): Promise<SerializedRouteManifest> {
  const app = express();
  const server = await registerRoutes(app);
  // registerRoutes returns an unlistened http.Server; close it so the handle
  // cannot keep the worker alive.
  server.close();
  return serializeRouteManifest(extractRouteManifest(app));
}

function describeDiff(label: string, expectedEntries: string[], actualEntries: string[]): string {
  const { added, removed, reordered } = diffManifestEntries(expectedEntries, actualEntries);
  const lines: string[] = [];

  if (removed.length > 0) {
    lines.push(
      `${label} removed (${removed.length}) - these no longer resolve:`,
      ...removed.map((entry) => `  - ${entry}`)
    );
  }
  if (added.length > 0) {
    lines.push(`${label} added (${added.length}):`, ...added.map((entry) => `  + ${entry}`));
  }
  if (reordered) {
    const firstDivergence = expectedEntries.findIndex((entry, index) => entry !== actualEntries[index]);
    lines.push(
      `${label} reordered - membership is unchanged but registration order moved.`,
      "Express resolves first-match, so this can change which handler wins.",
      `  first divergence at index ${firstDivergence}:`,
      `    expected: ${expectedEntries[firstDivergence]}`,
      `    actual:   ${actualEntries[firstDivergence]}`
    );
  }

  if (lines.length === 0) return "";
  lines.push(
    "",
    "If this change is intentional, regenerate with:",
    "  UPDATE_ROUTE_MANIFEST=1 npm run test:backend -- route-manifest"
  );
  return lines.join("\n");
}

describe("route manifest", () => {
  beforeAll(async () => {
    actual = await buildManifest();

    if (shouldUpdate) {
      fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
      fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    }
  });

  it("has a committed snapshot to compare against", () => {
    expect(
      fs.existsSync(MANIFEST_PATH),
      "config/route-manifest.json is missing. Generate it with UPDATE_ROUTE_MANIFEST=1 npm run test:backend -- route-manifest"
    ).toBe(true);
  });

  it("registers a non-trivial number of routes", () => {
    // Guards against the extractor silently returning nothing (for example if
    // Express changes its internal router shape), which would make every other
    // assertion in this file vacuously pass.
    expect(actual.routeCount).toBeGreaterThan(500);
  });

  it("exposes no route without an identifiable handler chain", () => {
    const empty = actual.routes.filter((entry) => entry.endsWith("[]"));
    expect(empty, `routes with an empty handler chain:\n${empty.join("\n")}`).toEqual([]);
  });

  it("matches the committed snapshot plus exact reviewed additions", () => {
    const expected = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as SerializedRouteManifest;
    const reviewedAdditions = new Set(allowances.routeManifestAdditions);
    const reviewedMountAdditions = new Set(allowances.routeManifestMountAdditions);
    const actualWithoutReviewedAdditions = actual.routes.filter((entry) => !reviewedAdditions.has(entry));
    const actualMountsWithoutReviewedAdditions = actual.middlewareMounts.filter(
      (entry) => !reviewedMountAdditions.has(entry)
    );

    expect(
      expected.formatVersion,
      "Snapshot was written by a different manifest format. Regenerate with UPDATE_ROUTE_MANIFEST=1."
    ).toBe(ROUTE_MANIFEST_FORMAT_VERSION);

    const routeDiff = describeDiff("Routes", expected.routes, actualWithoutReviewedAdditions);
    expect(routeDiff, routeDiff).toBe("");

    for (const addition of reviewedAdditions) {
      const count = actual.routes.filter((entry) => entry === addition).length;
      expect(count, `Reviewed route addition is missing or duplicated: ${addition}`).toBe(1);
    }

    const mountDiff = describeDiff(
      "Middleware mounts",
      expected.middlewareMounts,
      actualMountsWithoutReviewedAdditions
    );
    expect(mountDiff, mountDiff).toBe("");

    for (const addition of reviewedMountAdditions) {
      const count = actual.middlewareMounts.filter((entry) => entry === addition).length;
      expect(count, `Reviewed middleware mount addition is missing or duplicated: ${addition}`).toBe(1);
    }

    expect(actual.routeCount).toBe(expected.routeCount + reviewedAdditions.size);
    expect(actual.middlewareMountCount).toBe(expected.middlewareMountCount + reviewedMountAdditions.size);
  });

  it("does not add shadowed route registrations", () => {
    // Express resolves first-match, so a second registration of the same
    // method and path only runs if the earlier handler calls next(). Some of
    // these are deliberate interceptor chains; others are dead handlers left
    // behind by earlier refactors. Either way the number should fall, never
    // rise - a new duplicate is either dead on arrival or a silent override of
    // an existing endpoint.
    const counts = new Map<string, number>();
    for (const entry of actual.routes) {
      const methodAndPath = entry.slice(0, entry.lastIndexOf("[")).trim();
      counts.set(methodAndPath, (counts.get(methodAndPath) ?? 0) + 1);
    }

    let shadowed = 0;
    for (const count of counts.values()) shadowed += count - 1;

    expect(
      shadowed,
      `Shadowed registrations rose to ${shadowed} from a baseline of ${MAX_SHADOWED_REGISTRATIONS}. ` +
        "Register the new handler on a distinct path, or replace the existing one rather than " +
        "stacking on top of it."
    ).toBeLessThanOrEqual(MAX_SHADOWED_REGISTRATIONS);
  });

  it("keeps every /api route behind an explicit guard", () => {
    // A split that drops `requireAuth` while moving a handler is the highest
    // -consequence failure mode this manifest exists to catch. Public endpoints
    // are enumerated so that adding one is a deliberate, reviewed act.
    const publicRoutes = new Set(
      (JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as SerializedRouteManifest).routes.filter((entry) =>
        entry.includes("[<anonymous>]")
      )
    );

    const unguarded = actual.routes.filter((entry) => entry.includes("[<anonymous>]") && !publicRoutes.has(entry));

    expect(
      unguarded,
      `These routes have no named guard and are not in the committed snapshot:\n${unguarded.join("\n")}`
    ).toEqual([]);
  });
});
