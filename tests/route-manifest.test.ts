import fs from "node:fs";
import path from "node:path";
import express from "express";
import { beforeAll, describe, expect, it } from "vitest";
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

// Six reviewed bilingual interceptor registrations intentionally call next().
const MAX_SHADOWED_REGISTRATIONS = 148;
let actual: SerializedRouteManifest;

async function buildManifest(): Promise<SerializedRouteManifest> {
  const app = express();
  const server = await registerRoutes(app);
  server.close();
  return serializeRouteManifest(extractRouteManifest(app));
}

function describeDiff(label: string, expectedEntries: string[], actualEntries: string[]): string {
  const { added, removed, reordered } = diffManifestEntries(expectedEntries, actualEntries);
  const lines: string[] = [];
  if (removed.length) lines.push(`${label} removed (${removed.length}) - these no longer resolve:`, ...removed.map((entry) => `  - ${entry}`));
  if (added.length) lines.push(`${label} added (${added.length}):`, ...added.map((entry) => `  + ${entry}`));
  if (reordered) {
    const index = expectedEntries.findIndex((entry, i) => entry !== actualEntries[i]);
    lines.push(`${label} reordered - membership is unchanged but registration order moved.`, "Express resolves first-match, so this can change which handler wins.", `  first divergence at index ${index}:`, `    expected: ${expectedEntries[index]}`, `    actual:   ${actualEntries[index]}`);
  }
  if (!lines.length) return "";
  lines.push("", "If this change is intentional, regenerate with:", "  UPDATE_ROUTE_MANIFEST=1 npm run test:backend -- route-manifest");
  return lines.join("\n");
}

/**
 * Subtract exactly one reviewed occurrence while preserving the committed
 * sequence. A reviewed route can be a duplicate of a route already present in
 * the snapshot, so removing the first or last match blindly can retain the
 * duplicate in the wrong position and create a false reorder failure.
 */
function removeReviewedOccurrences(
  entries: string[],
  expectedEntries: string[],
  reviewedEntries: Set<string>
): string[] {
  const remainingReviewed = new Map(
    [...reviewedEntries].map((entry) => [entry, 1] as const)
  );
  const normalized: string[] = [];
  let expectedIndex = 0;

  for (const entry of entries) {
    if (entry === expectedEntries[expectedIndex]) {
      normalized.push(entry);
      expectedIndex += 1;
      continue;
    }

    const remaining = remainingReviewed.get(entry) ?? 0;
    if (remaining > 0) {
      remainingReviewed.set(entry, remaining - 1);
      continue;
    }

    normalized.push(entry);
  }

  return normalized;
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
    expect(fs.existsSync(MANIFEST_PATH), "config/route-manifest.json is missing").toBe(true);
  });

  it("registers a non-trivial number of routes", () => expect(actual.routeCount).toBeGreaterThan(500));

  it("exposes no route without an identifiable handler chain", () => {
    expect(actual.routes.filter((entry) => entry.endsWith("[]"))).toEqual([]);
  });

  it("matches the committed snapshot plus exact reviewed additions", () => {
    const expected = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as SerializedRouteManifest;
    const reviewedRoutes = new Set(allowances.routeManifestAdditions);
    const reviewedMounts = new Set(allowances.routeManifestMountAdditions);
    const routes = removeReviewedOccurrences(actual.routes, expected.routes, reviewedRoutes);
    const mounts = removeReviewedOccurrences(actual.middlewareMounts, expected.middlewareMounts, reviewedMounts);
    expect(expected.formatVersion).toBe(ROUTE_MANIFEST_FORMAT_VERSION);
    const routeDiff = describeDiff("Routes", expected.routes, routes);
    expect(routeDiff, routeDiff).toBe("");
    for (const addition of reviewedRoutes) {
      const baselineCount = expected.routes.filter((entry) => entry === addition).length;
      expect(actual.routes.filter((entry) => entry === addition).length).toBe(baselineCount + 1);
    }
    const mountDiff = describeDiff("Middleware mounts", expected.middlewareMounts, mounts);
    expect(mountDiff, mountDiff).toBe("");
    for (const addition of reviewedMounts) {
      const baselineCount = expected.middlewareMounts.filter((entry) => entry === addition).length;
      expect(actual.middlewareMounts.filter((entry) => entry === addition).length).toBe(baselineCount + 1);
    }
    expect(actual.routeCount).toBe(expected.routeCount + reviewedRoutes.size);
    expect(actual.middlewareMountCount).toBe(expected.middlewareMountCount + reviewedMounts.size);
  });

  it("does not add shadowed route registrations", () => {
    const counts = new Map<string, number>();
    for (const entry of actual.routes) {
      const key = entry.slice(0, entry.lastIndexOf("[")).trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let shadowed = 0;
    for (const count of counts.values()) shadowed += count - 1;
    expect(shadowed, `Shadowed registrations rose to ${shadowed} from a baseline of ${MAX_SHADOWED_REGISTRATIONS}.`).toBeLessThanOrEqual(MAX_SHADOWED_REGISTRATIONS);
  });

  it("keeps every /api route behind an explicit guard", () => {
    const snapshot = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as SerializedRouteManifest;
    const publicRoutes = new Set(snapshot.routes.filter((entry) => entry.includes("[<anonymous>]")));
    const unguarded = actual.routes.filter((entry) => entry.includes("[<anonymous>]") && !publicRoutes.has(entry));
    expect(unguarded).toEqual([]);
  });
});
