/**
 * Response pins for the six route files whose bulk is a single handler.
 *
 * These are the last of the Phase 3 monoliths, and the route manifest cannot
 * carry them: it proves a route is still *registered* after a change, not that
 * the handler still computes the same figures. Reducing these files means
 * extracting logic from inside the handler, so the figures are exactly what is
 * at risk - and they are net profit, supplier statements and purchase orders.
 *
 * So each endpoint's response is hashed against a seeded fixture and pinned
 * here. Extract freely; if a number moves, this fails.
 *
 *   Regenerate (only after a *deliberate* behaviour change):
 *     UPDATE_REPORT_CHARACTERIZATION=1 npm run test:backend -- report-endpoint
 *
 * Volatile fields (ids, timestamps, generated filenames) are stripped before
 * hashing - see normalize() - because they differ per seed and would make the
 * pin useless rather than strict.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

/**
 * Two fixtures: the factory endpoints resolve a factory-type company and answer
 * 403 against an ERP one, so pinning them from a single seed would pin the
 * guard rather than the handler.
 */
const ERP_PREFIX = "chartest";
const FACTORY_PREFIX = "charfact";
const PIN_PATH = path.join(process.cwd(), "config/report-characterization.json");
const shouldUpdate = process.env.UPDATE_REPORT_CHARACTERIZATION === "1";
const REQUEST_TIMEOUT_MS = 30000;

interface PinnedEndpoint {
  /** Route file this endpoint is the whole of, for traceability. */
  sourceModule: string;
  /** Which seeded company this endpoint needs to reach its handler. */
  fixture: "erp" | "factory";
  method: "GET" | "POST" | "PATCH";
  path: string;
  /** Query string appended verbatim; keeps the request deterministic. */
  query?: string;
  body?: Record<string, unknown>;
  /** Response is a file, not JSON: hash the bytes instead of the parsed body. */
  binary?: boolean;
}

/**
 * One entry per remaining single-handler route file. `path` may contain
 * `:companyId` / `:supplierId`, substituted from the seeded fixture.
 */
const ENDPOINTS: PinnedEndpoint[] = [
  {
    sourceModule: "server/routes/stats/statsNetProfitRoutes.ts",
    fixture: "erp",
    method: "GET",
    path: "/api/stats/net-profit",
    query: "startDate=2020-01-01&endDate=2030-12-31",
  },
  {
    sourceModule: "server/routes/netProfitExcelRoute.ts",
    fixture: "erp",
    method: "GET",
    path: "/api/reports/net-profit-excel",
    query: "startDate=2020-01-01&endDate=2030-12-31",
    binary: true,
  },
  {
    sourceModule: "server/routes/factory/employee-pos/employeeNetPositionRoutes.ts",
    fixture: "factory",
    method: "GET",
    path: "/api/factory/net-position",
    query: "startDate=2020-01-01&endDate=2030-12-31",
  },
  {
    sourceModule: "server/routes/factory/suppliers/supplierStatementRoutes.ts",
    fixture: "factory",
    method: "GET",
    path: "/api/factory/suppliers/:supplierId/statement",
  },
];

interface PinFile {
  description: string;
  regenerate: string;
  pins: Record<string, { status: number; shape: string; hash: string }>;
}

/**
 * Strip anything that legitimately varies between seeds so the hash reflects
 * computed values only. Keys are matched by name at any depth.
 */
