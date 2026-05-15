import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Plus, Search, Filter, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, MessageCircle, Download, Copy, ExternalLink,
  Upload, Eye, Trash2, RotateCcw, Check, X, Paperclip,
  RefreshCw, Loader2, SlidersHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShippingRow {
  id: number;
  companyId: number;
  customerOrderId: number;
  orderDate: string;
  eta: string | null;
  containerArrivedDate: string | null;
  note: string | null;
  ciNumber: string | null;
  isDone: boolean;
  doneAt: string | null;
  doneBy: string | null;
  whatsappSentAt: string | null;
  createdAt: string;
  // Live from customer_orders join
  invoiceNumber: string;
  customerId: number | null;
  clientName: string | null;
  customerPhone: string | null;
  status: string;
  loadingDate: string | null;
  finalizedDate: string | null;
  containerNumber: string | null;
  shippingCompany: string | null;
  destination: string | null;
  documentCount: number;
  shippingInvoiceFileUrl: string | null;
  shippingInvoiceOriginalName: string | null;
  shippingInvoiceFileType: string | null;
  trackingLink: string | null;
  grandTotal: string | null;
}

interface TrackingRow {
  containerNumber: string | null;
  eta: string | null;
  grandTotal: string | null;
}

type DisplayRow = ShippingRow & { _isGhost: boolean; _trackedEta: string | null };

interface ShippingDocument {
  isGhost?: boolean;
  id: number;
  scrId: number;
  displayName: string;
  fileName: string;
  originalName: string;
  fileUrl: string;
  fileType: string | null;
  fileSize: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

interface WaFile {
  id: string;
  name: string;
  fileType: string;
  source: string;
  available: boolean;
  unavailableReason?: string;
  fileUrl?: string;
}

interface WhatsAppPreview {
  row: {
    id: number;
    customerOrderId: number;
    invoiceNumber: string | null;
    customerId: number | null;
    clientName: string | null;
    customerPhone: string | null;
    containerNumber: string | null;
    shippingCompany: string | null;
    destination: string | null;
  };
  files: WaFile[];
  defaultMessage: string;
  whatsappContact: string | null;
}

const LIST_KEY = "/api/factory/shipping-container-rows";

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  LOADING: "Loading",
  PENDING_VERIFICATION: "Pending",
  VERIFIED: "Verified",
  FINALIZED: "Finalized",
  DRAFT: "Draft",
  CANCELLED: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  LOADING: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  PENDING_VERIFICATION: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  VERIFIED: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  FINALIZED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  DRAFT: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

function statusLabel(s: string) {
  return STATUS_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();
}

function statusColor(s: string) {
  return STATUS_COLORS[s] ?? "bg-gray-100 text-gray-600";
}

const STATUS_ORDER: Record<string, number> = {
  LOADING: 0,
  PENDING_VERIFICATION: 1,
  VERIFIED: 2,
  FINALIZED: 3,
  DRAFT: 4,
  CANCELLED: 5,
};

/** Format YYYY-MM-DD or ISO timestamp → dd/mm/yy, returns "—" for empty */
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const plain = d.slice(0, 10);
  const parts = plain.split("-");
  if (parts.length !== 3) return "—";
  const [y, m, day] = parts;
  return `${day}/${m}/${y.slice(2)}`;
}

// ─── Column visibility config ──────────────────────────────────────────────────
const SHIPPING_COLS = [
  { id: "orderDate",     label: "Order Date" },
  { id: "status",        label: "Status" },
  { id: "destination",   label: "Destination" },
  { id: "eta",           label: "ETA" },
  { id: "arrived",       label: "Arrived" },
  { id: "finalized",     label: "Finalized" },
  { id: "shippingCo",    label: "Shipping Co." },
  { id: "documents",     label: "Documents" },
  { id: "containerCost", label: "Container Cost" },
  { id: "ciNumber",      label: "CI No." },
  { id: "note",          label: "Note" },
  { id: "whatsapp",      label: "WhatsApp" },
  { id: "done",          label: "Done" },
] as const;
type ShippingColId = typeof SHIPPING_COLS[number]["id"];
const DEFAULT_COL_VIS: Record<ShippingColId, boolean> = Object.fromEntries(
  SHIPPING_COLS.map((c) => [c.id, true])
) as Record<ShippingColId, boolean>;

// ─── Sticky column helpers ─────────────────────────────────────────────────────
const stickyHeadBase = "sticky z-20 bg-background border-r border-border/50 text-xs";
const stickyCellBase = "sticky z-10 bg-background border-r border-border/50";

const INV_LEFT = 0;
const CLI_LEFT = 130;
const CTR_LEFT = 130 + 144; // 274

// ─── Document count indicator ──────────────────────────────────────────────────

