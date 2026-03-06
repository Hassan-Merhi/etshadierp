import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Workbook } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import type { Sheet as FortuneSheet } from "@fortune-sheet/core";
import * as XLSX from "xlsx";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Plus,
  Upload,
  Download,
  FileSpreadsheet,
  Trash2,
  Check,
  Loader2,
  Pencil,
} from "lucide-react";
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

function xlsxToFortune(workbook: XLSX.WorkBook): FortuneSheet[] {
  return workbook.SheetNames.map((name, order) => {
    const ws = workbook.Sheets[name];
    const ref = ws["!ref"];
    const range = ref
      ? XLSX.utils.decode_range(ref)
      : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };

    const rows = Math.max(50, range.e.r + 10);
    const cols = Math.max(26, range.e.c + 5);

    const data: any[][] = Array.from({ length: rows }, () => Array(cols).fill(null));

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell !== undefined && cell.v !== undefined) {
          const t = cell.t === "n" ? "n" : cell.t === "b" ? "b" : "s";
          const display = cell.w !== undefined ? cell.w : String(cell.v ?? "");
          data[r][c] = {
            v: cell.v,
            m: display,
            ct: { fa: "General", t },
          };
        }
      }
    }

    return {
      id: String(order + 1),
      name,
      status: order === 0 ? 1 : 0,
      order,
      data,
      row: rows,
      column: cols,
    } as FortuneSheet;
  });
}

function fortuneToXlsx(sheets: FortuneSheet[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws: XLSX.WorkSheet = {};
    let maxR = 0;
    let maxC = 0;

    const sheetData = (sheet as any).data as any[][] | undefined;
    if (sheetData && Array.isArray(sheetData) && sheetData.length > 0) {
      for (let r = 0; r < sheetData.length; r++) {
        if (!sheetData[r]) continue;
        for (let c = 0; c < sheetData[r].length; c++) {
          const v = sheetData[r][c];
          if (v && (v.v !== undefined || v.m !== undefined)) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const val = v.v ?? v.m;
            ws[addr] = {
              v: val,
              t: typeof val === "number" ? "n" : "s",
              w: v.m !== undefined ? String(v.m) : String(val),
            };
            maxR = Math.max(maxR, r);
            maxC = Math.max(maxC, c);
          }
        }
      }
    } else {
      for (const cell of (sheet.celldata || []) as any[]) {
        const { r, c, v } = cell;
        if (v && (v.v !== undefined || v.m !== undefined)) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const val = v.v ?? v.m;
          ws[addr] = {
            v: val,
            t: typeof val === "number" ? "n" : "s",
            w: v.m !== undefined ? String(v.m) : String(val),
          };
          maxR = Math.max(maxR, r);
          maxC = Math.max(maxC, c);
        }
      }
    }

    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: maxR, c: maxC },
    });
    XLSX.utils.book_append_sheet(wb, ws, sheet.name || "Sheet");
  }
  return wb;
}

function defaultBlankSheets(): FortuneSheet[] {
  return [
    {
      id: "1",
      name: "Sheet1",
      status: 1,
      order: 0,
      celldata: [],
      row: 50,
      column: 26,
    } as FortuneSheet,
  ];
}

