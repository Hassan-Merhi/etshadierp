/**
 * Route manifest snapshot.
 * -----------------------
 * Guards the application's routing contract during the god-file split program.
 *
 * Every route module split must leave this manifest byte-identical. If a split
 * drops a route, drops a guard such as `requireAuth`, or reorders overlapping
 * registrations, this test fails and names the exact entries involved.
 *
 * Intentional route changes are expected — regenerate the snapshot with:
 *
 *     UPDATE_ROUTE_MANIFEST=1 npm run test:backend -- route-manifest
 *
 * and review the resulting diff to `config/route-manifest.json` as part of the
 * change. Regenerating during a pure file split is a mistake: the whole point
 * is that a behaviour-preserving split produces no diff.
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

const MANIFEST_PATH = path.join(process.cwd(), "config/route-manifest.json");
const shouldUpdate = process.env.UPDATE_ROUTE_MANIFEST === "1";

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

  it("matches the committed snapshot exactly", () => {
    const expected = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as SerializedRouteManifest;

    expect(
      expected.formatVersion,
      "Snapshot was written by a different manifest format. Regenerate with UPDATE_ROUTE_MANIFEST=1."
    ).toBe(ROUTE_MANIFEST_FORMAT_VERSION);

    const routeDiff = describeDiff("Routes", expected.routes, actual.routes);
    expect(routeDiff, routeDiff).toBe("");

    const mountDiff = describeDiff("Middleware mounts", expected.middlewareMounts, actual.middlewareMounts);
    expect(mountDiff, mountDiff).toBe("");

    expect(actual.routeCount).toBe(expected.routeCount);
    expect(actual.middlewareMountCount).toBe(expected.middlewareMountCount);
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
