import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Plus,
  Edit,
  Check,
  X,
  EyeOff,
  Eye,
  Tag,
  Layers,
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface StockGrade {
  id: number;
  name: string;
  active: boolean;
  companyId: number;
  createdAt: string;
}

interface StockCategory {
  id: number;
  name: string;
  active: boolean;
  companyId: number;
  createdAt: string;
}

interface ImportSummary {
  message: string;
  rowsProcessed: number;
  itemsUpdated: number;
  gradesCreated: number;
  categoriesCreated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

// ── Individual grade/category list ──────────────────────────────────────────

function MetaList({
  title,
  icon: Icon,
  apiPath,
  queryKey,
  testPrefix,
}: {
  title: string;
  icon: React.ElementType;
  apiPath: string;
  queryKey: string;
  testPrefix: string;
}) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const { data: items = [], isLoading } = useQuery<StockGrade[] | StockCategory[]>({
    queryKey: [apiPath, { includeInactive: showInactive }],
    queryFn: async () => {
      const url = showInactive ? `${apiPath}?includeInactive=true` : apiPath;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("POST", apiPath, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
      setNewName("");
      toast({ title: "Created", description: `${title.slice(0, -1)} created successfully` });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to create", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return await apiRequest("PATCH", `${apiPath}/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
      setEditingId(null);
      toast({ title: "Updated", description: "Name updated successfully" });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      if (!active) {
        return await apiRequest("DELETE", `${apiPath}/${id}`);
      } else {
        return await apiRequest("PATCH", `${apiPath}/${id}`, { active: true });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }
    createMutation.mutate(trimmed);
  };

  const handleEditSave = (id: number) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ id, name: trimmed });
  };

  const startEdit = (item: StockGrade | StockCategory) => {
    setEditingId(item.id);
    setEditName(item.name);
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold">{title}</h3>
          <Badge variant="secondary" className="text-xs">
            {items.filter((i: any) => i.active).length} active
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowInactive((v) => !v)}
          data-testid={`${testPrefix}-toggle-inactive`}
        >
          {showInactive ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
          {showInactive ? "Hide Inactive" : "Show Inactive"}
        </Button>
      </div>

      <div className="flex gap-2 mb-4">
        <Input
          placeholder={`New ${title.slice(0, -1).toLowerCase()} name...`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          data-testid={`${testPrefix}-new-name`}
          className="flex-1"
        />
        <Button
          onClick={handleCreate}
          disabled={createMutation.isPending || !newName.trim()}
          data-testid={`${testPrefix}-create`}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No {title.toLowerCase()} found. Add one above.</p>
      ) : (
        <div className="space-y-1">
          {(items as (StockGrade | StockCategory)[]).map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border ${!item.active ? "opacity-50" : ""}`}
              data-testid={`${testPrefix}-row-${item.id}`}
            >
              {editingId === item.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEditSave(item.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 h-8"
                    autoFocus
                    data-testid={`${testPrefix}-edit-input-${item.id}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleEditSave(item.id)}
                    disabled={updateMutation.isPending}
                    data-testid={`${testPrefix}-save-${item.id}`}
                  >
                    <Check className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                    data-testid={`${testPrefix}-cancel-${item.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{item.name}</span>
                  {!item.active && (
                    <Badge variant="secondary" className="text-xs">
                      Inactive
                    </Badge>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => startEdit(item)}
                    data-testid={`${testPrefix}-edit-${item.id}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => toggleActiveMutation.mutate({ id: item.id, active: !item.active })}
                    disabled={toggleActiveMutation.isPending}
                    data-testid={`${testPrefix}-toggle-${item.id}`}
                    title={item.active ? "Deactivate" : "Reactivate"}
                  >
                    {item.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Bulk Export / Import section ─────────────────────────────────────────────

function BulkExportImport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [resultDialog, setResultDialog] = useState<ImportSummary | null>(null);

  const handleExport = async () => {
    try {
      const res = await fetch("/api/stock-items/export-grade-category-template", {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        toast({ title: "Export failed", description: err.message, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "grade-category-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset file input so same file can be re-selected if needed
    e.target.value = "";

    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/stock-items/import-grade-category-template", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const data: ImportSummary = await res.json();

      if (!res.ok) {
        toast({ title: "Import failed", description: (data as any).message, variant: "destructive" });
        return;
      }

      // Invalidate stock items, grades, categories
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-grades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-categories"] });

      setResultDialog(data);
    } catch (error: any) {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-semibold mb-1">Bulk Grade &amp; Category Assignment</h3>
            <p className="text-sm text-muted-foreground max-w-lg">
              Export all stock items to Excel, edit the <span className="font-medium">Current Grade</span> and{" "}
              <span className="font-medium">Current Category</span> columns, then import to update in bulk. Only Grade
              and Category are changed — quantities, prices, and stock balances are not affected.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={handleExport} data-testid="button-export-grade-category">
              <Download className="h-4 w-4 mr-2" />
              Export Template
            </Button>
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              data-testid="button-import-grade-category"
            >
              <Upload className="h-4 w-4 mr-2" />
              {isImporting ? "Importing..." : "Import Template"}
            </Button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-import-grade-category-file"
        />
      </Card>

      {/* Result dialog */}
      <Dialog open={!!resultDialog} onOpenChange={() => setResultDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Import Complete
            </DialogTitle>
            <DialogDescription>
              Grade and category assignments have been updated. Only Grade and Category were changed — all other stock
              item data is unchanged.
            </DialogDescription>
          </DialogHeader>

          {resultDialog && (
            <div className="space-y-4">
              {/* Summary numbers */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Rows Processed", value: resultDialog.rowsProcessed },
                  { label: "Items Updated", value: resultDialog.itemsUpdated },
                  { label: "Grades Created", value: resultDialog.gradesCreated },
                  { label: "Categories Created", value: resultDialog.categoriesCreated },
                  { label: "Rows Skipped", value: resultDialog.skipped },
                  { label: "Errors", value: resultDialog.errors.length },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-md border px-3 py-2">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold">{value}</p>
                  </div>
                ))}
              </div>

              {/* Error list */}
              {resultDialog.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2 flex items-center gap-1">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    Skipped rows
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border p-2">
                    {resultDialog.errors.map((e, idx) => (
                      <p key={idx} className="text-xs text-muted-foreground">
                        <span className="font-medium">Row {e.row}:</span> {e.reason}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <Button className="w-full" onClick={() => setResultDialog(null)} data-testid="button-import-result-close">
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function GradesCategoriesManager() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Grades &amp; Categories</h2>
        <p className="text-sm text-muted-foreground">
          Manage stock item grades and categories. These are optional metadata fields that can be assigned to any stock
          item.
        </p>
      </div>

      <BulkExportImport />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MetaList
          title="Grades"
          icon={Tag}
          apiPath="/api/stock-grades"
          queryKey="/api/stock-grades"
          testPrefix="grade"
        />
        <MetaList
          title="Categories"
          icon={Layers}
          apiPath="/api/stock-categories"
          queryKey="/api/stock-categories"
          testPrefix="category"
        />
      </div>
    </div>
  );
}
