/**
 * Regression tests for the deterministic (LLM-free) multi-source, target-
 * quantity stock-transfer chat path in server/chatService.ts
 * (`tryBuildEarlyMultiSourceTargetTransfer` / `deterministicParseMultiSourceTransfer`).
 *
 * This is the early hard-return route that must resolve requests like:
 *   "Create an optional stock transfer draft for 410 bales to Kolwezi today
 *    from Hadi 1, Hadi 2, Hadi 3, and Hadi 4. Only choose items whose stock
 *    group already exists in Kolwezi inventory. Do not use Kolwezi 2."
 * without ever handing off to the generic AI call, and without ever
 * confusing "Kolwezi" with "Kolwezi 2".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { eq, sql } from "drizzle-orm";
import * as schema from "../shared/schema";
import { chat } from "../server/chatService";

const PREFIX = "cmst";

let companyId: number;
let hadi1: number, hadi2: number, hadi3: number, hadi4: number;
let kolwezi: number, kolwezi2: number;
let eligibleGroupId: number, ineligibleGroupId: number;

// chat() bails out immediately with "AI chatbot is not configured" unless at
// least one provider key is present — but the deterministic early-return
// route under test here always hard-returns BEFORE any real AI API call is
// made, so a placeholder key is safe and never actually reaches OpenAI.
const hadRealOpenAiKey = !!process.env.OPENAI_API_KEY;
if (!hadRealOpenAiKey) process.env.OPENAI_API_KEY = "test-placeholder-key-never-used";

async function cleanup() {
  const companies = await db
    .select()
    .from(schema.companies)
    .where(sql`${schema.companies.name} LIKE ${"%" + PREFIX + "%"}`);
  for (const company of companies) {
    await db.delete(schema.inventory).where(eq(schema.inventory.companyId, company.id));
    await db.delete(schema.stockItems).where(eq(schema.stockItems.companyId, company.id));
    await db.delete(schema.stockGroups).where(eq(schema.stockGroups.companyId, company.id));
    await db.delete(schema.locations).where(eq(schema.locations.companyId, company.id));
    await db.delete(schema.companies).where(eq(schema.companies.id, company.id));
  }
}

async function makeLocation(name: string, code: string) {
  const [loc] = await db
    .insert(schema.locations)
    .values({ companyId, code, name })
    .returning();
  return loc.id as number;
}

async function makeStockGroup(name: string, code: string) {
  const [g] = await db
    .insert(schema.stockGroups)
    .values({ companyId, code, name })
    .returning();
  return g.id as number;
}

async function makeStockItem(code: string, name: string, stockGroupId: number) {
  const [item] = await db
    .insert(schema.stockItems)
    .values({ companyId, code, name, uom: "PCS", stockGroupId, active: true })
    .returning();
  return item.id as number;
}

async function setInventory(locationId: number, stockItemId: number, quantity: number) {
  await db.insert(schema.inventory).values({
    companyId,
    locationId,
    stockItemId,
    quantity: String(quantity),
    averageRate: "10.00",
    totalValue: String(quantity * 10),
  });
}

beforeAll(async () => {
  await cleanup();

  const [company] = await db
    .insert(schema.companies)
    .values({ code: `${PREFIX}CO`.toUpperCase(), name: `${PREFIX}_TestCompany`, baseCurrency: "USD" })
    .returning();
  companyId = company.id;

  hadi1 = await makeLocation("Hadi 1", `${PREFIX}-HADI1`);
  hadi2 = await makeLocation("Hadi 2", `${PREFIX}-HADI2`);
  hadi3 = await makeLocation("Hadi 3", `${PREFIX}-HADI3`);
  hadi4 = await makeLocation("Hadi 4", `${PREFIX}-HADI4`);
  kolwezi = await makeLocation("Kolwezi", `${PREFIX}-KLW`);
  kolwezi2 = await makeLocation("Kolwezi 2", `${PREFIX}-KLW2`);

  eligibleGroupId = await makeStockGroup("Eligible Group", `${PREFIX}-ELG`);
  ineligibleGroupId = await makeStockGroup("Ineligible Group", `${PREFIX}-INE`);

  // Destination (Kolwezi) carries the eligible stock group only.
  const kolweziEligibleItem = await makeStockItem(`${PREFIX}-KLW-EL1`, "Kolwezi Eligible Item", eligibleGroupId);
  await setInventory(kolwezi, kolweziEligibleItem, 20);

  // Kolwezi 2 also carries stock — must never be selected as source or destination.
  const kolwezi2Item = await makeStockItem(`${PREFIX}-KLW2-EL1`, "Kolwezi2 Eligible Item", eligibleGroupId);
  await setInventory(kolwezi2, kolwezi2Item, 500);

  // Each Hadi source carries BOTH an eligible-group item (should be selected)
  // and an ineligible-group item (must NEVER be selected, since Kolwezi does
  // not carry that stock group).
  const sources = [hadi1, hadi2, hadi3, hadi4];
  for (let i = 0; i < sources.length; i++) {
    const eligibleItem = await makeStockItem(`${PREFIX}-H${i + 1}-EL`, `Hadi${i + 1} Eligible Item`, eligibleGroupId);
    const ineligibleItem = await makeStockItem(`${PREFIX}-H${i + 1}-IN`, `Hadi${i + 1} Ineligible Item`, ineligibleGroupId);
    await setInventory(sources[i], eligibleItem, 100);
    await setInventory(sources[i], ineligibleItem, 100);
  }
  // Total eligible stock across Hadi 1-4 = 400 (< requested 410) → shortfall path.
});

afterAll(async () => {
  await cleanup();
  if (!hadRealOpenAiKey) delete process.env.OPENAI_API_KEY;
});

const MESSAGE =
  "Create an optional stock transfer draft for 410 bales to Kolwezi today from Hadi 1, Hadi 2, Hadi 3, and Hadi 4. Only choose items whose stock group already exists in Kolwezi inventory. Do not use Kolwezi 2.";

describe("chat() — deterministic multi-source stock transfer", () => {
  it("returns a draft (stockTransferDraft or stockTransferDrafts), never the generic locations-required error", async () => {
    const result = await chat(MESSAGE, companyId);

    expect(result.response).not.toContain("Source and destination locations are required");
    expect(result.stockTransferDraft || result.stockTransferDrafts).toBeTruthy();
  });

  it("does not fall through to generic AI acknowledgment text without a draft", async () => {
    const result = await chat(MESSAGE, companyId);
    const hasDraft = !!(result.stockTransferDraft || (result.stockTransferDrafts && result.stockTransferDrafts.length > 0));
    expect(hasDraft).toBe(true);
    // Guard against the historical "I understand... I will create it..." hallucination bug.
    expect(result.response.toLowerCase()).not.toMatch(/^i understand/);
  });

  it("resolves the destination to Kolwezi, never Kolwezi 2", async () => {
    const result = await chat(MESSAGE, companyId);
    const drafts = result.stockTransferDraft ? [result.stockTransferDraft] : result.stockTransferDrafts || [];
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      expect(d.destinationLocationName).toBe("Kolwezi");
      expect(d.destinationLocationId).toBe(kolwezi);
      expect(d.destinationLocationName).not.toBe("Kolwezi 2");
      expect(d.destinationLocationId).not.toBe(kolwezi2);
    }
  });

  it("uses Hadi 1, Hadi 2, Hadi 3, and Hadi 4 as sources where eligible stock exists", async () => {
    const result = await chat(MESSAGE, companyId);
    const drafts = result.stockTransferDraft ? [result.stockTransferDraft] : result.stockTransferDrafts || [];
    const sourceNames = drafts.map((d: any) => d.sourceLocationName);
    expect(new Set(sourceNames)).toEqual(new Set(["Hadi 1", "Hadi 2", "Hadi 3", "Hadi 4"]));
    const sourceIds = drafts.map((d: any) => d.sourceLocationId);
    expect(sourceIds).not.toContain(kolwezi2);
    expect(sourceIds).not.toContain(kolwezi);
  });

  it("only includes items whose stock group is already carried at the destination", async () => {
    const result = await chat(MESSAGE, companyId);
    const drafts = result.stockTransferDraft ? [result.stockTransferDraft] : result.stockTransferDrafts || [];
    for (const d of drafts) {
      for (const item of d.items) {
        expect(item.stockItemName).not.toMatch(/Ineligible/i);
        expect(item.stockItemCode).toMatch(/-EL$/);
      }
    }
  });

  it("keeps optional: true on the draft(s) when the user says 'optional'", async () => {
    const result = await chat(MESSAGE, companyId);
    const drafts = result.stockTransferDraft ? [result.stockTransferDraft] : result.stockTransferDrafts || [];
    for (const d of drafts) {
      expect(d.optional).toBe(true);
    }
  });
});

describe("chat() — ambiguous destination name", () => {
  const AMBIGUOUS_MESSAGE =
    "Create an optional stock transfer draft for 50 bales to Kolwezi today from Hadi 1, Hadi 2, Hadi 3, and Hadi 4. Only choose items whose stock group already exists in Kolwezi inventory.";
  let dupCompanyId: number;
  let dupKolweziA: number, dupKolweziB: number;
  let dupHadi1: number, dupHadi2: number, dupHadi3: number, dupHadi4: number;

  beforeAll(async () => {
    const dupPrefix = `${PREFIX}dup`;
    const [company] = await db
      .insert(schema.companies)
      .values({ code: `${dupPrefix}CO`.toUpperCase(), name: `${dupPrefix}_TestCompany`, baseCurrency: "USD" })
      .returning();
    dupCompanyId = company.id;

    // Two locations named identically "Kolwezi" — the exact name is genuinely
    // ambiguous, and the deterministic parser must ask for clarification
    // rather than silently guessing one of them.
    const insertLoc = async (name: string, code: string) => {
      const [loc] = await db.insert(schema.locations).values({ companyId: dupCompanyId, code, name }).returning();
      return loc.id as number;
    };
    dupKolweziA = await insertLoc("Kolwezi", `${dupPrefix}-KLWA`);
    dupKolweziB = await insertLoc("Kolwezi", `${dupPrefix}-KLWB`);
    dupHadi1 = await insertLoc("Hadi 1", `${dupPrefix}-H1`);
    dupHadi2 = await insertLoc("Hadi 2", `${dupPrefix}-H2`);
    dupHadi3 = await insertLoc("Hadi 3", `${dupPrefix}-H3`);
    dupHadi4 = await insertLoc("Hadi 4", `${dupPrefix}-H4`);
  });

  afterAll(async () => {
    await db.delete(schema.locations).where(eq(schema.locations.companyId, dupCompanyId));
    await db.delete(schema.companies).where(eq(schema.companies.id, dupCompanyId));
  });

  it("asks for clarification instead of picking one of the ambiguous Kolwezi locations", async () => {
    const result = await chat(AMBIGUOUS_MESSAGE, dupCompanyId);
    // Must not silently resolve to either duplicate location's id.
    const drafts = result.stockTransferDraft ? [result.stockTransferDraft] : result.stockTransferDrafts || [];
    for (const d of drafts) {
      expect(d.destinationLocationId).not.toBe(dupKolweziA);
      expect(d.destinationLocationId).not.toBe(dupKolweziB);
    }
    expect(result.response.toLowerCase()).toMatch(/more than one location|which one|clarify|exactly which/);
  });
});

describe("chat() — no eligible stock at any source", () => {
  const NO_ELIGIBLE_MESSAGE =
    "Create an optional stock transfer draft for 50 bales to Kolwezi today from Hadi 1, Hadi 2, Hadi 3, and Hadi 4. Only choose items whose stock group already exists in Kolwezi inventory. Do not use Kolwezi 2.";
  let noEligCompanyId: number;

  beforeAll(async () => {
    const p = `${PREFIX}noe`;
    const [company] = await db
      .insert(schema.companies)
      .values({ code: `${p}CO`.toUpperCase(), name: `${p}_TestCompany`, baseCurrency: "USD" })
      .returning();
    noEligCompanyId = company.id;

    const insertLoc = async (name: string, code: string) => {
      const [loc] = await db.insert(schema.locations).values({ companyId: noEligCompanyId, code, name }).returning();
      return loc.id as number;
    };
    const dest = await insertLoc("Kolwezi", `${p}-KLW`);
    const kolwezi2Loc = await insertLoc("Kolwezi 2", `${p}-KLW2`);
    const src1 = await insertLoc("Hadi 1", `${p}-H1`);
    const src2 = await insertLoc("Hadi 2", `${p}-H2`);
    const src3 = await insertLoc("Hadi 3", `${p}-H3`);
    const src4 = await insertLoc("Hadi 4", `${p}-H4`);

    const [groupDest] = await db
      .insert(schema.stockGroups)
      .values({ companyId: noEligCompanyId, code: `${p}-GD`, name: "Dest Only Group" })
      .returning();
    const [groupSrc] = await db
      .insert(schema.stockGroups)
      .values({ companyId: noEligCompanyId, code: `${p}-GS`, name: "Source Only Group" })
      .returning();

    // Destination carries a stock group that none of the sources carry.
    const [destItem] = await db
      .insert(schema.stockItems)
      .values({ companyId: noEligCompanyId, code: `${p}-DEST1`, name: "Dest Item", uom: "PCS", stockGroupId: groupDest.id, active: true })
      .returning();
    await db.insert(schema.inventory).values({
      companyId: noEligCompanyId,
      locationId: dest,
      stockItemId: destItem.id,
      quantity: "50",
      averageRate: "10.00",
      totalValue: "500.00",
    });

    // Sources only carry a *different* stock group — nothing matches the
    // destination's group, so no eligible stock exists anywhere.
    for (const [idx, srcLoc] of [src1, src2, src3, src4].entries()) {
      const [srcItem] = await db
        .insert(schema.stockItems)
        .values({
          companyId: noEligCompanyId,
          code: `${p}-SRC${idx + 1}`,
          name: `Source Item ${idx + 1}`,
          uom: "PCS",
          stockGroupId: groupSrc.id,
          active: true,
        })
        .returning();
      await db.insert(schema.inventory).values({
        companyId: noEligCompanyId,
        locationId: srcLoc,
        stockItemId: srcItem.id,
        quantity: "100",
        averageRate: "10.00",
        totalValue: "1000.00",
      });
    }

    // Also seed Kolwezi 2 with the dest group so we can confirm it's never used as a fallback source.
    const [kolwezi2Item] = await db
      .insert(schema.stockItems)
      .values({ companyId: noEligCompanyId, code: `${p}-KLW2-1`, name: "Kolwezi2 Item", uom: "PCS", stockGroupId: groupDest.id, active: true })
      .returning();
    await db.insert(schema.inventory).values({
      companyId: noEligCompanyId,
      locationId: kolwezi2Loc,
      stockItemId: kolwezi2Item.id,
      quantity: "200",
      averageRate: "10.00",
      totalValue: "2000.00",
    });
  });

  afterAll(async () => {
    await db.delete(schema.inventory).where(eq(schema.inventory.companyId, noEligCompanyId));
    await db.delete(schema.stockItems).where(eq(schema.stockItems.companyId, noEligCompanyId));
    await db.delete(schema.stockGroups).where(eq(schema.stockGroups.companyId, noEligCompanyId));
    await db.delete(schema.locations).where(eq(schema.locations.companyId, noEligCompanyId));
    await db.delete(schema.companies).where(eq(schema.companies.id, noEligCompanyId));
  });

  it("returns a clear no-eligible-stock message and no draft", async () => {
    const result = await chat(NO_ELIGIBLE_MESSAGE, noEligCompanyId);
    expect(result.stockTransferDraft).toBeFalsy();
    expect(result.stockTransferDrafts).toBeFalsy();
    expect(result.response.toLowerCase()).toMatch(/no eligible stock|no draft was created|didn't find any stock/);
  });
});
