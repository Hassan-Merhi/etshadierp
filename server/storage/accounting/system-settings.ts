import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

export async function getSystemSetting(key: string): Promise<schema.SystemSetting | undefined> {
  const [setting] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, key));
  return setting;
}

export async function setSystemSetting(key: string, value: string | null): Promise<schema.SystemSetting> {
  const existing = await getSystemSetting(key);
  if (existing) {
    const [updated] = await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: sql`now()` })
      .where(eq(schema.systemSettings.key, key))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(schema.systemSettings).values({ key, value }).returning();
    return created;
  }
}

let _parentCompanyIdCache: { value: number | null; expiresAt: number } | null = null;
const _PARENT_ID_TTL_MS = 5 * 60 * 1000;

export async function getParentCompanyId(): Promise<number | null> {
  const now = Date.now();
  if (_parentCompanyIdCache && now < _parentCompanyIdCache.expiresAt) {
    return _parentCompanyIdCache.value;
  }
  const setting = await getSystemSetting("parentCompanyId");
  const value = setting?.value ? parseInt(setting.value, 10) || null : null;
  _parentCompanyIdCache = { value, expiresAt: now + _PARENT_ID_TTL_MS };
  return value;
}

export async function setParentCompanyId(companyId: number | null): Promise<void> {
  _parentCompanyIdCache = null;
  await setSystemSetting("parentCompanyId", companyId?.toString() ?? null);
}

// ---------------------------------------------------------------------------
// Spreadsheets
// ---------------------------------------------------------------------------
