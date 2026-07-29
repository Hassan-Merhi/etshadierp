import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fail = (message) => {
  throw new Error(`Phase 5 routesLegacy verification failed: ${message}`);
};

const legacy = read("server/routesLegacy.ts");
if (!legacy.includes("registerApplicationRoutes(app)")) fail("compatibility export is missing");
for (const marker of ["app.get(", "app.post(", "app.put(", "app.patch(", "app.delete(", "app.use("]) {
  if (legacy.includes(marker)) fail(`routesLegacy still owns HTTP registration: ${marker}`);
}
if (legacy.split("\n").length > 14) fail("routesLegacy exceeds its final line budget");

const root = read("server/routes/applicationRoutes.ts");
for (const marker of [
  "registerPermissionBoundaryRoutes(app)",
  "registerLegacyHealthRoutes(app)",
  "registerIntercompanyPosConfigRoutes(app)",
  "registerErpWorkerDocumentRoutes(app)",
  "registerSalaryAdvanceRoutes(app)",
  "return createServer(app)",
]) {
  if (!root.includes(marker)) fail(`application composition root is missing ${marker}`);
}

const budget = JSON.parse(read("config/legacy-route-boundaries.json"));
const entry = budget.files.find((item) => item.path === "server/routesLegacy.ts");
if (!entry || entry.maxLines > 14 || entry.migrationPhase !== 5) {
  fail("routesLegacy budget was not closed for Phase 5");
}

console.log("Phase 5 routesLegacy extraction contract verified.");
