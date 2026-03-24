import { useState, useEffect, useCallback, useRef } from "react";
import {
  saveDraft,
  loadDraft,
  deleteDraft,
  getDraftAge,
  type DraftRecord,
} from "@/lib/offlineDraft";

interface UseFormDraftOptions {
  entityType: string;
  mode: "erp" | "pos" | "factory";
  companyId: number | null;
  locationId?: number | null;
  debounceMs?: number;
  enabled?: boolean;
}

interface UseFormDraftReturn {
  draft: DraftRecord | null;
  draftAge: string | null;
  hasDraft: boolean;
  isSaving: boolean;
  saveNow: (data: unknown) => Promise<void>;
  scheduleSave: (data: unknown) => void;
  discardDraft: () => Promise<void>;
}

export function useFormDraft({
  entityType,
  mode,
  companyId,
  locationId = null,
  debounceMs = 1500,
  enabled = true,
}: UseFormDraftOptions): UseFormDraftReturn {
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDataRef = useRef<unknown>(null);

  useEffect(() => {
    if (!enabled || companyId === null) return;
    let cancelled = false;
    loadDraft(entityType, mode, companyId, locationId).then((d) => {
      if (!cancelled) setDraft(d);
    });
    return () => { cancelled = true; };
  }, [entityType, mode, companyId, locationId, enabled]);

  const saveNow = useCallback(async (data: unknown) => {
    if (!enabled || companyId === null) return;
    setIsSaving(true);
    const label = `${entityType} draft`;
    await saveDraft(entityType, mode, data, label, companyId, locationId);
    const updated = await loadDraft(entityType, mode, companyId, locationId);
    setDraft(updated);
    setIsSaving(false);
  }, [entityType, mode, companyId, locationId, enabled]);

  const scheduleSave = useCallback((data: unknown) => {
    if (!enabled || companyId === null) return;
    latestDataRef.current = data;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveNow(latestDataRef.current);
    }, debounceMs);
  }, [saveNow, debounceMs, enabled, companyId]);

  const discardDraft = useCallback(async () => {
    if (draft?.id !== undefined) {
      await deleteDraft(draft.id);
      setDraft(null);
    }
  }, [draft]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const draftAge = draft ? getDraftAge(draft.savedAt) : null;

  return {
    draft,
    draftAge,
    hasDraft: draft !== null,
    isSaving,
    saveNow,
    scheduleSave,
    discardDraft,
  };
}