const VOLATILE_KEYS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "companyId",
  "supplierId",
  "customerId",
  "userId",
  "locationId",
  "stockItemId",
  "voucherId",
  "containerId",
  "generatedAt",
  "timestamp",
  "filename",
]);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** A stable description of the response's structure, independent of values. */
function shapeOf(value: unknown, depth = 0): string {
  if (depth > 4) return "…";
  if (Array.isArray(value)) return value.length ? `[${shapeOf(value[0], depth + 1)}]` : "[]";
  if (value === null) return "null";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.join(",")}}`;
  }
  return typeof value;
}

/** Every sheet's cell values, in order - the workbook's figures without its container. */
async function workbookValues(buffer: Buffer): Promise<unknown> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  return workbook.worksheets.map((sheet) => {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      rows.push(
        (row.values as unknown[]).map((cell) =>
          cell && typeof cell === "object" && "result" in (cell as any) ? (cell as any).result : cell
        )
      );
    });
    return { name: sheet.name, rows };
  });
}

const hash = (value: unknown) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");

function loadPins(): PinFile {
  if (!fs.existsSync(PIN_PATH)) {
    return {
      description: "",
      regenerate: "",
      pins: {},
    };
  }
  return JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as PinFile;
}

const observed: PinFile["pins"] = {};

/** Seed one fixture, walk the endpoints that need it, then release it. */
async function captureWith(prefix: string, fixture: "erp" | "factory"): Promise<void> {
  const ctx: TestContext = await seedTestData(prefix);
  try {
    const agent = request.agent(ctx.app);
    const login = await agent.post("/api/auth/login").send({
      username: `${prefix}_testuser`,
      password: "testpassword123",
    });
    if (login.status !== 200) throw new Error(`Login failed for ${prefix}: ${login.status}`);
    await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });

    // The shared fixture seeds no factory supplier, so the statement endpoint
    // would 404 for any id and the pin would capture the miss rather than the
    // report. Create one and pin the statement it actually produces.
    let supplierId = 0;
    if (fixture === "factory") {
      const created = await agent
        .post("/api/factory/suppliers")
        .send({ name: `${prefix} supplier`, currencyCode: "USD" });
      supplierId = (created.body as { id?: number })?.id ?? 0;
      if (!supplierId) throw new Error(`Could not seed a factory supplier: ${created.status}`);
    }

    for (const endpoint of ENDPOINTS.filter((e) => e.fixture === fixture)) {
      const resolved = endpoint.path.replace(":supplierId", String(supplierId));
      const url = endpoint.query ? `${resolved}?${endpoint.query}` : resolved;

      let call = agent[endpoint.method === "GET" ? "get" : "post"](url);
      if (endpoint.binary)
        call = call.buffer(true).parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      const response = await call
        .send(endpoint.body ?? undefined)
        .timeout({ response: REQUEST_TIMEOUT_MS, deadline: REQUEST_TIMEOUT_MS });

      // An xlsx buffer is not byte-stable - the zip container records a
      // creation time - so hashing the bytes would fail on every run. Read the
      // workbook and hash the cell values, which is the part worth pinning.
      const isBuffer = endpoint.binary && Buffer.isBuffer(response.body);
      observed[`${endpoint.method} ${endpoint.path}`] = {
        status: response.status,
        shape: isBuffer ? `workbook:${response.type}` : shapeOf(response.body),
        hash: isBuffer ? hash(await workbookValues(response.body as Buffer)) : hash(response.body),
      };
    }
  } finally {
    // Only one fixture company may exist at a time - the suite pins
    // system_settings.parentCompanyId - so release before seeding the next.
    await cleanupTestData(prefix);
  }
}

beforeAll(async () => {
  await captureWith(ERP_PREFIX, "erp");
  await captureWith(FACTORY_PREFIX, "factory");

  if (shouldUpdate) {
    const file: PinFile = {
      description:
        "Response pins for the single-handler route files remaining in Phase 3. The " +
        "route manifest proves a route is still registered; these prove the handler " +
        "still computes the same figures. Volatile fields (ids, timestamps) are " +
        "stripped before hashing.",
      regenerate: "UPDATE_REPORT_CHARACTERIZATION=1 npm run test:backend -- report-endpoint",
      pins: observed,
    };
    fs.writeFileSync(PIN_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}, 300000);

afterAll(() => {
  closeTestServer();
});

describe("single-handler report endpoints keep their computed output", () => {
  const pinned = loadPins();

  it("has a pin recorded for every endpoint under extraction", () => {
    const missing = ENDPOINTS.map((e) => `${e.method} ${e.path}`).filter((key) => !pinned.pins[key]);
    expect(missing, `No pin for:\n${missing.join("\n")}\nRegenerate with ${pinned.regenerate}`).toEqual([]);
  });

  it.each(ENDPOINTS)("$method $path returns the pinned status and shape", (endpoint) => {
    const key = `${endpoint.method} ${endpoint.path}`;
    const expected = pinned.pins[key];
    if (!expected) return; // reported by the test above

    expect(observed[key].status, `${key} status changed`).toBe(expected.status);
    expect(observed[key].shape, `${key} response shape changed`).toBe(expected.shape);
  });

  it.each(ENDPOINTS)("$method $path returns the pinned figures", (endpoint) => {
    const key = `${endpoint.method} ${endpoint.path}`;
    const expected = pinned.pins[key];
    if (!expected) return;

    expect(
      observed[key].hash,
      `${key} returned different values for the same fixture. If the change was ` +
        `deliberate, regenerate with: ${pinned.regenerate}`
    ).toBe(expected.hash);
  });
});
