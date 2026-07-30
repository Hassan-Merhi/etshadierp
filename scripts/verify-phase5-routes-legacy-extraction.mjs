import { existsSync, readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const fail = (message) => {
  throw new Error(`Phase 5 routesLegacy verification failed: ${message}`);
};

if (existsSync(new URL("../server/routesLegacy.ts", import.meta.url))) {
  fail("retired routesLegacy path exists");
}

const publicRoutes = read("server/routes.ts");
if (!publicRoutes.includes("registerApplicationRoutes(app)")) fail("public route entry does not delegate to application composition");
if (publicRoutes.includes("registerLegacyRoutes")) fail("public route entry restores legacy delegation");

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

const boundary = JSON.parse(read("config/legacy-route-boundaries.json"));
if (boundary.version < 9 || !String(boundary.description).includes("removed")) {
  fail("legacy route boundary does not record physical retirement");
}
if (!Array.isArray(boundary.files) || boundary.files.length !== 0) {
  fail("legacy route boundary still contains compatibility file entries");
}

console.log("Phase 5 routesLegacy extraction contract verified at the final retired boundary.");
