import { db } from "./db";
import type { LocalDraft } from "./db";

export interface DraftRecord {
  id: number;
  entityType: string;
  mode: "erp" | "pos" | "factory";
  data: unknown;
  label: string;
  companyId: number | null;
  locationId: number | null;
  savedAt: number;
}

export async function saveDraft(
  entityType: string,
  mode: "erp" | "pos" | "factory",
  data: unknown,
  label: string,
  companyId: number | null,
  locationId: number | null = null
): Promise<void> {
  try {
    const now = Date.now();
    const existing = await db.localDrafts
      .where("entityType")
      .equals(entityType)
      .filter((r) => r.mode === mode && r.companyId === companyId && r.locationId === locationId)
      .first()
      .catch(() => null);

    if (existing?.id !== undefined) {
      await db.localDrafts.update(existing.id, {
        data: JSON.stringify(data),
        label,
        updatedAt: now,
      });
    } else {
      const record: LocalDraft = {
        entityType,
        mode,
        data: JSON.stringify(data),
        label,
        companyId,
        locationId,
        createdAt: now,
        updatedAt: now,
      };
      await db.localDrafts.add(record);
    }
  } catch (err) {
    console.warn("[offlineDraft] save failed", err);
  }
}

export async function loadDraft(
  entityType: string,
  mode: "erp" | "pos" | "factory",
  companyId: number | null,
  locationId: number | null = null
): Promise<DraftRecord | null> {
  try {
    const record = await db.localDrafts
      .where("entityType")
      .equals(entityType)
      .filter((r) => r.mode === mode && r.companyId === companyId && r.locationId === locationId)
      .first()
      .catch(() => null);

    if (!record || record.id === undefined) return null;
    return {
      id: record.id,
      entityType: record.entityType,
      mode: record.mode,
      data: JSON.parse(record.data),
      label: record.label,
      companyId: record.companyId,
      locationId: record.locationId,
      savedAt: record.updatedAt,
    };
  } catch (err) {
    console.warn("[offlineDraft] load failed", err);
    return null;
  }
}

export async function deleteDraft(id: number): Promise<void> {
  try {
    await db.localDrafts.delete(id);
  } catch (err) {
    console.warn("[offlineDraft] delete failed", err);
  }
}

export function getDraftAge(savedAt: number): string {
  const diffMs = Date.now() - savedAt;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
