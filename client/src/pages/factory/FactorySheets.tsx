import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Download, Upload, Save, X, Check, TableProperties, FileDown,
} from "lucide-react";
import type { FactorySheet } from "@shared/schema";

// ── Types ──────────────────────────────────────────────────────────────────────
type CellValue = number | string | null;
type SheetRow = { label: string; cells: CellValue[] };

interface LocalSheet {
  id: number | null; // null = not yet saved
  name: string;
  orderIndex: number;
  columns: string[];
  rows: SheetRow[];
  dirty: boolean;
}

function fromApiSheet(s: FactorySheet): LocalSheet {
  return {
    id: s.id,
    name: s.name,
    orderIndex: s.orderIndex,
    columns: (s.columns as string[]) ?? [],
    rows: (s.rows as SheetRow[]) ?? [],
    dirty: false,
  };
}

// ── Difference row calculation ─────────────────────────────────────────────────
function calcDiff(rows: SheetRow[], colCount: number): (number | null)[] {
  const diff: (number | null)[] = Array(colCount).fill(null);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      const v = row.cells[c];
      if (typeof v === "number") {
        diff[c] = (diff[c] ?? 0) + v;
      }
    }
  }
  return diff;
}

// ── Cell value formatting ──────────────────────────────────────────────────────
function fmt(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

// Parse cell input: try to parse as number; if it looks like an in-progress
// negative number (just "-") or is non-numeric text, store as a string so the
// user can keep typing without losing their input.
function parseCellValue(s: string): CellValue {
  if (s === "" || s === null || s === undefined) return null;
  const trimmed = s.trim();
  if (trimmed === "") return null;
  // Intermediate negative sign — preserve it as a string so typing continues
  if (trimmed === "-") return "-";
  const cleaned = trimmed.replace(/,/g, "");
  const n = Number(cleaned);
  if (!isNaN(n)) return n;
  // Non-numeric text — store as string
  return s;
}

// ── Tab name editor ────────────────────────────────────────────────────────────
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
      data-testid={`tab-${name}`}
      onClick={onActivate}
      onDoubleClick={() => { setEditing(true); setDraft(name); }}
      className={`relative flex items-center gap-1.5 px-3 py-2 cursor-pointer border-b-2 select-none whitespace-nowrap transition-colors
        ${active
          ? "border-primary text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
        }`}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(name); setEditing(false); }
            e.stopPropagation();
          }}
          onClick={e => e.stopPropagation()}
          className="bg-transparent border-none outline-none w-24 text-sm font-medium"
          data-testid={`tab-input-${name}`}
        />
      ) : (
        <span className="text-sm">{name}</span>
      )}
      {active && canDelete && (
        <button
          data-testid={`tab-delete-${name}`}
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="ml-1 rounded-sm opacity-60 hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
          style={{ visibility: "visible" }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function FactorySheets() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [localSheets, setLocalSheets] = useState<LocalSheet[]>([]);
  const [initialised, setInitialised] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentSaveRef = useRef(false);

  // ── Load from server ─────────────────────────────────────────────────────
  const { data: apiSheets, isLoading } = useQuery<FactorySheet[]>({
    queryKey: ["/api/factory/sheets"],
  });

  useEffect(() => {
    if (apiSheets && !initialised) {
      setLocalSheets(apiSheets.map(fromApiSheet));
      setInitialised(true);
    }
  }, [apiSheets, initialised]);

  const activeSheet = localSheets[activeIdx] ?? null;
  const isDirty = localSheets.some(s => s.dirty);

  // ── Autosave — 2 s debounce after any dirty change ────────────────────────
  useEffect(() => {
    const hasSaveable = localSheets.some(s => s.dirty && s.id !== null);
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

  // ── Helpers ──────────────────────────────────────────────────────────────
  const updateSheet = useCallback((fn: (s: LocalSheet) => LocalSheet) => {
    setLocalSheets(prev => {
      const next = [...prev];
      next[activeIdx] = { ...fn(next[activeIdx]), dirty: true };
      return next;
    });
  }, [activeIdx]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/factory/sheets", { name }).then(r => r.json()),
    onSuccess: (created: FactorySheet) => {
      setLocalSheets(prev => [...prev, fromApiSheet(created)]);
      setActiveIdx(prev => prev + 1); // will be last
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async (sheets: LocalSheet[]) => {
      const dirty = sheets.filter(s => s.dirty && s.id !== null);
      await Promise.all(dirty.map(s =>
        apiRequest("PUT", `/api/factory/sheets/${s.id}`, {
          name: s.name,
          columns: s.columns,
          rows: s.rows,
        })
      ));
    },
    onSuccess: () => {
      setLocalSheets(prev => prev.map(s => ({ ...s, dirty: false })));
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets"] });
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setSavedAt(now);
      if (!silentSaveRef.current) {
        toast({ title: "Saved", description: "All sheets saved." });
      }
      silentSaveRef.current = false;
    },
    onError: (e: any) => {
      silentSaveRef.current = false;
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/factory/sheets/${id}`),
    onSuccess: (_data, id) => {
      setLocalSheets(prev => {
        const next = prev.filter(s => s.id !== id);
        return next;
      });
      setActiveIdx(prev => Math.max(0, prev - 1));
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets"] });
      toast({ title: "Sheet deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return fetch("/api/factory/sheets/import", {
        method: "POST",
        credentials: "include",
        body: fd,
      }).then(async r => {
        if (!r.ok) {
          const t = await r.text();
          try { throw new Error(JSON.parse(t).message); } catch { throw new Error(t); }
        }
        return r.json() as Promise<FactorySheet[]>;
      });
    },
    onSuccess: (sheets: FactorySheet[]) => {
      setLocalSheets(sheets.map(fromApiSheet));
      setActiveIdx(0);
      setInitialised(true);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets"] });
      toast({ title: "Imported", description: `${sheets.length} sheet(s) imported.` });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    window.open("/api/factory/sheets/export", "_blank");
  };

  // ── Tab operations ────────────────────────────────────────────────────────
  const addTab = () => {
    const name = `Sheet ${localSheets.length + 1}`;
    createMutation.mutate(name);
  };

  const renameTab = (idx: number, newName: string) => {
    setLocalSheets(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], name: newName, dirty: true };
      return next;
    });
  };

  const deleteTab = (idx: number) => {
    const s = localSheets[idx];
    if (!s) return;
    if (s.id) {
      deleteMutation.mutate(s.id);
    } else {
      setLocalSheets(prev => prev.filter((_, i) => i !== idx));
      setActiveIdx(prev => Math.max(0, prev - 1));
    }
  };

  // ── Column operations ─────────────────────────────────────────────────────
  const addColumn = () => {
    updateSheet(s => ({
      ...s,
      columns: [...s.columns, `Col ${s.columns.length + 1}`],
      rows: s.rows.map(r => ({ ...r, cells: [...r.cells, null] })),
    }));
  };

  const removeColumn = (colIdx: number) => {
    updateSheet(s => ({
      ...s,
      columns: s.columns.filter((_, i) => i !== colIdx),
      rows: s.rows.map(r => ({
        ...r,
        cells: r.cells.filter((_, i) => i !== colIdx),
      })),
    }));
  };

  const setColumnHeader = (colIdx: number, val: string) => {
    updateSheet(s => {
      const cols = [...s.columns];
      cols[colIdx] = val;
      return { ...s, columns: cols };
    });
  };

  // ── Row operations ────────────────────────────────────────────────────────
  const addRow = () => {
    updateSheet(s => ({
      ...s,
      rows: [
        ...s.rows,
        { label: `Row ${s.rows.length + 1}`, cells: Array(s.columns.length).fill(null) },
      ],
    }));
  };

  const removeRow = (rowIdx: number) => {
    updateSheet(s => ({
      ...s,
      rows: s.rows.filter((_, i) => i !== rowIdx),
    }));
  };

  const setRowLabel = (rowIdx: number, val: string) => {
    updateSheet(s => {
      const rows = s.rows.map((r, i) => i === rowIdx ? { ...r, label: val } : r);
      return { ...s, rows };
    });
  };

  const setCell = (rowIdx: number, colIdx: number, val: string) => {
    updateSheet(s => {
      const rows = s.rows.map((r, i) => {
        if (i !== rowIdx) return r;
        const cells = [...r.cells];
        cells[colIdx] = parseCellValue(val);
        return { ...r, cells };
      });
      return { ...s, rows };
    });
  };

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const focusCell = useCallback((ri: number, ci: number) => {
    const el = document.querySelector(
      `[data-testid="input-cell-${ri}-${ci}"]`
    ) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  }, []);

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) => {
      const sheet = localSheets[activeIdx];
      if (!sheet) return;
      const rowCount = sheet.rows.length;
      const colCount = sheet.columns.length;

      if (e.key === "Enter") {
        e.preventDefault();
        if (ri >= rowCount - 1) {
          // Last row → create new row then focus it
          updateSheet(s => ({
            ...s,
            rows: [...s.rows, { label: `Row ${s.rows.length + 1}`, cells: Array(s.columns.length).fill(null) }],
          }));
          setTimeout(() => focusCell(rowCount, ci), 30);
        } else {
          focusCell(ri + 1, ci);
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          if (ci > 0) focusCell(ri, ci - 1);
          else if (ri > 0) focusCell(ri - 1, colCount - 1);
        } else {
          if (ci < colCount - 1) focusCell(ri, ci + 1);
          else if (ri < rowCount - 1) focusCell(ri + 1, 0);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (ri > 0) focusCell(ri - 1, ci);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (ri < rowCount - 1) focusCell(ri + 1, ci);
      } else if (e.key === "ArrowLeft") {
        const input = e.currentTarget;
        if (input.selectionStart === 0 && input.selectionEnd === 0 && ci > 0) {
          e.preventDefault();
          focusCell(ri, ci - 1);
        }
      } else if (e.key === "ArrowRight") {
        const input = e.currentTarget;
        if (input.selectionStart === input.value.length && ci < colCount - 1) {
          e.preventDefault();
          focusCell(ri, ci + 1);
        }
      }
    },
    [localSheets, activeIdx, focusCell, updateSheet]
  );

  // Ctrl+I → add column
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "i") {
        e.preventDefault();
        addColumn();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, localSheets]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading sheets…
      </div>
    );
  }

  const diffRow = activeSheet ? calcDiff(activeSheet.rows, activeSheet.columns.length) : [];

  return (
    <div className="flex flex-col h-full bg-background">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap">
        <TableProperties className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold text-foreground mr-2">Factory Sheets</span>

        <div className="flex-1" />

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) importMutation.mutate(f);
            e.target.value = "";
          }}
          data-testid="input-import-file"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.open("/api/factory/sheets/template", "_blank")}
          data-testid="button-download-template"
        >
          <FileDown className="h-3.5 w-3.5 mr-1.5" />
          Template
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={importMutation.isPending}
          data-testid="button-import-excel"
        >
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          Import Excel
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={localSheets.length === 0}
          data-testid="button-export-excel"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export Excel
        </Button>

        {savedAt && !isDirty && (
          <span className="text-xs text-muted-foreground" data-testid="text-autosaved">
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
          data-testid="button-save-sheets"
        >
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex items-end gap-0 px-4 border-b overflow-x-auto">
        {localSheets.map((s, idx) => (
          <TabLabel
            key={s.id ?? `new-${idx}`}
            name={s.name}
            active={idx === activeIdx}
            onActivate={() => setActiveIdx(idx)}
            onRename={v => renameTab(idx, v)}
            onDelete={() => deleteTab(idx)}
            canDelete={localSheets.length > 1}
          />
        ))}
        <button
          data-testid="button-add-tab"
          onClick={addTab}
          className="flex items-center gap-1 px-3 py-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add sheet
        </button>
      </div>

      {/* ── Grid ────────────────────────────────────────────────────────── */}
      {!activeSheet ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          <div className="text-center space-y-2">
            <TableProperties className="h-10 w-10 mx-auto opacity-30" />
            <p>No sheets yet. Import an Excel file or add a sheet.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <div className="inline-block min-w-full">
            <table className="border-collapse text-sm" data-testid="grid-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  {/* Row-label header */}
                  <th className="border border-border bg-muted px-2 py-1.5 text-left font-medium text-muted-foreground min-w-[180px]">
                    Label
                  </th>

                  {/* Column headers — editable */}
                  {activeSheet.columns.map((col, ci) => (
                    <th
                      key={ci}
                      className="border border-border bg-muted px-1 py-1 text-center font-medium min-w-[130px]"
                    >
                      <div className="flex items-center gap-1">
                        <Input
                          value={col}
                          onChange={e => setColumnHeader(ci, e.target.value)}
                          className="h-7 text-xs text-center font-semibold border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1"
                          data-testid={`input-col-header-${ci}`}
                        />
                        <button
                          data-testid={`button-remove-col-${ci}`}
                          onClick={() => removeColumn(ci)}
                          className="text-muted-foreground hover:text-destructive shrink-0 transition-colors"
                          style={{ visibility: "visible" }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                  ))}

                  {/* Add column */}
                  <th className="border border-border bg-muted px-2 py-1.5 text-center">
                    <button
                      data-testid="button-add-column"
                      onClick={addColumn}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Add column"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* Data rows */}
                {activeSheet.rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-muted/30">
                    {/* Row label */}
                    <td className="border border-border px-1 py-0.5 bg-muted/20">
                      <Input
                        value={row.label}
                        onChange={e => setRowLabel(ri, e.target.value)}
                        className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1"
                        data-testid={`input-row-label-${ri}`}
                        dir="auto"
                      />
                    </td>

                    {/* Data cells */}
                    {activeSheet.columns.map((_, ci) => {
                      const val = row.cells[ci];
                      const isNeg = typeof val === "number" && val < 0;
                      const isText = typeof val === "string" && val !== "-";
                      return (
                        <td
                          key={ci}
                          className="border border-border px-1 py-0.5"
                        >
                          <Input
                            value={fmt(val)}
                            onChange={e => setCell(ri, ci, e.target.value)}
                            onKeyDown={e => handleCellKeyDown(e, ri, ci)}
                            className={`h-7 text-xs border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary px-1 tabular-nums ${isNeg ? "text-red-500" : ""} ${isText ? "text-left" : "text-right"}`}
                            data-testid={`input-cell-${ri}-${ci}`}
                            dir="auto"
                          />
                        </td>
                      );
                    })}

                    {/* Remove row */}
                    <td className="border border-border px-2 py-0.5 text-center">
                      <button
                        data-testid={`button-remove-row-${ri}`}
                        onClick={() => removeRow(ri)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Difference row — auto-calculated */}
                {activeSheet.columns.length > 0 && (
                  <tr className="bg-muted/40 font-semibold">
                    <td className="border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      Difference
                    </td>
                    {diffRow.map((val, ci) => {
                      const isNeg = typeof val === "number" && val < 0;
                      return (
                        <td
                          key={ci}
                          className={`border border-border px-3 py-1.5 text-right text-xs tabular-nums font-bold ${isNeg ? "text-red-500" : "text-foreground"}`}
                          data-testid={`text-diff-${ci}`}
                        >
                          {fmt(val)}
                        </td>
                      );
                    })}
                    <td className="border border-border" />
                  </tr>
                )}
              </tbody>
            </table>

            {/* Add row button */}
            <div className="mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={addRow}
                data-testid="button-add-row"
                disabled={activeSheet.columns.length === 0}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add row
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