function DocIndicator({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 group" data-testid="button-open-docs">
      {count > 0
        ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors underline underline-offset-2">
        {count > 0 ? `${count} file${count !== 1 ? "s" : ""}` : "None"}
      </span>
    </button>
  );
}

// ─── Inline editable text cell ─────────────────────────────────────────────────

function EditableCellInput({
  value, placeholder, onSave, testId, saving,
}: {
  value: string; placeholder?: string; onSave: (v: string) => void; testId?: string; saving?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  if (!editing) {
    return (
      <span
        className="cursor-pointer hover:underline hover:text-foreground text-sm"
        onClick={() => { setDraft(value); setEditing(true); }}
        data-testid={testId}
      >
        {saving
          ? <Loader2 className="h-3 w-3 animate-spin inline" />
          : (value || <span className="text-muted-foreground italic text-xs">{placeholder || "—"}</span>)}
      </span>
    );
  }
  return (
    <Input
      autoFocus
      className="h-7 text-xs w-36"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onSave(draft); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { onSave(draft); setEditing(false); }
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

// ─── Inline date cell ──────────────────────────────────────────────────────────

function DateCellInput({
  value, placeholder, onSave, testId,
}: {
  value: string; placeholder?: string; onSave: (v: string) => void; testId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  if (!editing) {
    const display = fmtDate(value);
    return (
      <span
        className="cursor-pointer hover:underline hover:text-foreground text-sm"
        onClick={() => { setDraft(value); setEditing(true); }}
        data-testid={testId}
      >
        {display !== "—" ? display : <span className="text-muted-foreground italic text-xs">{placeholder || "—"}</span>}
      </span>
    );
  }
  return (
    <Input
      autoFocus
      type="date"
      className="h-7 text-xs w-36"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onSave(draft); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { onSave(draft); setEditing(false); }
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

// ─── Documents Modal ───────────────────────────────────────────────────────────

function DocumentsModal({
  open, rowId, invoiceNumber, onClose,
}: {
  open: boolean;
  rowId: number | null;
  invoiceNumber: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newDocName, setNewDocName] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    setPendingFile(null);
    setNewDocName("");
  }, [rowId]);

  // IMPORTANT: queryKey[0] must be the full fetch URL — the default fetcher uses only queryKey[0].
  // Using [LIST_KEY, rowId, "documents"] would cause every refetch to hit LIST_KEY (the row list)
  // instead of the documents endpoint, wiping the docs list after each optimistic update.
  const docsKey = rowId !== null ? [`${LIST_KEY}/${rowId}/documents`] : [`${LIST_KEY}/null/documents`];
  const { data: docs = [], isLoading } = useQuery<ShippingDocument[]>({
    queryKey: docsKey,
    enabled: open && rowId !== null,
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, displayName }: { file: File; displayName: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("displayName", displayName);
      const resp = await fetch(`${LIST_KEY}/${rowId}/documents`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }
      return resp.json() as Promise<ShippingDocument>;
    },
    onSuccess: (doc: ShippingDocument) => {
      queryClient.setQueryData<ShippingDocument[]>(docsKey, (old = []) => [...old, doc]);
      // Invalidate the main row list to refresh document counts, but NOT docsKey
      // (docsKey already has the correct optimistic data from setQueryData above)
      queryClient.invalidateQueries({ queryKey: [LIST_KEY], exact: true });
      setPendingFile(null);
      setNewDocName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast({ title: "Document uploaded", description: doc.displayName });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: number) => {
      const resp = await apiRequest("DELETE", `${LIST_KEY}/${rowId}/documents/${docId}`, undefined);
      if (!resp.ok && resp.status !== 404) {
        const err = await resp.json().catch(() => ({ message: "Delete failed" }));
        throw new Error(err.message || "Delete failed");
      }
      return { deletedId: docId };
    },
    onSuccess: ({ deletedId }) => {
      queryClient.setQueryData<ShippingDocument[]>(docsKey, (old = []) =>
        old.filter((d) => d.id !== deletedId),
      );
      // Invalidate the main row list to refresh document counts, but NOT docsKey
      queryClient.invalidateQueries({ queryKey: [LIST_KEY], exact: true });
      toast({ title: "Document removed" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setNewDocName(file.name.replace(/\.[^.]+$/, ""));
    e.target.value = "";
  }

  function handleUpload() {
    if (!pendingFile) return;
    uploadMutation.mutate({ file: pendingFile, displayName: newDocName || pendingFile.name });
  }

  async function handleViewDoc(doc: ShippingDocument) {
    try {
      const resp = await fetch(doc.fileUrl, { credentials: "include" });
      if (!resp.ok) {
        const isJson = resp.headers.get("content-type")?.includes("application/json");
        const msg = isJson ? (await resp.json()).message : await resp.text();
        const isLegacyFile = resp.status === 404;
        toast({
          title: isLegacyFile ? "File no longer available" : "File unavailable",
          description: isLegacyFile
            ? "This file was uploaded before database storage was enabled and cannot be retrieved. Please delete it and re-upload."
            : (msg || `Server returned ${resp.status}`),
          variant: "destructive",
        });
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast({ title: "Could not open file", description: "Network error", variant: "destructive" });
    }
  }

  function fmtSize(bytes: number | null) {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Documents
            <span className="font-mono text-sm text-muted-foreground font-normal">{invoiceNumber}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <XCircle className="h-8 w-8 mb-2 text-red-400" />
              <p className="text-sm">No documents uploaded yet</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Name</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Size</TableHead>
                    <TableHead className="text-xs">Uploaded by</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc) => (
                    doc.isGhost ? (
                      <TableRow key={doc.id} data-testid={`row-doc-${doc.id}`} className="bg-destructive/5">
                        <TableCell colSpan={4} className="py-2">
                          <p className="text-xs font-medium text-destructive">Broken record</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            No file is attached to this record. Delete it and re-upload.
                          </p>
                        </TableCell>
                        <TableCell className="py-2">
                          <Button
                            size="icon" variant="ghost"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(doc.id)}
                            data-testid={`button-remove-doc-${doc.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={doc.id} data-testid={`row-doc-${doc.id}`}>
                        <TableCell className="text-sm font-medium max-w-[130px] truncate" title={doc.displayName || doc.originalName}>
                          {doc.displayName || doc.originalName || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {(doc.fileType || "FILE").split("/").pop()?.toUpperCase() || "FILE"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtSize(doc.fileSize)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{doc.uploadedBy || "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" onClick={() => handleViewDoc(doc)} data-testid={`button-view-doc-${doc.id}`}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon" variant="ghost"
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(doc.id)}
                              data-testid={`button-remove-doc-${doc.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upload Document</p>
            <p className="text-xs text-muted-foreground">Max 25 MB per file.</p>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} data-testid="input-file-upload" />
            {pendingFile ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md px-2 py-1.5">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{pendingFile.name}</span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Display Name</Label>
                  <Input value={newDocName} onChange={(e) => setNewDocName(e.target.value)} placeholder="e.g. Packing List" className="h-8 text-sm" data-testid="input-doc-name" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleUpload} disabled={uploadMutation.isPending} data-testid="button-confirm-upload">
                    {uploadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                    Upload Document
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingFile(null)}>
                    <X className="h-3.5 w-3.5 mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-doc">
                <Upload className="h-3.5 w-3.5 mr-1" /> Choose File
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── WhatsApp Package Modal ────────────────────────────────────────────────────

interface WaFileWithChecked extends WaFile {
  checked: boolean;
}

function WhatsAppModal({
  open, rowId, onClose, onMarkDone,
}: {
  open: boolean;
  rowId: number | null;
  onClose: () => void;
  onMarkDone: (id: number, markWaSent: boolean) => void;
}) {
  const { toast } = useToast();
  const [files, setFiles] = useState<WaFileWithChecked[]>([]);
  const [message, setMessage] = useState("");
  const [initialised, setInitialised] = useState(false);

  const previewUrl = rowId ? `${LIST_KEY}/${rowId}/whatsapp-preview` : null;
  const { data: preview, isLoading, refetch } = useQuery<WhatsAppPreview>({
    queryKey: [previewUrl],
    enabled: open && !!rowId && !!previewUrl,
  });

  // Initialise file list and message when preview data arrives
  useEffect(() => {
    if (!open || !preview) return;
    const fl: WaFileWithChecked[] = preview.files.map((f) => ({ ...f, checked: f.available }));
    setFiles(fl);
    setMessage(preview.defaultMessage);
    setInitialised(true);
  }, [open, preview]);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setFiles([]);
      setMessage("");
      setInitialised(false);
    }
  }, [open]);

  function toggleFile(id: string) {
    setFiles((prev) => {
      const next = prev.map((f) => f.id === id ? { ...f, checked: !f.checked } : f);
      // Rebuild message body only if we have a preview base
      if (preview) {
        const checkedNames = next.filter((f) => f.checked).map((f) => `- ${f.name}`).join("\n");
        const base = preview.defaultMessage;
        const docBlock = checkedNames || "- (none selected)";
        // Replace the "Documents attached:" block
        setMessage(base.replace(
          /Documents attached:\n[\s\S]*?\n\nThank you\./,
          `Documents attached:\n${docBlock}\n\nThank you.`,
        ));
      }
      return next;
    });
  }

  function handleRefresh() {
    refetch().then(() => toast({ title: "File list refreshed" }));
  }

  function handleCopyMessage() {
    navigator.clipboard.writeText(message).then(() => toast({ title: "Message copied to clipboard" }));
  }

  function handleDownloadZip() {
    const selected = files.filter((f) => f.checked && f.available).map((f) => f.id).join(",");
    if (!selected) { toast({ title: "No files selected", variant: "destructive" }); return; }
    window.open(`${LIST_KEY}/${rowId}/zip-package?fileIds=${encodeURIComponent(selected)}`, "_blank");
  }

  function handleOpenWhatsApp() {
    const phone = (preview?.whatsappContact || "").replace(/\D/g, "");
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : "https://web.whatsapp.com";
    window.open(url, "_blank");
    toast({ title: "WhatsApp opened", description: "Attach the downloaded files, paste the message, then send." });
  }

  function handleMarkDone() {
    if (!rowId) return;
    onMarkDone(rowId, true);
    onClose();
  }

  const checkedCount = files.filter((f) => f.checked).length;
  const p = preview?.row;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-green-600" />
            WhatsApp Package Preview
          </DialogTitle>
        </DialogHeader>

        {isLoading || !initialised ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading package data…
          </div>
        ) : p && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm rounded-md border bg-muted/30 p-3">
              <div><span className="text-xs text-muted-foreground">Client</span><p className="font-medium">{p.clientName || "—"}</p></div>
              <div><span className="text-xs text-muted-foreground">Invoice</span><p className="font-mono font-medium">{p.invoiceNumber || "—"}</p></div>
              <div><span className="text-xs text-muted-foreground">Container</span><p className="font-mono">{p.containerNumber || "—"}</p></div>
              <div><span className="text-xs text-muted-foreground">Destination</span><p>{p.destination || "—"}</p></div>
              <div><span className="text-xs text-muted-foreground">Shipping Company</span><p>{p.shippingCompany || "—"}</p></div>
              <div>
                <span className="text-xs text-muted-foreground">WhatsApp Contact</span>
                <p>{preview?.whatsappContact || <span className="text-muted-foreground italic text-xs">Not set</span>}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Files to Include ({checkedCount} selected)
                </p>
                <Button size="sm" variant="ghost" onClick={handleRefresh} data-testid="button-refresh-files">
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh Files
                </Button>
              </div>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-xs">Send</TableHead>
                      <TableHead className="text-xs">File Name</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((f) => (
                      <TableRow
                        key={f.id}
                        data-testid={`row-wa-file-${f.id}`}
                        className={(!f.checked || !f.available) ? "opacity-50" : ""}
                      >
                        <TableCell>
                          <Checkbox
                            checked={f.checked && f.available}
                            disabled={!f.available}
                            onCheckedChange={() => f.available && toggleFile(f.id)}
                            data-testid={`checkbox-file-${f.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {f.name}
                          {!f.available && f.unavailableReason && (
                            <span className="ml-2 text-xs text-muted-foreground italic">({f.unavailableReason})</span>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{f.fileType}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.source}</TableCell>
                        <TableCell>
                          {f.available && f.fileUrl && (
                            <Button size="icon" variant="ghost" asChild>
                              <a href={f.fileUrl} target="_blank" rel="noreferrer"><Eye className="h-3.5 w-3.5" /></a>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">WhatsApp Message</p>
              <Textarea rows={10} value={message} onChange={(e) => setMessage(e.target.value)} className="text-sm font-mono" data-testid="textarea-wa-message" />
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300">
              <p className="font-semibold mb-1">How to send:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Download the ZIP package below.</li>
                <li>Click "Open WhatsApp" — the message will pre-fill if a contact is set.</li>
                <li>Attach the downloaded files manually in WhatsApp.</li>
                <li>Review the message, then click Send.</li>
                <li>Come back here and click "I Sent It — Mark as Done".</li>
              </ol>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleDownloadZip} data-testid="button-download-zip">
                <Download className="h-3.5 w-3.5 mr-1" /> Download ZIP Package
              </Button>
              <Button variant="outline" onClick={handleCopyMessage} data-testid="button-copy-message">
                <Copy className="h-3.5 w-3.5 mr-1" /> Copy Message
              </Button>
              <Button variant="outline" onClick={handleOpenWhatsApp} data-testid="button-open-whatsapp">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open WhatsApp
              </Button>
              <Button className="ml-auto" onClick={handleMarkDone} data-testid="button-mark-done-wa">
                <Check className="h-3.5 w-3.5 mr-1" /> I Sent It — Mark as Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Shipping Availability Table ───────────────────────────────────────────────

const AVAIL_KEY = "/api/factory/shipping-availability";

interface AvailRow {
  id: number;
  date: string;
  shippingCompany: string;
  availableContainers: number;
  note: string | null;
}

interface EditingAvail {
  id: number;
  date: string;
  shippingCompany: string;
  availableContainers: string;
  note: string;
}

function ShippingAvailabilityTable() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<EditingAvail | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({ date: "", shippingCompany: "", availableContainers: "", note: "" });

  const { data: rows = [], isLoading } = useQuery<AvailRow[]>({
    queryKey: [AVAIL_KEY],
  });

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", AVAIL_KEY, {
      date: newRow.date,
      shippingCompany: newRow.shippingCompany.trim(),
      availableContainers: parseInt(newRow.availableContainers) || 0,
      note: newRow.note.trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AVAIL_KEY] });
      setNewRow({ date: "", shippingCompany: "", availableContainers: "", note: "" });
      setAdding(false);
      toast({ title: "Row added" });
    },
    onError: (e: any) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: (row: EditingAvail) => apiRequest("PATCH", `${AVAIL_KEY}/${row.id}`, {
      date: row.date,
      shippingCompany: row.shippingCompany.trim(),
      availableContainers: parseInt(row.availableContainers) || 0,
      note: row.note.trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AVAIL_KEY] });
      setEditing(null);
      toast({ title: "Row saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${AVAIL_KEY}/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AVAIL_KEY] });
      toast({ title: "Row deleted" });
    },
    onError: (e: any) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  function startEdit(row: AvailRow) {
    setEditing({ id: row.id, date: row.date, shippingCompany: row.shippingCompany, availableContainers: String(row.availableContainers), note: row.note || "" });
  }

  function handleAddKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") addMutation.mutate();
    if (e.key === "Escape") { setAdding(false); setNewRow({ date: "", shippingCompany: "", availableContainers: "", note: "" }); }
  }

  function handleEditKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && editing) saveMutation.mutate(editing);
    if (e.key === "Escape") setEditing(null);
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/20 border-b">
        <span className="text-sm font-medium">Container Availability</span>
        <Button size="sm" onClick={() => setAdding(true)} disabled={adding} data-testid="button-add-availability">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-36">Date</TableHead>
              <TableHead className="text-xs">Shipping Company</TableHead>
              <TableHead className="text-xs w-40">Available Containers</TableHead>
              <TableHead className="text-xs">Note</TableHead>
              <TableHead className="text-xs w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 && !adding ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  No rows yet. Click "Add Row" to start.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {rows.map((row) =>
                  editing?.id === row.id ? (
                    <TableRow key={row.id} className="bg-muted/30">
                      <TableCell>
                        <Input
                          type="date"
                          value={editing.date}
                          onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                          onKeyDown={handleEditKey}
                          className="h-7 text-xs"
                          data-testid={`input-avail-date-${row.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={editing.shippingCompany}
                          onChange={(e) => setEditing({ ...editing, shippingCompany: e.target.value })}
                          onKeyDown={handleEditKey}
                          className="h-7 text-xs"
                          placeholder="e.g. Maersk"
                          data-testid={`input-avail-company-${row.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={editing.availableContainers}
                          onChange={(e) => setEditing({ ...editing, availableContainers: e.target.value })}
                          onKeyDown={handleEditKey}
                          className="h-7 text-xs"
                          data-testid={`input-avail-count-${row.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={editing.note}
                          onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                          onKeyDown={handleEditKey}
                          className="h-7 text-xs"
                          placeholder="Optional note"
                          data-testid={`input-avail-note-${row.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => saveMutation.mutate(editing)} disabled={saveMutation.isPending} data-testid={`button-avail-save-${row.id}`}>
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setEditing(null)} data-testid={`button-avail-cancel-${row.id}`}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={row.id} className="hover-elevate cursor-pointer" onClick={() => startEdit(row)} data-testid={`row-avail-${row.id}`}>
                      <TableCell>{row.date}</TableCell>
                      <TableCell>{row.shippingCompany}</TableCell>
                      <TableCell>{row.availableContainers}</TableCell>
                      <TableCell className="text-muted-foreground">{row.note || "—"}</TableCell>
                      <TableCell>
                        <Button
                          size="icon" variant="ghost"
                          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(row.id); }}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-avail-delete-${row.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                )}
                {adding && (
                  <TableRow className="bg-muted/30">
                    <TableCell>
                      <Input
                        type="date"
                        value={newRow.date}
                        onChange={(e) => setNewRow({ ...newRow, date: e.target.value })}
                        onKeyDown={handleAddKey}
                        className="h-7 text-xs"
                        autoFocus
                        data-testid="input-new-avail-date"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={newRow.shippingCompany}
                        onChange={(e) => setNewRow({ ...newRow, shippingCompany: e.target.value })}
                        onKeyDown={handleAddKey}
                        className="h-7 text-xs"
                        placeholder="e.g. Maersk"
                        data-testid="input-new-avail-company"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        value={newRow.availableContainers}
                        onChange={(e) => setNewRow({ ...newRow, availableContainers: e.target.value })}
                        onKeyDown={handleAddKey}
                        className="h-7 text-xs"
                        placeholder="0"
                        data-testid="input-new-avail-count"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={newRow.note}
                        onChange={(e) => setNewRow({ ...newRow, note: e.target.value })}
                        onKeyDown={handleAddKey}
                        className="h-7 text-xs"
                        placeholder="Optional note"
                        data-testid="input-new-avail-note"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !newRow.date || !newRow.shippingCompany.trim()} data-testid="button-new-avail-save">
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => { setAdding(false); setNewRow({ date: "", shippingCompany: "", availableContainers: "", note: "" }); }} data-testid="button-new-avail-cancel">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function FactoryShippingContainers() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterDocs, setFilterDocs] = useState<"all" | "has" | "missing">("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [docsRowId, setDocsRowId] = useState<number | null>(null);
  const [waRowId, setWaRowId] = useState<number | null>(null);
  const shippingInvoiceInputRef = useRef<HTMLInputElement>(null);
  const [shippingInvoiceUploadingId, setShippingInvoiceUploadingId] = useState<number | null>(null);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [pendingDoneId, setPendingDoneId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  // ── Column visibility (per-user, persisted to localStorage) ───────────────────
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [colVis, setColVis] = useState<Record<ShippingColId, boolean>>(DEFAULT_COL_VIS);
  useEffect(() => {
    if (!me?.id) return;
    try {
      const saved = localStorage.getItem(`fsc_col_vis_${me.id}`);
      if (saved) setColVis({ ...DEFAULT_COL_VIS, ...JSON.parse(saved) });
    } catch {}
  }, [me?.id]);
  function toggleCol(id: ShippingColId) {
    setColVis((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { if (me?.id) localStorage.setItem(`fsc_col_vis_${me.id}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  const hiddenCount = SHIPPING_COLS.filter((c) => !colVis[c.id]).length;

  // ── Data ──────────────────────────────────────────────────────────────────────
  const { data: rows = [], isLoading } = useQuery<ShippingRow[]>({
    queryKey: [LIST_KEY],
  });

  const { data: trackingData = [] } = useQuery<TrackingRow[]>({
    queryKey: ["/api/factory/invoice-container-tracking"],
  });

  // Auto-create backing rows for all active orders on mount
  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", `${LIST_KEY}/sync`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [LIST_KEY] }),
  });
  useEffect(() => { syncMutation.mutate(); }, []);

  const trackAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/factory/shipping-containers/track-now"),
    onSuccess: (data: any) => {
      toast({ title: "Tracking started", description: data?.message ?? "ETA updates will appear shortly." });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/factory/invoice-container-tracking"] }), 8000);
    },
    onError: (err: any) => toast({ title: "Tracking failed", description: err.message, variant: "destructive" }),
  });

  const done = rows.filter((r) => r.isDone);
  const activeRows = rows.filter((r) => !r.isDone);

  // Current row for docs modal (search real rows only)
  const docsRow = docsRowId ? rows.find((r) => r.id === docsRowId) : null;

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const patchRowMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) =>
      apiRequest("PATCH", `${LIST_KEY}/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [LIST_KEY] }),
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const syncOrderMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) =>
      apiRequest("PATCH", `${LIST_KEY}/${id}/sync-order`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [LIST_KEY] }),
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const doneMutation = useMutation({
    mutationFn: ({ id, markWaSent }: { id: number; markWaSent?: boolean }) =>
      apiRequest("POST", `${LIST_KEY}/${id}/done`, { markWhatsappSent: markWaSent }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      toast({ title: "Marked as done" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${LIST_KEY}/${id}/restore`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      toast({ title: "Restored to active" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteRowMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${LIST_KEY}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      toast({ title: "Container record deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const uploadShippingInvoiceMutation = useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${LIST_KEY}/${id}/shipping-invoice`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      toast({ title: "Shipping invoice uploaded" });
      setShippingInvoiceUploadingId(null);
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
      setShippingInvoiceUploadingId(null);
    },
  });

  const deleteShippingInvoiceMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${LIST_KEY}/${id}/shipping-invoice`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      toast({ title: "Shipping invoice removed" });
    },
    onError: (e: any) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  function handleShippingInvoiceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || shippingInvoiceUploadingId === null) return;
    uploadShippingInvoiceMutation.mutate({ id: shippingInvoiceUploadingId, file });
    e.target.value = "";
  }

  // ── Tracking map: containerNumber → {eta, grandTotal} ────────────────────────
  const trackingMap = useMemo(() => {
    const m = new Map<string, TrackingRow>();
    for (const t of trackingData) {
      if (t.containerNumber) m.set(t.containerNumber.trim().toUpperCase(), t);
    }
    return m;
  }, [trackingData]);

  // ── All display rows sorted by status ────────────────────────────────────────
  const allDisplayRows = useMemo((): DisplayRow[] => {
    const display: DisplayRow[] = activeRows.map((r) => {
      const ckey = (r.containerNumber || "").trim().toUpperCase();
      const tracked = ckey ? trackingMap.get(ckey) : undefined;
      return { ...r, _isGhost: false, _trackedEta: tracked?.eta ?? null };
    });
    display.sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 9;
      const sb = STATUS_ORDER[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      return (b.orderDate || "").localeCompare(a.orderDate || "");
    });
    return display;
  }, [activeRows, trackingMap]);

  // ── Filtering ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => allDisplayRows.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !(r.invoiceNumber || "").toLowerCase().includes(q) &&
        !(r.clientName || "").toLowerCase().includes(q) &&
        !(r.containerNumber || "").toLowerCase().includes(q) &&
        !(r.destination || "").toLowerCase().includes(q) &&
        !(r.shippingCompany || "").toLowerCase().includes(q)
      ) return false;
    }
    if (filterDocs === "has" && r.documentCount === 0) return false;
    if (filterDocs === "missing" && r.documentCount > 0) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    return true;
  }), [allDisplayRows, search, filterDocs, filterStatus]);

  const hasActiveFilters = filterDocs !== "all" || filterStatus !== "all";

  return (
    <>
      <div className="space-y-4">

        {/* ── Top Controls ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoice, client, container, destination…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => trackAllMutation.mutate()}
            disabled={trackAllMutation.isPending}
            data-testid="button-track-all-eta"
          >
            {trackAllMutation.isPending
              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              : <RefreshCw className="h-4 w-4 mr-1" />}
            {trackAllMutation.isPending ? "Tracking…" : "Track All ETAs"}
          </Button>
          <Button
            variant={showFilters ? "secondary" : "outline"}
            onClick={() => setShowFilters((v) => !v)}
            data-testid="button-toggle-filters"
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
            {hasActiveFilters && <span className="ml-1 h-2 w-2 rounded-full bg-primary inline-block" />}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" data-testid="button-toggle-columns">
                <SlidersHorizontal className="h-4 w-4 mr-1" />
                Columns
                {hiddenCount > 0 && (
                  <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">
                    {hiddenCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">Show / Hide Columns</p>
              <div className="space-y-0.5">
                {SHIPPING_COLS.map((col) => (
                  <label
                    key={col.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer text-sm"
                    data-testid={`col-toggle-${col.id}`}
                  >
                    <Checkbox
                      checked={colVis[col.id]}
                      onCheckedChange={() => toggleCol(col.id)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* ── Filter Panel ── */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 items-center p-3 rounded-md border bg-muted/30">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Documents</p>
              <Select value={filterDocs} onValueChange={(v: any) => setFilterDocs(v)}>
                <SelectTrigger className="h-8 text-xs w-36" data-testid="select-filter-docs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="has">Has Documents</SelectItem>
                  <SelectItem value="missing">Missing Documents</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Status</p>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs w-44" data-testid="select-filter-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="LOADING">Loading</SelectItem>
                  <SelectItem value="PENDING_VERIFICATION">Pending</SelectItem>
                  <SelectItem value="VERIFIED">Verified</SelectItem>
                  <SelectItem value="FINALIZED">Finalized</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterDocs("all"); setFilterStatus("all"); }} data-testid="button-clear-filters">
                Clear All
              </Button>
            </div>
          </div>
        )}

        {/* ── Legend ── */}
        <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Has documents</span>
          <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-red-500" /> No documents</span>
          <span>Click editable cells (Container #, Destination, ETA, Shipping Co., Note, Arrived) to edit inline.</span>
        </div>

        {/* ── Main Table ── */}
        <div className="rounded-md border">
          <Table className="text-xs" style={{ minWidth: "1100px" }} wrapperClassName="max-h-[calc(100vh-300px)] overflow-auto">
            <TableHeader>
              <TableRow>
                {colVis.orderDate && <TableHead className="text-xs w-20 min-w-[80px]">Order Date</TableHead>}
                <TableHead className={stickyHeadBase} style={{ left: INV_LEFT, minWidth: "130px", width: "130px" }}>Invoice #</TableHead>
                <TableHead className={stickyHeadBase} style={{ left: CLI_LEFT, minWidth: "144px", width: "144px" }}>Client</TableHead>
                {colVis.status && <TableHead className="text-xs w-24 min-w-[96px]">Status</TableHead>}
                <TableHead className={stickyHeadBase} style={{ left: CTR_LEFT, minWidth: "120px", width: "120px" }}>Container #</TableHead>
                {colVis.destination && <TableHead className="text-xs min-w-[120px]">Destination</TableHead>}
                {colVis.eta && <TableHead className="text-xs min-w-[100px]">ETA</TableHead>}
                {colVis.arrived && <TableHead className="text-xs min-w-[90px]">Arrived</TableHead>}
                {colVis.finalized && <TableHead className="text-xs min-w-[90px]">Finalized</TableHead>}
                {colVis.shippingCo && <TableHead className="text-xs min-w-[110px]">Shipping Co.</TableHead>}
                {colVis.documents && <TableHead className="text-xs min-w-[90px]">Documents</TableHead>}
                {colVis.containerCost && <TableHead className="text-xs min-w-[100px]">Container Cost</TableHead>}
                {colVis.ciNumber && <TableHead className="text-xs min-w-[100px]">CI No.</TableHead>}
                {colVis.note && <TableHead className="text-xs min-w-[110px]">Note</TableHead>}
                {colVis.whatsapp && <TableHead className="text-xs min-w-[90px]">WhatsApp</TableHead>}
                {colVis.done && <TableHead className="text-xs min-w-[80px]">Done</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={17} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={17} className="text-center py-10 text-muted-foreground">
                    {allDisplayRows.length === 0 ? "No active records." : "No records match the current filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id} data-testid={`row-record-${r.id}`}>
                    {colVis.orderDate && <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.orderDate)}</TableCell>}

                    {/* Sticky: Invoice # */}
                    <TableCell className={stickyCellBase} style={{ left: INV_LEFT }}>
                      <span className="font-mono font-medium text-xs whitespace-nowrap">{r.invoiceNumber}</span>
                    </TableCell>

                    {/* Sticky: Client */}
                    <TableCell className={cn(stickyCellBase, "font-medium text-xs max-w-[144px] truncate")} style={{ left: CLI_LEFT }}>
                      {r.clientName || "—"}
                    </TableCell>

                    {colVis.status && (
                      <TableCell>
                        <Badge className={cn("text-xs no-default-active-elevate whitespace-nowrap", statusColor(r.status))}>
                          {statusLabel(r.status)}
                        </Badge>
                      </TableCell>
                    )}

                    {/* Sticky: Container # */}
                    <TableCell className={stickyCellBase} style={{ left: CTR_LEFT }}>
                      <EditableCellInput
                        value={r.containerNumber || ""}
                        placeholder="Enter #"
                        onSave={(v) => syncOrderMutation.mutate({ id: r.id, patch: { containerNumber: v || null } })}
                        testId={`cell-container-${r.id}`}
                        saving={syncOrderMutation.isPending}
                      />
                    </TableCell>

                    {colVis.destination && (
                      <TableCell>
                        <EditableCellInput
                          value={r.destination || ""}
                          placeholder="Enter destination"
                          onSave={(v) => syncOrderMutation.mutate({ id: r.id, patch: { destination: v || null } })}
                          testId={`cell-destination-${r.id}`}
                        />
                      </TableCell>
                    )}

                    {colVis.eta && (
                      <TableCell>
                        {r._trackedEta ? (
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap" title="Auto from tracking">
                            {fmtDate(r._trackedEta)}
                          </span>
                        ) : (
                          <DateCellInput
                            value={r.eta || ""}
                            placeholder="Set ETA"
                            onSave={(v) => patchRowMutation.mutate({ id: r.id, patch: { eta: v || null } })}
                            testId={`cell-eta-${r.id}`}
                          />
                        )}
                      </TableCell>
                    )}

                    {colVis.arrived && (
                      <TableCell>
                        <DateCellInput
                          value={r.containerArrivedDate || ""}
                          placeholder="Not arrived"
                          onSave={(v) => patchRowMutation.mutate({ id: r.id, patch: { containerArrivedDate: v || null } })}
                          testId={`cell-arrived-${r.id}`}
                        />
                      </TableCell>
                    )}

                    {colVis.finalized && (
                      <TableCell className="whitespace-nowrap">
                        {r.finalizedDate
                          ? <span className="text-green-700 dark:text-green-400 font-medium text-xs">{fmtDate(r.finalizedDate)}</span>
                          : <span className="text-amber-600 dark:text-amber-400 italic text-xs">Not finalized</span>}
                      </TableCell>
                    )}

                    {colVis.shippingCo && (
                      <TableCell>
                        <EditableCellInput
                          value={r.shippingCompany || ""}
                          placeholder="Enter company"
                          onSave={(v) => syncOrderMutation.mutate({ id: r.id, patch: { shippingCompany: v || null } })}
                          testId={`cell-shipping-${r.id}`}
                        />
                      </TableCell>
                    )}

                    {colVis.documents && (
                      <TableCell>
                        <DocIndicator count={r.documentCount} onClick={() => setDocsRowId(r.id)} />
                      </TableCell>
                    )}

                    {colVis.containerCost && (
                      <TableCell className="text-xs whitespace-nowrap font-medium">
                        {r.grandTotal
                          ? <span className="text-foreground">${Number(r.grandTotal).toLocaleString()}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}

                    {colVis.ciNumber && (
                      <TableCell>
                        <EditableCellInput
                          value={r.ciNumber || ""}
                          placeholder="Enter CI #"
                          onSave={(v) => patchRowMutation.mutate({ id: r.id, patch: { ciNumber: v || null } })}
                          testId={`cell-ci-${r.id}`}
                        />
                      </TableCell>
                    )}

                    {colVis.note && (
                      <TableCell>
                        <EditableCellInput
                          value={r.note || ""}
                          placeholder="Add note"
                          onSave={(v) => patchRowMutation.mutate({ id: r.id, patch: { note: v || null } })}
                          testId={`cell-note-${r.id}`}
                        />
                      </TableCell>
                    )}

                    {colVis.whatsapp && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 whitespace-nowrap"
                          onClick={() => setWaRowId(r.id)}
                          data-testid={`button-prepare-wa-${r.id}`}
                        >
                          <MessageCircle className="h-3.5 w-3.5 mr-1" /> Prepare
                        </Button>
                      </TableCell>
                    )}

                    {colVis.done && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPendingDoneId(r.id)}
                            data-testid={`button-mark-done-${r.id}`}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" /> Done
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setPendingDeleteId(r.id)}
                            data-testid={`button-delete-row-${r.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* ── Container Availability ── */}
        <ShippingAvailabilityTable />

        {/* ── Done / Hidden Containers ── */}
        <div className="rounded-md border overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover-elevate bg-muted/20"
            onClick={() => setDoneExpanded((v) => !v)}
            data-testid="button-toggle-done"
          >
            <span className="flex items-center gap-2">
              {doneExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Done / Hidden Containers
              <Badge variant="outline" className="text-xs">{done.length}</Badge>
            </span>
            <span className="text-xs">Collapse to keep workspace clean</span>
          </button>

          {doneExpanded && (
            done.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No done containers yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Invoice #</TableHead>
                      <TableHead className="text-xs">Client</TableHead>
                      <TableHead className="text-xs">Container #</TableHead>
                      <TableHead className="text-xs">Destination</TableHead>
                      <TableHead className="text-xs">Done Date</TableHead>
                      <TableHead className="text-xs">WA Sent</TableHead>
                      <TableHead className="text-xs">Done By</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {done.map((r) => (
                      <TableRow key={r.id} className="opacity-70" data-testid={`row-done-${r.id}`}>
                        <TableCell className="font-mono">{r.invoiceNumber}</TableCell>
                        <TableCell>{r.clientName || "—"}</TableCell>
                        <TableCell className="font-mono">{r.containerNumber || "—"}</TableCell>
                        <TableCell>{r.destination || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(r.doneAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.whatsappSentAt
                            ? <span className="text-green-700 dark:text-green-400">{fmtDate(r.whatsappSentAt)}</span>
                            : <span className="text-muted-foreground italic">—</span>}
                        </TableCell>
                        <TableCell>{r.doneBy || "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setDocsRowId(r.id)} data-testid={`button-view-done-${r.id}`}>
                              <Eye className="h-3.5 w-3.5 mr-1" /> View
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              disabled={restoreMutation.isPending}
                              onClick={() => restoreMutation.mutate(r.id)}
                              data-testid={`button-restore-${r.id}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setPendingDeleteId(r.id)}
                              data-testid={`button-delete-done-${r.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}
        </div>

      </div>

      {/* Hidden file input for shipping invoice upload */}
      <input
        ref={shippingInvoiceInputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={handleShippingInvoiceFileChange}
        data-testid="input-shipping-invoice-file"
      />

      {/* ── Dialogs ── */}
      <DocumentsModal
        open={!!docsRowId}
        rowId={docsRowId}
        invoiceNumber={docsRow?.invoiceNumber || ""}
        onClose={() => setDocsRowId(null)}
      />

      <WhatsAppModal
        open={!!waRowId}
        rowId={waRowId}
        onClose={() => setWaRowId(null)}
        onMarkDone={(id, markWaSent) => doneMutation.mutate({ id, markWaSent })}
      />

      {/* Confirm delete */}
      <AlertDialog open={!!pendingDeleteId} onOpenChange={(v) => { if (!v) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the shipping container record and all its attached documents. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (pendingDeleteId) {
                  deleteRowMutation.mutate(pendingDeleteId);
                  setPendingDeleteId(null);
                }
              }}
              data-testid="button-confirm-delete-row"
            >
              Yes, Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm before marking done */}
      <AlertDialog open={!!pendingDoneId} onOpenChange={(v) => { if (!v) setPendingDoneId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Done?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the shipment to the Done / Hidden section. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDoneId) {
                  doneMutation.mutate({ id: pendingDoneId });
                  setPendingDoneId(null);
                }
              }}
              data-testid="button-confirm-done"
            >
              Yes, Mark as Done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