function formatRelativeTime(ts: string | Date): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function SpreadsheetEditor() {
  const { toast } = useToast();
  const [openSheetId, setOpenSheetId] = useState<number | null>(null);
  const [sheetName, setSheetName] = useState("Untitled Spreadsheet");
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentDataRef = useRef<FortuneSheet[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const { data: library = [], isLoading: libraryLoading } = useQuery<any[]>({
    queryKey: ["/api/spreadsheets"],
  });

  const { data: openedSheet, isLoading: sheetLoading } = useQuery<any>({
    queryKey: ["/api/spreadsheets", openSheetId],
    queryFn: async () => {
      const res = await fetch(`/api/spreadsheets/${openSheetId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load spreadsheet");
      return res.json();
    },
    enabled: openSheetId !== null,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; data: any }) => {
      const res = await apiRequest("POST", "/api/spreadsheets", payload);
      return res.json();
    },
    onSuccess: (sheet) => {
      queryClient.invalidateQueries({ queryKey: ["/api/spreadsheets"] });
      setOpenSheetId(sheet.id);
      setSheetName(sheet.name);
      setSaveStatus("saved");
    },
    onError: () => toast({ title: "Error creating spreadsheet", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      fields,
    }: {
      id: number;
      fields: { name?: string; data?: any };
    }) => {
      const res = await apiRequest("PATCH", `/api/spreadsheets/${id}`, fields);
      return res.json();
    },
    onSuccess: () => {
      setSaveStatus("saved");
      queryClient.invalidateQueries({ queryKey: ["/api/spreadsheets"] });
    },
    onError: () => setSaveStatus("unsaved"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/spreadsheets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/spreadsheets"] });
      if (openSheetId === deleteTarget) setOpenSheetId(null);
      setDeleteTarget(null);
    },
    onError: () => toast({ title: "Error deleting spreadsheet", variant: "destructive" }),
  });

  const scheduleSave = useCallback(
    (data: FortuneSheet[]) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (openSheetId !== null) {
          setSaveStatus("saving");
          updateMutation.mutate({ id: openSheetId, fields: { data } });
        }
      }, 1500);
    },
    [openSheetId]
  );

  const handleChange = useCallback(
    (data: FortuneSheet[]) => {
      currentDataRef.current = data;
      setSaveStatus("unsaved");
      scheduleSave(data);
    },
    [scheduleSave]
  );

  useEffect(() => {
    currentDataRef.current = [];
    setSaveStatus("saved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, [openSheetId]);

  const handleOpen = (id: number, name: string) => {
    setOpenSheetId(id);
    setSheetName(name);
  };

  const handleBack = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      if (openSheetId !== null && currentDataRef.current.length > 0 && saveStatus !== "saved") {
        updateMutation.mutate({
          id: openSheetId,
          fields: { data: currentDataRef.current },
        });
      }
    }
    setOpenSheetId(null);
    currentDataRef.current = [];
  };

  const handleNew = () => {
    const data = defaultBlankSheets();
    createMutation.mutate({ name: "Untitled Spreadsheet", data });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(buffer, { type: "array" });
        const data = xlsxToFortune(wb);
        const name = file.name.replace(/\.(xlsx|xls|csv)$/i, "");
        createMutation.mutate({ name, data });
      } catch {
        toast({
          title: "Could not read file",
          description: "Make sure it is a valid .xlsx or .csv file.",
          variant: "destructive",
        });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleDownload = () => {
    const data =
      currentDataRef.current.length > 0
        ? currentDataRef.current
        : (openedSheet?.data ?? []);
    if (!data.length) return;
    const wb = fortuneToXlsx(data);
    XLSX.writeFile(wb, `${sheetName}.xlsx`);
  };

  const startRename = () => {
    setTempName(sheetName);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 10);
  };

  const confirmRename = () => {
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== sheetName && openSheetId !== null) {
      setSheetName(trimmed);
      updateMutation.mutate({ id: openSheetId, fields: { name: trimmed } });
    }
    setEditingName(false);
  };

  const initialData: FortuneSheet[] =
    openedSheet?.data && Array.isArray(openedSheet.data) && openedSheet.data.length > 0
      ? openedSheet.data
      : defaultBlankSheets();

  if (openSheetId !== null) {
    return (
      <div className="-mx-3 sm:-mx-6 -mt-3 sm:-mt-6 flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
        <div className="h-12 flex items-center gap-2 px-3 border-b bg-background shrink-0">
          <Button variant="ghost" size="icon" onClick={handleBack} data-testid="button-spreadsheet-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {editingName ? (
            <Input
              ref={nameInputRef}
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={confirmRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="h-8 max-w-xs text-sm font-medium"
              data-testid="input-spreadsheet-name"
            />
          ) : (
            <button
              className="flex items-center gap-1.5 group"
              onClick={startRename}
              data-testid="button-rename-spreadsheet"
            >
              <span className="text-sm font-medium">{sheetName}</span>
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
          <div className="flex items-center gap-1 text-xs text-muted-foreground ml-1">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Saving…</span>
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3 w-3 text-green-600" />
                <span>Saved</span>
              </>
            )}
            {saveStatus === "unsaved" && <span>Unsaved changes</span>}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              data-testid="button-download-xlsx"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download .xlsx
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {sheetLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading spreadsheet…
            </div>
          ) : (
            <Workbook
              key={openSheetId}
              data={initialData}
              onChange={handleChange}
              showToolbar
              showFormulaBar
              showSheetTabs
              lang="en"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Spreadsheets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Shared workbooks — all users can view and edit
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleUpload}
            data-testid="input-upload-xlsx"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={createMutation.isPending}
            data-testid="button-upload-xlsx"
          >
            <Upload className="h-4 w-4 mr-1.5" />
            Upload .xlsx
          </Button>
          <Button
            size="sm"
            onClick={handleNew}
            disabled={createMutation.isPending}
            data-testid="button-new-spreadsheet"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            New Spreadsheet
          </Button>
        </div>
      </div>

      {libraryLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading…
        </div>
      ) : (library as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSpreadsheet className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">No spreadsheets yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            Create a new spreadsheet or upload an existing .xlsx file
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" />
              Upload .xlsx
            </Button>
            <Button size="sm" onClick={handleNew}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Spreadsheet
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {(library as any[]).map((sheet) => (
            <Card
              key={sheet.id}
              className="hover-elevate cursor-pointer group"
              onClick={() => handleOpen(sheet.id, sheet.name)}
              data-testid={`card-spreadsheet-${sheet.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <FileSpreadsheet className="h-8 w-8 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-sheet-name-${sheet.id}`}>
                        {sheet.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatRelativeTime(sheet.updatedAt)}
                      </p>
                      {sheet.createdBy && (
                        <p className="text-xs text-muted-foreground truncate">
                          {sheet.createdBy}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(sheet.id);
                    }}
                    data-testid={`button-delete-sheet-${sheet.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete spreadsheet?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the spreadsheet and all its data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget !== null && deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
