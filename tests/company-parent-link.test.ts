import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../server/db";
import * as schema from "../shared/schema";
import { cleanupTestData, closeTestServer, seedTestData, type TestContext } from "./setup";

const TEST_PREFIX = "companyparent";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let activeParentId: number;
let inactiveParentId: number;
let childCompanyId: number;

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);

  const login = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  expect(login.status).toBe(200);

  const [activeParent] = await db
    .insert(schema.companies)
    .values({
      code: "CPARENT01",
      name: `${TEST_PREFIX}_ActiveParent`,
      companyType: "erp",
      active: true,
      baseCurrency: "USD",
    })
    .returning();
  activeParentId = activeParent.id;

  const [inactiveParent] = await db
    .insert(schema.companies)
    .values({
      code: "CPARENT02",
      name: `${TEST_PREFIX}_InactiveParent`,
      companyType: "erp",
      active: false,
      baseCurrency: "USD",
    })
    .returning();
  inactiveParentId = inactiveParent.id;
});

afterAll(async () => {
  closeTestServer();
  await cleanupTestData(TEST_PREFIX);
});

describe("company parent relationship", () => {
  it("accepts an active parent when creating and preserves it on update", async () => {
    const created = await agent.post("/api/companies").send({
      code: "CPARENT03",
      name: `${TEST_PREFIX}_SupplierPartner`,
      companyType: "supplier_partner",
      active: true,
      baseCurrency: "USD",
      parentCompanyId: activeParentId,
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      companyType: "supplier_partner",
      parentCompanyId: activeParentId,
    });
    childCompanyId = created.body.id;
    await db.insert(schema.userCompanyRoles).values({
      userId: ctx.userId,
      companyId: childCompanyId,
      role: "Admin",
    });

    const unchanged = await agent.patch(`/api/companies/${childCompanyId}`).send({
      name: `${TEST_PREFIX}_SupplierPartnerUpdated`,
      parentCompanyId: activeParentId,
    });

    expect(unchanged.status).toBe(200);
    expect(unchanged.body.parentCompanyId).toBe(activeParentId);
  });

  it("allows an Admin to intentionally clear the parent relationship", async () => {
    const cleared = await agent.patch(`/api/companies/${childCompanyId}`).send({ parentCompanyId: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body.parentCompanyId).toBeNull();
  });

  it.each([
    ["self", () => childCompanyId, "A company cannot be its own parent company."],
    ["missing", () => 999999999, "The selected parent company does not exist."],
    ["inactive", () => inactiveParentId, "The selected parent company is inactive."],
  ])("rejects a %s parent", async (_label, getParentId, message) => {
    const rejected = await agent.patch(`/api/companies/${childCompanyId}`).send({
      parentCompanyId: getParentId(),
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toBe(message);
  });
});
