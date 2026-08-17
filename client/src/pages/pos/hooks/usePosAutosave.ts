import { useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { upsertPosDraftSummary } from "@/api/posApi";
import type { PosAutoSaveState } from "../pos-components/posTypes";

interface PosAutosaveParams {
  autoSaveStateRef: React.MutableRefObject<PosAutoSaveState>;
  autoSaveInProgressRef: React.MutableRefObject<boolean>;
  lastSavedFingerprintRef: React.MutableRefObject<string>;
  setCurrentDraftId: (id: number | null) => void;
  setLastAutosaved: (date: Date | null) => void;
  refetchDrafts?: () => void;
}

export function usePosAutosave({
  autoSaveStateRef,
  autoSaveInProgressRef,
  lastSavedFingerprintRef,
  setCurrentDraftId,
  setLastAutosaved,
}: PosAutosaveParams) {
  useEffect(() => {
    let sessionLost = false;

    const interval = setInterval(async () => {
      if (sessionLost) return;
      const s = autoSaveStateRef.current;
      if (!s.activeLocation) return;
      if (autoSaveInProgressRef.current || s.saveDraftIsPending) return;
      const validItems = s.rows.filter((r) => r.stockItemId && r.quantity > 0 && r.rate > 0);
      if (validItems.length === 0) return;
      const fingerprint = JSON.stringify({
        items: validItems.map((r) => ({ id: r.stockItemId, qty: r.quantity, rate: r.rate })),
        notes: s.notes,
        isCreditSale: s.isCreditSale,
        paymentAccountType: s.paymentAccountType,
        paymentAccountId: s.paymentAccountId,
        selectedCustomerId: s.selectedCustomerId,
      });
      if (fingerprint === lastSavedFingerprintRef.current) return;
      autoSaveInProgressRef.current = true;
      try {
        const draftData = {
          locationId: s.activeLocation.id,
          paymentAccountType: s.isCreditSale ? "credit" : s.paymentAccountType,
          paymentAccountId: s.isCreditSale
            ? s.selectedCustomerId
              ? parseInt(s.selectedCustomerId)
              : null
            : s.paymentAccountId
              ? parseInt(s.paymentAccountId)
              : null,
          isCreditSale: s.isCreditSale,
          notes: s.notes,
          items: validItems.map((row) => ({
            stockItemId: row.stockItemId,
            quantity: row.quantity.toString(),
            rate: row.rate.toString(),
            amount: row.amount.toString(),
          })),
        };
        let data;
        if (s.currentDraftId) {
          const res = await apiRequest("PATCH", `/api/pos/drafts/${s.currentDraftId}`, draftData);
          data = await res.json();
        } else {
          const res = await apiRequest("POST", "/api/pos/drafts", draftData);
          data = await res.json();
        }
        if (data?.id) setCurrentDraftId(data.id);
        upsertPosDraftSummary(s.activeLocation.id, data, draftData.items);
        lastSavedFingerprintRef.current = fingerprint;
        setLastAutosaved(new Date());
      } catch (err: unknown) {
        if (err && typeof err === "object" && "status" in err && err.status === 401) {
          sessionLost = true;
        }
      } finally {
        autoSaveInProgressRef.current = false;
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [autoSaveInProgressRef, autoSaveStateRef, lastSavedFingerprintRef, setCurrentDraftId, setLastAutosaved]);
}
