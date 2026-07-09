import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LayoutGrid,
  Plus,
  Save,
  FileDown,
  Upload,
  Download,
  X,
  Link2,
  Link2Off,
  Pencil,
  Trash2,
  Search,
  History as HistoryIcon,
  LayoutList,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type CellValue = number | string | null;

interface CellLink {
  type: "status_builder_cell";
  sourceSheetId: string;
  sourceRowId: string;
  sourceColumnId: string;
}

interface Cell {
  value: CellValue;
  link?: CellLink | null;
}

interface ColumnDef {
  id: string;
  label: string;
}

interface SheetRow {
  id: string;
  label: string;
  cells: Cell[];
}

interface StatusBuilderSheet {
  id: number | null;
  stableId: string;
  name: string;
  columns: ColumnDef[];
  rows: SheetRow[];
  lockedColumns: number[];
  dirty: boolean;
  footerMode: "diff" | "total";
}

interface ApiSheet {
  id: number;
  companyId: number;
  name: string;
  orderIndex: number;
  columns: any[];
  rows: any[];
  updatedAt: string;
}

interface LinkDialogState {
  open: boolean;
  targetRowIdx: number;
  targetColIdx: number;
  sourceSheetId: string;
  sourceRowId: string;
  sourceColId: string;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function fromApiSheet(s: ApiSheet): StatusBuilderSheet {
  const rawCols: any[] = Array.isArray(s.columns) ? s.columns : [];
  const rawRows: any[] = Array.isArray(s.rows) ? s.rows : [];

  const columns: ColumnDef[] = rawCols.map((c: any, i: number) => {
    if (typeof c === "string") return { id: `col_${makeId()}`, label: c };
    return { id: c.id ?? `col_${i}`, label: c.label ?? "" };
  });

  const rows: SheetRow[] = rawRows.map((r: any, ri: number) => {
    const rawCells: any[] = Array.isArray(r.cells) ? r.cells : [];
    const cells: Cell[] = rawCells.map((c: any) => {
      if (c === null || c === undefined) return { value: null };
      if (typeof c === "number" || typeof c === "string") return { value: c };
      if (typeof c === "object" && "value" in c) {
        return { value: c.value ?? null, link: c.link ?? null };
      }
      return { value: null };
    });
    while (cells.length < columns.length) cells.push({ value: null });
    return {
      id: r.id ?? `row_${ri}`,
      label: r.label ?? "",
      cells,
    };
  });

  return {
    id: s.id,
    stableId: `sheet_${s.id}`,
    name: s.name,
    columns,
    rows,
    lockedColumns: [],
    dirty: false,
    footerMode: "diff",
  };
}

// ── Cell link resolution ──────────────────────────────────────────────────────

function resolveCellValue(
  sheets: StatusBuilderSheet[],
  sheetId: string,
  rowId: string,
  colId: string,
  visited: Set<string> = new Set()
): { value: CellValue; broken: boolean; circular: boolean } {
  const key = `${sheetId}|${rowId}|${colId}`;
  if (visited.has(key)) return { value: null, broken: false, circular: true };
  visited.add(key);

  const sheet = sheets.find((s) => s.stableId === sheetId);
  if (!sheet) return { value: null, broken: true, circular: false };

  if (rowId === "__diff__") {
    const colIdx = sheet.columns.findIndex((c) => c.id === colId);
    if (colIdx === -1) return { value: null, broken: true, circular: false };
    const diffVals = calcDiff(sheets, sheet);
    return { value: diffVals[colIdx], broken: false, circular: false };
  }

  const row = sheet.rows.find((r) => r.id === rowId);
  if (!row) return { value: null, broken: true, circular: false };

  const colIdx = sheet.columns.findIndex((c) => c.id === colId);
  if (colIdx === -1) return { value: null, broken: true, circular: false };

  const cell = row.cells[colIdx] ?? { value: null };
  if (cell.link) {
    return resolveCellValue(
      sheets,
      cell.link.sourceSheetId,
      cell.link.sourceRowId,
      cell.link.sourceColumnId,
      new Set(visited)
    );
  }
  return { value: cell.value, broken: false, circular: false };
}

function getEffectiveValue(sheets: StatusBuilderSheet[], cell: Cell): CellValue {
  if (!cell.link) return cell.value;
  const res = resolveCellValue(sheets, cell.link.sourceSheetId, cell.link.sourceRowId, cell.link.sourceColumnId);
  if (res.broken || res.circular) return null;
  return res.value;
}

function isDiffColumn(label: string): boolean {
  const l = label.trim().toUpperCase();
  return l === "DIFF" || l === "DIFFERENCE" || l === "فرق";
}

function isTotalColumn(label: string): boolean {
  const l = label.trim().toUpperCase();
  return l === "TOTAL" || l === "TOTALE" || l === "ИТОГО" || l === "مجموع";
}

function computeDiffValue(colLabels: string[], resolvedVals: (number | null)[], ci: number): number | null {
  const leftNonDiff: number[] = [];
  for (let i = ci - 1; i >= 0 && leftNonDiff.length < 2; i--) {
    if (!isDiffColumn(colLabels[i])) leftNonDiff.unshift(i);
  }
  if (leftNonDiff.length < 2) return null;
  const a = resolvedVals[leftNonDiff[0]];
  const b = resolvedVals[leftNonDiff[1]];
  if (typeof a !== "number" || typeof b !== "number") return null;
  return a - b;
}

// Sum of all base (non-total, non-diff) columns in the same resolved-values array
function computeTotalValue(colLabels: string[], resolvedVals: (number | null)[]): number | null {
  let sum: number | null = null;
  for (let i = 0; i < colLabels.length; i++) {
    if (isDiffColumn(colLabels[i]) || isTotalColumn(colLabels[i])) continue;
    const v = resolvedVals[i];
    if (typeof v === "number") sum = (sum ?? 0) + v;
  }
  return sum;
}

function calcDiff(sheets: StatusBuilderSheet[], sheet: StatusBuilderSheet): (number | null)[] {
  const colLabels = sheet.columns.map((c) => c.label);
  const colCount = sheet.columns.length;
  const totals: (number | null)[] = Array(colCount).fill(null);

  // First pass: sum base columns
  for (const row of sheet.rows) {
    for (let c = 0; c < colCount; c++) {
      if (isDiffColumn(colLabels[c]) || isTotalColumn(colLabels[c])) continue;
      const cell = row.cells[c] ?? { value: null };
      const eff = getEffectiveValue(sheets, cell);
      if (typeof eff === "number") totals[c] = (totals[c] ?? 0) + eff;
    }
  }
  // Second pass: compute derived columns
  for (let c = 0; c < colCount; c++) {
    if (isTotalColumn(colLabels[c])) {
      totals[c] = computeTotalValue(colLabels, totals);
    } else if (isDiffColumn(colLabels[c])) {
      totals[c] = computeDiffValue(colLabels, totals, c);
    }
  }
  return totals;
}

function calcTotal(sheets: StatusBuilderSheet[], sheet: StatusBuilderSheet): (number | null)[] {
  const colLabels = sheet.columns.map((c) => c.label);
  const colCount = sheet.columns.length;
  const totals: (number | null)[] = Array(colCount).fill(null);
  for (const row of sheet.rows) {
    for (let c = 0; c < colCount; c++) {
      if (isDiffColumn(colLabels[c]) || isTotalColumn(colLabels[c])) continue;
      const cell = row.cells[c] ?? { value: null };
      const eff = getEffectiveValue(sheets, cell);
      if (typeof eff === "number") totals[c] = (totals[c] ?? 0) + eff;
    }
  }
  // Compute derived columns for the total row
  for (let c = 0; c < colCount; c++) {
    if (isTotalColumn(colLabels[c])) {
      totals[c] = computeTotalValue(colLabels, totals);
    }
  }
  return totals;
}

function fmt(v: CellValue | "#REF!" | "#CYCLE!" | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function parseCellValue(s: string): CellValue {
  if (!s?.trim()) return null;
  const trimmed = s.trim();
  if (trimmed === "-") return "-";
  const n = Number(trimmed.replace(/,/g, ""));
  if (!isNaN(n)) return n;
  return s;
}

// ── Tab component ─────────────────────────────────────────────────────────────

function TabLabel({
  name,
  active,
  onActivate,
  onRename,
  onDelete,
  canDelete,
}: {
  name: string;
  active: boolean;
  onActivate: () => void;
  onRename: (v: string) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) onRename(v);
    else setDraft(name);
    setEditing(false);
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div
      data-testid={`sb-tab-${name}`}
      onClick={onActivate}
      onDoubleClick={() => {
        setEditing(true);
        setDraft(name);
      }}
      className={`relative flex items-center gap-1.5 px-3 py-2 cursor-pointer border-b-2 select-none whitespace-nowrap transition-colors
        ${
          active
            ? "border-primary text-foreground font-medium"
            : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
        }`}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="bg-transparent border-none outline-none w-24 text-sm font-medium"
          data-testid={`sb-tab-input-${name}`}
        />
      ) : (
        <span className="text-sm">{name}</span>
      )}
      {active && canDelete && (
        <button
          data-testid={`sb-tab-delete-${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-1 rounded-sm opacity-60 hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
          style={{ visibility: "visible" }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Link Dialog ────────────────────────────────────────────────────────────────

function LinkDialog({
  state,
  sheets,
  onClose,
  onSave,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open]);

  const srcSheet = sheets.find((s) => s.stableId === selSheetId);

  let previewLabel = "—";
  let previewVal = "—";
  if (selSheetId && selRowId && selColId) {
    const res = resolveCellValue(sheets, selSheetId, selRowId, selColId);
    if (res.broken) {
      previewVal = "#REF!";
      previewLabel = "Missing source";
    } else if (res.circular) {
      previewVal = "#CYCLE!";
      previewLabel = "Circular reference";
    } else if (res.value !== null) previewVal = fmt(res.value);

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
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link Cell</DialogTitle>
          <DialogDescription>Choose the source page, row, and column to pull data from.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Source Page</label>
            <Select
              value={selSheetId}
              onValueChange={(v) => {
                setSelSheetId(v);
                setSelRowId("");
                setSelColId("");
              }}
            >
              <SelectTrigger data-testid="sb-select-link-sheet">
                <SelectValue placeholder="Select page…" />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((s) => (
                  <SelectItem key={s.stableId} value={s.stableId}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Source Row</label>
            <Select
              value={selRowId}
              onValueChange={(v) => {
                setSelRowId(v);
                setSelColId("");
              }}
              disabled={!srcSheet}
            >
              <SelectTrigger data-testid="sb-select-link-row">
                <SelectValue placeholder={srcSheet ? "Select row…" : "Select page first"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__diff__">Difference (auto-calculated)</SelectItem>
                {srcSheet?.rows.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label || "(row)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Source Column</label>
            <Select value={selColId} onValueChange={setSelColId} disabled={!selRowId}>
              <SelectTrigger data-testid="sb-select-link-col">
                <SelectValue placeholder={selRowId ? "Select column…" : "Select row first"} />
              </SelectTrigger>
              <SelectContent>
                {srcSheet?.columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label || "(col)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selColId && (
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground mb-1">{previewLabel}</p>
              <p
                className={`text-sm font-mono font-medium ${previewVal === "#REF!" || previewVal === "#CYCLE!" ? "text-red-500" : ""}`}
              >
                {previewVal}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="sb-button-link-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => onSave(selSheetId, selRowId, selColId)}
            disabled={!canSave}
            data-testid="sb-button-link-save"
          >
            Save Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Row editor (replaces inline Excel-style cell typing) ────────────────────

function RowEditDialog({
  sheet,
  sheets,
  rowIdx,
  onClose,
  onLabelChange,
  onCellChange,
  onOpenLink,
  onUnlink,
  onDelete,
  fmtLabel,
}: {
  sheet: StatusBuilderSheet | null;
  sheets: StatusBuilderSheet[];
  rowIdx: number | null;
  onClose: () => void;
  onLabelChange: (rowIdx: number, val: string) => void;
  onCellChange: (rowIdx: number, colIdx: number, val: string) => void;
  onOpenLink: (rowIdx: number, colIdx: number) => void;
  onUnlink: (rowIdx: number, colIdx: number) => void;
  onDelete: (rowIdx: number, label: string) => void;
  fmtLabel: (v: string) => string;
}) {
  const row = rowIdx !== null ? sheet?.rows[rowIdx] : undefined;
  const open = rowIdx !== null && !!row;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit row</DialogTitle>
          <DialogDescription>Update the label and values, or link a value to another page.</DialogDescription>
        </DialogHeader>
        {row && sheet && (
          <div className="space-y-4 py-1 max-h-[60vh] overflow-y-auto">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Label</label>
              <Input
                value={fmtLabel(row.label)}
                onChange={(e) => onLabelChange(rowIdx!, e.target.value)}
                data-testid="sb-modal-input-row-label"
                dir="auto"
              />
            </div>
            {sheet.columns.map((col, ci) => {
              const isDiff = isDiffColumn(col.label);
              const isTotal = isTotalColumn(col.label);
              if (isDiff || isTotal) return null;
              const cell = row.cells[ci] ?? { value: null };
              const isLinked = !!cell.link;
              let linkInfo: string | null = null;
              let broken = false;
              if (isLinked) {
                const res = resolveCellValue(
                  sheets,
                  cell.link!.sourceSheetId,
                  cell.link!.sourceRowId,
                  cell.link!.sourceColumnId
                );
                broken = res.broken || res.circular;
                const srcSheet = sheets.find((s) => s.stableId === cell.link!.sourceSheetId);
                const srcRow = srcSheet?.rows.find((r) => r.id === cell.link!.sourceRowId);
                const srcCol = srcSheet?.columns.find((c) => c.id === cell.link!.sourceColumnId);
                if (srcSheet && srcCol) {
                  linkInfo = `${srcSheet.name} → ${cell.link!.sourceRowId === "__diff__" ? "Difference" : srcRow?.label || "(row)"} → ${srcCol.label}`;
                }
              }
              return (
                <div key={col.id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">{col.label || "(column)"}</label>
                    <button
                      type="button"
                      onClick={() => (isLinked ? onUnlink(rowIdx!, ci) : onOpenLink(rowIdx!, ci))}
                      className={`text-xs flex items-center gap-1 ${broken ? "text-red-500" : isLinked ? "text-blue-500" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid={`sb-modal-link-toggle-${ci}`}
                    >
                      {broken ? <Link2Off className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                      {isLinked ? "Unlink" : "Link to another page"}
                    </button>
                  </div>
                  {isLinked ? (
                    <div
                      className={`h-9 flex items-center px-3 rounded-md border bg-muted/40 text-sm ${broken ? "text-red-500" : ""}`}
                      title={linkInfo ?? ""}
                    >
                      {broken ? "#REF! — " : ""}
                      {linkInfo ?? "Linked"}
                    </div>
                  ) : (
                    <Input
                      value={fmt(cell.value)}
                      onChange={(e) => onCellChange(rowIdx!, ci, e.target.value)}
                      data-testid={`sb-modal-input-cell-${ci}`}
                      dir="auto"
                    />
                  )}
                  {isLinked && (
                    <button
                      type="button"
                      onClick={() => onOpenLink(rowIdx!, ci)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Change link…
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive gap-1.5"
            onClick={() => rowIdx !== null && row && onDelete(rowIdx, fmtLabel(row.label) || `Row ${rowIdx + 1}`)}
            data-testid="sb-modal-button-delete-row"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete row
          </Button>
          <Button onClick={onClose} data-testid="sb-modal-button-done">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FactoryStatusBuilder() {
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [localSheets, setLocalSheets] = useState<StatusBuilderSheet[]>([]);
  const [initialised, setInitialised] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentSaveRef = useRef(false);

  const [linkDialog, setLinkDialog] = useState<LinkDialogState>({
    open: false,
    targetRowIdx: 0,
    targetColIdx: 0,
    sourceSheetId: "",
    sourceRowId: "",
    sourceColId: "",
  });

  const [pendingDelete, setPendingDelete] = useState<{
    type: "row" | "col" | "page";
    idx: number;
    label: string;
  } | null>(null);

  // ── Card-UI state ──────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<"cards" | "history">("cards");
  const [search, setSearch] = useState("");
  const [primaryColIdx, setPrimaryColIdx] = useState(0);
  const [editRowIdx, setEditRowIdx] = useState<number | null>(null);
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);

  const fmtLabel = useCallback(
    (label: string): string => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return formatDisplayDate(label);
      return label;
    },
    [formatDisplayDate]
  );

  // ── Load ───────────────────────────────────────────────────────────────────
  const { data: apiSheets, isLoading } = useQuery<ApiSheet[]>({
    queryKey: ["/api/factory/status-builder/sheets"],
  });

  useEffect(() => {
    if (apiSheets && !initialised) {
      setLocalSheets(apiSheets.map(fromApiSheet));
      setInitialised(true);
    }
  }, [apiSheets, initialised]);

  const activeSheet = localSheets[activeIdx] ?? null;
  const isDirty = localSheets.some((s) => s.dirty);

  // History log for the active page.
  const { data: historyLog, isLoading: historyLoading } = useQuery<
    Array<{
      id: number;
      sheetId: number;
      sheetName: string;
      rowLabel: string;
      columnLabel: string;
      oldValue: string | null;
      newValue: string | null;
      changedBy: string | null;
      createdAt: string;
    }>
  >({
    queryKey: ["/api/factory/status-builder/log", activeSheet?.id],
    queryFn: () =>
      apiRequest("GET", `/api/factory/status-builder/log?sheetId=${activeSheet?.id}&limit=200`).then((r) =>
        r.json()
      ),
    enabled: viewMode === "history" && !!activeSheet?.id,
  });

  // Reset the "primary" (headline) column whenever the active page changes,
  // and clamp it back in range whenever columns are added/removed so the
  // segmented control never points at a column that no longer exists.
  useEffect(() => {
    setPrimaryColIdx(0);
  }, [activeIdx]);

  useEffect(() => {
    const colCount = activeSheet?.columns.length ?? 0;
    if (colCount === 0) return;
    if (primaryColIdx >= colCount) {
      setPrimaryColIdx(colCount - 1);
    }
  }, [activeSheet?.columns.length, primaryColIdx]);

  // ── Autosave ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const hasSaveable = localSheets.some((s) => s.dirty && s.id !== null);
    if (!hasSaveable) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      silentSaveRef.current = true;
      saveMutation.mutate(localSheets);
    }, 2000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSheets]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const updateSheet = useCallback(
    (fn: (s: StatusBuilderSheet) => StatusBuilderSheet) => {
      setLocalSheets((prev) => {
        const next = [...prev];
        next[activeIdx] = { ...fn(next[activeIdx]), dirty: true };
        return next;
      });
    },
    [activeIdx]
  );

  // ── Link operations ────────────────────────────────────────────────────────
  const openLinkDialog = useCallback(
    (rowIdx: number, colIdx: number) => {
      const cell = activeSheet?.rows[rowIdx]?.cells[colIdx] ?? { value: null };
      setLinkDialog({
        open: true,
        targetRowIdx: rowIdx,
        targetColIdx: colIdx,
        sourceSheetId: cell.link?.sourceSheetId ?? "",
        sourceRowId: cell.link?.sourceRowId ?? "",
        sourceColId: cell.link?.sourceColumnId ?? "",
      });
    },
    [activeSheet]
  );

  const handleSaveLink = useCallback(
    (sourceSheetId: string, sourceRowId: string, sourceColId: string) => {
      const { targetRowIdx, targetColIdx } = linkDialog;
      updateSheet((s) => {
        const rows = s.rows.map((r, ri) => {
          if (ri !== targetRowIdx) return r;
          const cells = [...r.cells];
          const existing = cells[targetColIdx] ?? { value: null };
          cells[targetColIdx] = {
            ...existing,
            link: { type: "status_builder_cell", sourceSheetId, sourceRowId, sourceColumnId: sourceColId },
          };
          return { ...r, cells };
        });
        return { ...s, rows };
      });
      setLinkDialog((prev) => ({ ...prev, open: false }));
    },
    [linkDialog, updateSheet]
  );

  const unlinkCell = useCallback(
    (rowIdx: number, colIdx: number) => {
      updateSheet((s) => {
        const rows = s.rows.map((r, ri) => {
          if (ri !== rowIdx) return r;
          const cells = [...r.cells];
          const existing = cells[colIdx] ?? { value: null };
          cells[colIdx] = { value: existing.value, link: null };
          return { ...r, cells };
        });
        return { ...s, rows };
      });
    },
    [updateSheet]
  );

  const copyLinkValueAsManual = useCallback(
    (rowIdx: number, colIdx: number) => {
      const sheet = localSheets[activeIdx];
      if (!sheet) return;
      const cell = sheet.rows[rowIdx]?.cells[colIdx];
      if (!cell?.link) return;
      const resolved = resolveCellValue(
        localSheets,
        cell.link.sourceSheetId,
        cell.link.sourceRowId,
        cell.link.sourceColumnId
      );
      updateSheet((s) => {
        const rows = s.rows.map((r, ri) => {
          if (ri !== rowIdx) return r;
          const cells = [...r.cells];
          cells[colIdx] = {
            value: resolved.broken || resolved.circular ? null : (resolved.value as CellValue),
            link: null,
          };
          return { ...r, cells };
        });
        return { ...s, rows };
      });
    },
    [localSheets, activeIdx, updateSheet]
  );

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/factory/status-builder/sheets", { name }).then((r) => r.json()),
    onSuccess: (created: ApiSheet) => {
      setLocalSheets((prev) => [...prev, fromApiSheet(created)]);
      setActiveIdx((prev) => prev + 1);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/status-builder/sheets"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async (sheets: StatusBuilderSheet[]) => {
      const dirty = sheets.filter((s) => s.dirty && s.id !== null);
      await Promise.all(
        dirty.map((s) =>
          apiRequest("PUT", `/api/factory/status-builder/sheets/${s.id}`, {
            name: s.name,
            columns: s.columns,
            rows: s.rows.map((r) => ({
              id: r.id,
              label: r.label,
              cells: r.cells.map((c) => (c.link ? { value: c.value, link: c.link } : c.value)),
            })),
          })
        )
      );
    },
    onSuccess: () => {
      setLocalSheets((prev) => prev.map((s) => ({ ...s, dirty: false })));
      queryClient.invalidateQueries({ queryKey: ["/api/factory/status-builder/sheets"] });
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      if (!silentSaveRef.current) toast({ title: "Saved", description: "All pages saved." });
      silentSaveRef.current = false;
    },
    onError: (e: any) => {
      silentSaveRef.current = false;
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/factory/status-builder/sheets/${id}`),
    onSuccess: (_data, id) => {
      setLocalSheets((prev) => prev.filter((s) => s.id !== id));
      setActiveIdx((prev) => Math.max(0, prev - 1));
      queryClient.invalidateQueries({ queryKey: ["/api/factory/status-builder/sheets"] });
      toast({ title: "Page deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return fetch("/api/factory/status-builder/sheets/import", {
        method: "POST",
        credentials: "include",
        body: fd,
      }).then(async (r) => {
        if (!r.ok) {
          const t = await r.text();
          try {
            throw new Error(JSON.parse(t).message);
          } catch {
            throw new Error(t);
          }
        }
        return r.json() as Promise<ApiSheet[]>;
      });
    },
    onSuccess: (sheets: ApiSheet[]) => {
      setLocalSheets(sheets.map(fromApiSheet));
      setActiveIdx(0);
      setInitialised(true);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/status-builder/sheets"] });
      toast({ title: "Imported", description: `${sheets.length} page(s) imported.` });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const handleExport = () => window.open("/api/factory/status-builder/sheets/export", "_blank");

  // ── Tab operations ─────────────────────────────────────────────────────────
  const addTab = () => createMutation.mutate(`Page ${localSheets.length + 1}`);

  const renameTab = (idx: number, newName: string) => {
    setLocalSheets((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], name: newName, dirty: true };
      return next;
    });
  };

  const deleteTab = (idx: number) => {
    const s = localSheets[idx];
    if (!s) return;
    setPendingDelete({ type: "page", idx, label: s.name });
  };

  // ── Column operations ──────────────────────────────────────────────────────
  const addColumn = () => {
    updateSheet((s) => ({
      ...s,
      columns: [...s.columns, { id: `col_${makeId()}`, label: `Col ${s.columns.length + 1}` }],
      rows: s.rows.map((r) => ({ ...r, cells: [...r.cells, { value: null }] })),
    }));
  };

  const removeColumn = (colIdx: number) => {
    updateSheet((s) => ({
      ...s,
      columns: s.columns.filter((_, i) => i !== colIdx),
      rows: s.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== colIdx) })),
      lockedColumns: s.lockedColumns.filter((i) => i !== colIdx).map((i) => (i > colIdx ? i - 1 : i)),
    }));
  };

  const setColumnHeader = (colIdx: number, val: string) => {
    updateSheet((s) => {
      const columns = [...s.columns];
      columns[colIdx] = { ...columns[colIdx], label: val };
      return { ...s, columns };
    });
  };

  // ── Row operations ─────────────────────────────────────────────────────────
  const addRow = () => {
    updateSheet((s) => ({
      ...s,
      rows: [...s.rows, { id: `row_${makeId()}`, label: "", cells: Array(s.columns.length).fill({ value: null }) }],
    }));
  };

  const removeRow = (rowIdx: number) => {
    updateSheet((s) => ({ ...s, rows: s.rows.filter((_, i) => i !== rowIdx) }));
  };

  const setRowLabel = (rowIdx: number, val: string) => {
    updateSheet((s) => ({
      ...s,
      rows: s.rows.map((r, i) => (i === rowIdx ? { ...r, label: val } : r)),
    }));
  };

  const setCellDirect = (rowIdx: number, colIdx: number, val: string) => {
    updateSheet((s) => ({
      ...s,
      rows: s.rows.map((r, i) => {
        if (i !== rowIdx) return r;
        const cells = [...r.cells];
        cells[colIdx] = { value: parseCellValue(val), link: null };
        return { ...r, cells };
      }),
    }));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "i") {
        e.preventDefault();
        addColumn();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, localSheets]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[200px] text-muted-foreground">Loading pages…</div>;
  }

  const diffRow = activeSheet ? calcDiff(localSheets, activeSheet) : [];
  const totalRow = activeSheet ? calcTotal(localSheets, activeSheet) : [];

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0 bg-background">
        {/* Link dialog */}
        <LinkDialog
          state={linkDialog}
          sheets={localSheets}
          onClose={() => setLinkDialog((prev) => ({ ...prev, open: false }))}
          onSave={handleSaveLink}
        />

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap">
          <LayoutGrid className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-foreground mr-2">Factory Sheets</span>
          <div className="flex-1" />
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importMutation.mutate(f);
              e.target.value = "";
            }}
            data-testid="sb-input-import-file"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open("/api/factory/status-builder/sheets/template", "_blank")}
            data-testid="sb-button-download-template"
          >
            <FileDown className="h-3.5 w-3.5 mr-1.5" />
            Template
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            data-testid="sb-button-import-excel"
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={localSheets.length === 0}
            data-testid="sb-button-export-excel"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export Excel
          </Button>
          {savedAt && !isDirty && (
            <span className="text-xs text-muted-foreground" data-testid="sb-text-autosaved">
              Autosaved {savedAt}
            </span>
          )}
          <Button
            size="sm"
            onClick={() => {
              silentSaveRef.current = false;
              saveMutation.mutate(localSheets);
            }}
            disabled={!isDirty || saveMutation.isPending}
            data-testid="sb-button-save"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>

        {/* Cards / History toggle + search */}
        <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap bg-muted/20">
          <div className="flex items-center rounded-md border overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode("cards")}
              data-testid="sb-button-view-cards"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <LayoutList className="h-3.5 w-3.5" />
              Cards
            </button>
            <button
              onClick={() => setViewMode("history")}
              data-testid="sb-button-view-history"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "history" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              History
            </button>
          </div>
          {viewMode === "cards" && activeSheet && (
            <>
              <div className="relative flex-1 min-w-[160px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search rows…"
                  className="h-8 pl-8 text-sm"
                  data-testid="sb-input-search"
                />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto">
                {activeSheet.columns
                  .filter((c) => !isDiffColumn(c.label) && !isTotalColumn(c.label))
                  .map((col) => {
                    const ci = activeSheet.columns.indexOf(col);
                    return (
                      <button
                        key={col.id}
                        onClick={() => setPrimaryColIdx(ci)}
                        data-testid={`sb-pill-column-${ci}`}
                        className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
                          ci === primaryColIdx
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {col.label || "(column)"}
                      </button>
                    );
                  })}
              </div>
              <Button size="sm" variant="outline" onClick={() => setManageColumnsOpen(true)} data-testid="sb-button-manage-columns">
                Columns
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  addRow();
                  setTimeout(() => setEditRowIdx(activeSheet.rows.length), 0);
                }}
                data-testid="sb-button-add-row-card"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add row
              </Button>
            </>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-end gap-0 px-4 border-b overflow-x-auto">
          {localSheets.map((s, idx) => (
            <TabLabel
              key={s.id ?? `new-${idx}`}
              name={s.name}
              active={idx === activeIdx}
              onActivate={() => setActiveIdx(idx)}
              onRename={(v) => renameTab(idx, v)}
              onDelete={() => deleteTab(idx)}
              canDelete={localSheets.length > 1}
            />
          ))}
          <button
            data-testid="sb-button-add-tab"
            onClick={addTab}
            className="flex items-center gap-1 px-3 py-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add page
          </button>
        </div>

        {/* Content */}
        {!activeSheet ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center space-y-2">
              <LayoutGrid className="h-10 w-10 mx-auto opacity-30" />
              <p>No pages yet. Import an Excel file or add a page.</p>
            </div>
          </div>
        ) : viewMode === "history" ? (
          <div className="flex-1 overflow-auto p-4">
            {historyLoading ? (
              <div className="text-center text-sm text-muted-foreground py-8">Loading history…</div>
            ) : !historyLog || historyLog.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                No changes recorded yet for this page.
              </div>
            ) : (
              <div className="space-y-2 max-w-2xl mx-auto">
                {historyLog.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm"
                    data-testid={`sb-history-entry-${h.id}`}
                  >
                    <HistoryIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{h.rowLabel}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {h.columnLabel}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {h.oldValue ? `"${h.oldValue}"` : "(empty)"} → {h.newValue ? `"${h.newValue}"` : "(empty)"}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(h.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* Difference / Total status banners */}
            {(diffRow.some((v) => v !== null) || totalRow.some((v) => v !== null)) && (
              <div className="flex items-center gap-3 flex-wrap">
                {activeSheet.columns.map((col, ci) => {
                  if (isDiffColumn(col.label) && diffRow[ci] !== null) {
                    const val = diffRow[ci] as number;
                    const isNeg = val < 0;
                    return (
                      <div
                        key={col.id}
                        data-testid={`sb-banner-diff-${ci}`}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                          isNeg
                            ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                        }`}
                      >
                        {isNeg ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                        {col.label || "Difference"}: <span className="tabular-nums">{fmt(val)}</span>
                      </div>
                    );
                  }
                  if (isTotalColumn(col.label) && totalRow[ci] !== null) {
                    return (
                      <div
                        key={col.id}
                        data-testid={`sb-banner-total-${ci}`}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                      >
                        {col.label || "Total"}: <span className="tabular-nums">{fmt(totalRow[ci])}</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            )}

            {/* Row cards */}
            {(() => {
              const filteredRows = activeSheet.rows
                .map((row, ri) => ({ row, ri }))
                .filter(({ row }) => fmtLabel(row.label).toLowerCase().includes(search.trim().toLowerCase()));

              if (activeSheet.rows.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center text-muted-foreground text-sm py-12 gap-3">
                    <LayoutList className="h-10 w-10 opacity-30" />
                    <p>No rows yet.</p>
                    <Button
                      size="sm"
                      onClick={() => {
                        addRow();
                        setTimeout(() => setEditRowIdx(0), 0);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Add first row
                    </Button>
                  </div>
                );
              }

              if (filteredRows.length === 0) {
                return (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No rows match "{search}".
                  </div>
                );
              }

              const primaryCol = activeSheet.columns[primaryColIdx];

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredRows.map(({ row, ri }) => {
                    const otherCols = activeSheet.columns
                      .map((c, ci) => ({ c, ci }))
                      .filter(({ ci }) => ci !== primaryColIdx && !isDiffColumn(activeSheet.columns[ci].label) && !isTotalColumn(activeSheet.columns[ci].label));

                    const primaryCell = primaryCol ? row.cells[primaryColIdx] ?? { value: null } : { value: null };
                    const primaryLinked = !!primaryCell.link;
                    let primaryDisplay: CellValue | "#REF!" | "#CYCLE!" = primaryCell.value;
                    if (primaryLinked) {
                      const res = resolveCellValue(
                        localSheets,
                        primaryCell.link!.sourceSheetId,
                        primaryCell.link!.sourceRowId,
                        primaryCell.link!.sourceColumnId
                      );
                      primaryDisplay = res.value;
                    }
                    const rowHasLink = row.cells.some((c) => !!c.link);

                    return (
                      <Card
                        key={row.id}
                        className="cursor-pointer hover-elevate transition-colors"
                        onClick={() => setEditRowIdx(ri)}
                        data-testid={`sb-card-row-${ri}`}
                      >
                        <CardContent className="p-3.5 space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium text-sm leading-tight break-words" dir="auto">
                              {fmtLabel(row.label) || <span className="text-muted-foreground italic">Untitled row</span>}
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              {rowHasLink && <Link2 className="h-3.5 w-3.5 text-blue-400" />}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditRowIdx(ri);
                                }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                data-testid={`sb-button-edit-row-${ri}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDelete({ type: "row", idx: ri, label: fmtLabel(row.label) || `Row ${ri + 1}` });
                                }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                                data-testid={`sb-button-remove-row-${ri}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {primaryCol && (
                            <div>
                              <div className="text-[11px] text-muted-foreground">{primaryCol.label || "Value"}</div>
                              <div
                                className={`text-lg font-semibold tabular-nums ${typeof primaryDisplay === "number" && primaryDisplay < 0 ? "text-red-500" : ""}`}
                              >
                                {fmt(primaryDisplay)}
                              </div>
                            </div>
                          )}

                          {otherCols.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                              {otherCols.map(({ c, ci }) => {
                                const cell = row.cells[ci] ?? { value: null };
                                let display: CellValue | "#REF!" | "#CYCLE!" = cell.value;
                                if (cell.link) {
                                  const res = resolveCellValue(
                                    localSheets,
                                    cell.link.sourceSheetId,
                                    cell.link.sourceRowId,
                                    cell.link.sourceColumnId
                                  );
                                  display = res.value;
                                }
                                return (
                                  <Badge key={c.id} variant="secondary" className="text-[11px] font-normal gap-1">
                                    <span className="text-muted-foreground">{c.label || "—"}:</span>
                                    <span className="tabular-nums">{fmt(display)}</span>
                                    {cell.link && <Link2 className="h-2.5 w-2.5 text-blue-400" />}
                                  </Badge>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <RowEditDialog
        sheet={activeSheet}
        sheets={localSheets}
        rowIdx={editRowIdx}
        onClose={() => setEditRowIdx(null)}
        onLabelChange={setRowLabel}
        onCellChange={setCellDirect}
        onOpenLink={(ri, ci) => {
          setEditRowIdx(null);
          openLinkDialog(ri, ci);
        }}
        onUnlink={unlinkCell}
        onDelete={(ri, label) => {
          setEditRowIdx(null);
          setPendingDelete({ type: "row", idx: ri, label });
        }}
        fmtLabel={fmtLabel}
      />

      {/* Manage columns dialog */}
      <Dialog open={manageColumnsOpen} onOpenChange={setManageColumnsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage columns</DialogTitle>
            <DialogDescription>Rename, add, or remove the columns on this page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto py-1">
            {activeSheet?.columns.map((col, ci) => (
              <div key={col.id} className="flex items-center gap-2">
                <Input
                  value={col.label}
                  onChange={(e) => setColumnHeader(ci, e.target.value)}
                  className="h-9 text-sm"
                  data-testid={`sb-input-col-header-${ci}`}
                />
                <button
                  data-testid={`sb-button-remove-col-${ci}`}
                  onClick={() => setPendingDelete({ type: "col", idx: ci, label: col.label || `Column ${ci + 1}` })}
                  className="p-2 rounded text-muted-foreground hover:text-destructive hover:bg-muted shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={addColumn} data-testid="sb-button-add-column">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add column
            </Button>
            <Button onClick={() => setManageColumnsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDelete?.type === "row" ? "Row" : pendingDelete?.type === "col" ? "Column" : "Page"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-medium">"{pendingDelete?.label}"</span>?
              {pendingDelete?.type === "row"
                ? " All data in this row will be lost."
                : pendingDelete?.type === "col"
                  ? " All data in this column will be lost."
                  : " This page and all its data will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingDelete) return;
                if (pendingDelete.type === "row") removeRow(pendingDelete.idx);
                else if (pendingDelete.type === "col") removeColumn(pendingDelete.idx);
                else {
                  const s = localSheets[pendingDelete.idx];
                  if (s) {
                    if (s.id) deleteMutation.mutate(s.id);
                    else {
                      setLocalSheets((prev) => prev.filter((_, i) => i !== pendingDelete.idx));
                      setActiveIdx((prev) => Math.max(0, prev - 1));
                    }
                  }
                }
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
