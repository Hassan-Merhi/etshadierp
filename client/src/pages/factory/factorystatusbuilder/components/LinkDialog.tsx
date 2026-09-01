/**
 * LinkDialog — extracted sub-component.
 *
 * Extracted from FactoryStatusBuilder.tsx during the Phase 4 god-file split.
 */
import {useState, useEffect} from "react";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from "@/components/ui/dialog";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";

import type {LinkDialogState, StatusBuilderSheet} from "../types";
import {fmt, resolveCellValue} from "../utils";

export function LinkDialog({
  state, sheets, onClose, onSave,
}: {
  state: LinkDialogState;
  sheets: StatusBuilderSheet[];
  onClose: () => void;
  onSave: (sourceSheetId: string, sourceRowId: string, sourceColId: string) => void;
}) {
  const [selSheetId, setSelSheetId] = useState("");
  const [selRowId, setSelRowId] = useState("");
  const [selColId, setSelColId] = useState("");

  useEffect(() => {
    if (state.open) {
      setSelSheetId(state.sourceSheetId || sheets[0]?.stableId || "");
      setSelRowId(state.sourceRowId || "");
      setSelColId(state.sourceColId || "");
    }
  
  }, [sheets, state.open, state.sourceColId, state.sourceRowId, state.sourceSheetId]);

  const srcSheet = sheets.find((s) => s.stableId === selSheetId);

  let previewLabel = "—";
  let previewVal = "—";
  if (selSheetId && selRowId && selColId) {
    const res = resolveCellValue(sheets, selSheetId, selRowId, selColId);
    if (res.broken) { previewVal = "#REF!"; previewLabel = "Missing source"; }
    else if (res.circular) { previewVal = "#CYCLE!"; previewLabel = "Circular reference"; }
    else if (res.value !== null) previewVal = fmt(res.value);

    const sCol = srcSheet?.columns.find((c) => c.id === selColId);
    if (selRowId === "__diff__") {
      previewLabel = `${srcSheet?.name} → Difference (auto) → ${sCol?.label || "(col)"}`;
    } else {
      const sRow = srcSheet?.rows.find((r) => r.id === selRowId);
      if (sRow && sCol) previewLabel = `${srcSheet?.name} → ${sRow.label || "(row)"} → ${sCol.label || "(col)"}`;
    }
  }

  const canSave = !!selSheetId && !!selRowId && !!selColId;

  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link Cell</DialogTitle>
          <DialogDescription>
            Choose the source page, row, and column to pull data from.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Source Page</label>
            <Select
              value={selSheetId}
              onValueChange={(v) => { setSelSheetId(v); setSelRowId(""); setSelColId(""); }}
            >
              <SelectTrigger data-testid="sb-select-link-sheet">
                <SelectValue placeholder="Select page…" />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((s) => (
                  <SelectItem key={s.stableId} value={s.stableId}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Source Row</label>
            <Select
              value={selRowId}
              onValueChange={(v) => { setSelRowId(v); setSelColId(""); }}
              disabled={!srcSheet}
            >
              <SelectTrigger data-testid="sb-select-link-row">
                <SelectValue placeholder={srcSheet ? "Select row…" : "Select page first"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__diff__">Difference (auto-calculated)</SelectItem>
                {srcSheet?.rows.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label || "(row)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Source Column</label>
            <Select
              value={selColId}
              onValueChange={setSelColId}
              disabled={!selRowId}
            >
              <SelectTrigger data-testid="sb-select-link-col">
                <SelectValue placeholder={selRowId ? "Select column…" : "Select row first"} />
              </SelectTrigger>
              <SelectContent>
                {srcSheet?.columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label || "(col)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selColId && (
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground mb-1">{previewLabel}</p>
              <p className={`text-sm font-mono font-medium ${previewVal === "#REF!" || previewVal === "#CYCLE!" ? "text-red-500" : ""}`}>
                {previewVal}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="sb-button-link-cancel">Cancel</Button>
          <Button onClick={() => onSave(selSheetId, selRowId, selColId)} disabled={!canSave} data-testid="sb-button-link-save">
            Save Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
