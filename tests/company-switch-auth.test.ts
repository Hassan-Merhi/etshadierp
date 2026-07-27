import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../server/db";
import * as schema from "../shared/schema";
import {
  cleanupTestData,
  closeTestServer,
  seedTestData,
  type TestContext,
} from "./setup";

const TEST_PREFIX = "companyswitch";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let secondCompanyId: number;

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);

  const login = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  expect(login.status).toBe(200);

  const [secondCompany] = await db
    .insert(schema.companies)
    .values({
      code: "COSWITCH2",
      name: `${TEST_PREFIX}_SecondCompany`,
      baseCurrency: "USD",
    })
    .returning();
  secondCompanyId = secondCompany.id;

  await db.insert(schema.userCompanyRoles).values({
    userId: ctx.userId,
    companyId: secondCompanyId,
    role: "Admin",
  });
}, 60000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("company switching authorization", () => {
  it("allows an authenticated user to switch to another assigned company", async () => {
    const switched = await agent
      .post("/api/auth/set-company")
      .send({ companyId: secondCompanyId });

    expect(switched.status).toBe(200);
    expect(switched.body).toMatchObject({
      message: "Company set successfully",
      companyId: secondCompanyId,
    });

    const sessionCompany = await agent.get("/api/auth/session-company");
    expect(sessionCompany.status).toBe(200);
    expect(sessionCompany.body).toEqual({ companyId: secondCompanyId });
  });

  it("still rejects switching to an unassigned company", async () => {
    const denied = await agent
      .post("/api/auth/set-company")
      .send({ companyId: 999999999 });

    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe("You don't have access to this company");
  });
});
