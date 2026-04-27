import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { readFromBuffer } from "@/lib/excelHelper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  FolderOpen, Folder, FolderPlus, Upload, Download, Trash2, Eye, Pencil,
  ArrowRightLeft, FileText, FileSpreadsheet, FileImage, File, Search,
  Loader2, Database, X, ChevronRight,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface FileFolder {
  id: number;
  name: string;
  companyId: number;
  createdAt: string;
}

interface StoredFile {
  id: number;
  folderId: number | null;
  fileName: string;
  displayName: string | null;
  fileType: string;
  fileSize: number;
  description: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

type PreviewType = "pdf" | "image" | "csv" | "text" | "excel" | "unsupported";
interface PreviewState {
  file: StoredFile;
  type: PreviewType;
  blobUrl?: string;
  text?: string;
  rows?: any[][];
  loading: boolean;
  error?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function visibleName(file: StoredFile) {
  return file.displayName || file.fileName;
}

function getPreviewType(file: StoredFile): PreviewType {
  const mt = file.fileType.toLowerCase();
  const name = file.fileName.toLowerCase();
  if (mt === "application/pdf") return "pdf";
  if (mt.startsWith("image/")) return "image";
  if (mt === "text/csv" || name.endsWith(".csv")) return "csv";
  if (mt === "text/plain" || name.endsWith(".txt")) return "text";
  if (
    mt.includes("spreadsheet") || mt.includes("excel") ||
    name.endsWith(".xlsx") || name.endsWith(".xls")
  ) return "excel";
  return "unsupported";
}

function FileIcon({ fileType, fileName, className }: { fileType: string; fileName: string; className?: string }) {
  const mt = fileType.toLowerCase();
  const name = fileName.toLowerCase();
  if (mt === "application/pdf") return <FileText className={`text-red-500 ${className}`} />;
  if (mt.startsWith("image/")) return <FileImage className={`text-blue-400 ${className}`} />;
  if (mt.includes("spreadsheet") || mt.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv"))
    return <FileSpreadsheet className={`text-green-500 ${className}`} />;
  if (mt.includes("word") || name.endsWith(".doc") || name.endsWith(".docx"))
    return <FileText className={`text-blue-500 ${className}`} />;
  return <File className={`text-muted-foreground ${className}`} />;
}

// ── Preview Modal ────────────────────────────────────────────────────────────
function PreviewModal({
  preview, onClose, onDownload,
}: {
  preview: PreviewState | null;
  onClose: () => void;
  onDownload: (file: StoredFile) => void;
}) {
  if (!preview) return null;
  const { file, type, blobUrl, text, rows, loading, error } = preview;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl w-full max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b flex-row items-center justify-between">
          <DialogTitle className="truncate max-w-[80%] text-base">
            {visibleName(file)}
          </DialogTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onDownload(file)} data-testid="button-preview-download">
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-preview-close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-4 min-h-[300px]">
          {loading && (
            <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading preview...</span>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <FileText className="h-10 w-10 opacity-30" />
              <p>Could not load preview.</p>
            </div>
          )}
          {!loading && !error && type === "pdf" && blobUrl && (
            <iframe
              src={blobUrl}
              title="PDF Preview"
              className="w-full h-[65vh] rounded border-0"
              data-testid="preview-pdf"
            />
          )}
          {!loading && !error && type === "image" && blobUrl && (
            <div className="flex items-center justify-center">
              <img src={blobUrl} alt={visibleName(file)} className="max-w-full max-h-[65vh] rounded object-contain" data-testid="preview-image" />
            </div>
          )}
          {!loading && !error && (type === "csv" || type === "excel") && rows && rows.length > 0 && (
            <div className="overflow-auto max-h-[65vh]">
              <table className="text-xs w-full border-collapse" data-testid="preview-table">
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className={ri === 0 ? "bg-muted font-semibold" : "border-b border-border/40 hover:bg-muted/30"}>
                      {row.map((cell: any, ci: number) => (
                        <td key={ci} className="px-2 py-1 border-r border-border/40 whitespace-nowrap max-w-[200px] truncate">
                          {cell == null ? "" : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && !error && (type === "csv" || type === "excel") && (!rows || rows.length === 0) && (
            <p className="text-muted-foreground text-sm">No data to preview.</p>
          )}
          {!loading && !error && type === "text" && text !== undefined && (
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/30 p-4 rounded max-h-[65vh] overflow-auto" data-testid="preview-text">
              {text}
            </pre>
          )}
          {!loading && !error && type === "unsupported" && (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
              <FileIcon fileType={file.fileType} fileName={file.fileName} className="h-12 w-12" />
              <p className="font-medium">{visibleName(file)}</p>
              <p className="text-sm">{file.fileType} &bull; {formatSize(file.fileSize)}</p>
              <p className="text-sm">Preview not available for this file type.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function FileStorageTab() {
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFolderId, setSelectedFolderId] = useState<number | null | "unfiled">("unfiled");
  const [search, setSearch] = useState("");

  // Preview state
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const previewBlobUrl = useRef<string | null>(null);

  // Folder dialogs
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [renameFolderId, setRenameFolderId] = useState<number | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [deleteFolderId, setDeleteFolderId] = useState<number | null>(null);
  const [deleteFolderName, setDeleteFolderName] = useState("");
  const [deleteFolderHasFiles, setDeleteFolderHasFiles] = useState(false);

  // File dialogs
  const [renameFileOpen, setRenameFileOpen] = useState(false);
  const [renameFileId, setRenameFileId] = useState<number | null>(null);
  const [renameFileName, setRenameFileName] = useState("");
  const [deleteFileId, setDeleteFileId] = useState<number | null>(null);
  const [deleteFileName, setDeleteFileName] = useState("");
  const [moveFileOpen, setMoveFileOpen] = useState(false);
  const [moveFileId, setMoveFileId] = useState<number | null>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<string>("unfiled");

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: folders = [], isLoading: foldersLoading } = useQuery<FileFolder[]>({
    queryKey: ["/api/file-folders"],
  });

  const { data: allFiles = [], isLoading: filesLoading } = useQuery<StoredFile[]>({
    queryKey: ["/api/files"],
  });

  // Files in current folder
  const folderFiles = allFiles.filter((f) => {
    const match =
      selectedFolderId === "unfiled"
        ? f.folderId == null
        : f.folderId === selectedFolderId;
    if (!match) return false;
    if (!search.trim()) return true;
    return visibleName(f).toLowerCase().includes(search.toLowerCase());
  });

  const fileCountForFolder = (id: number | null) =>
    allFiles.filter((f) => (id === null ? f.folderId == null : f.folderId === id)).length;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => apiRequest("POST", "/api/file-folders", { name }),
    onSuccess: () => {
      toast({ title: "Folder created" });
      setNewFolderName("");
      setNewFolderOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/file-folders"] });
    },
    onError: (e: any) => { if (!e?._handledGlobally) toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) =>
      apiRequest("PATCH", `/api/file-folders/${id}`, { name }),
    onSuccess: () => {
      toast({ title: "Folder renamed" });
      setRenameFolderOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/file-folders"] });
    },
    onError: (e: any) => { if (!e?._handledGlobally) toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/file-folders/${id}`),
    onSuccess: () => {
      toast({ title: "Folder deleted" });
      setDeleteFolderId(null);
      if (selectedFolderId === deleteFolderId) setSelectedFolderId("unfiled");
      queryClient.invalidateQueries({ queryKey: ["/api/file-folders"] });
    },
    onError: (e: any) => {
      if (!e?._handledGlobally) toast({ title: "Cannot delete", description: e.message, variant: "destructive" });
      setDeleteFolderId(null);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      if (selectedFolderId !== "unfiled" && selectedFolderId !== null) {
        formData.append("folderId", String(selectedFolderId));
      }
      const res = await fetch("/api/files/upload", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Upload failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "File uploaded" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (e: any) => { if (!e?._handledGlobally) toast({ title: "Upload failed", description: e.message, variant: "destructive" }); },
  });

  const renameFileMutation = useMutation({
    mutationFn: async ({ id, displayName }: { id: number; displayName: string }) =>
      apiRequest("PATCH", `/api/files/${id}`, { displayName }),
    onSuccess: () => {
      toast({ title: "File renamed" });
      setRenameFileOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (e: any) => { if (!e?._handledGlobally) toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const moveFileMutation = useMutation({
    mutationFn: async ({ id, folderId }: { id: number; folderId: number | null }) =>
      apiRequest("PATCH", `/api/files/${id}`, { folderId }),
    onSuccess: () => {
      toast({ title: "File moved" });
      setMoveFileOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (e: any) => { if (!e?._handledGlobally) toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/files/${id}`),
    onSuccess: () => {
      toast({ title: "File deleted" });
      setDeleteFileId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (e: any) => { if (!e?._handledGlobally) toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  // ── Download ───────────────────────────────────────────────────────────────
  const handleDownload = async (file: StoredFile) => {
    try {
      const res = await fetch(`/api/files/${file.id}/download`, { credentials: "include" });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = visibleName(file);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  // ── Preview ────────────────────────────────────────────────────────────────
  const revokePreviewUrl = useCallback(() => {
    if (previewBlobUrl.current) {
      URL.revokeObjectURL(previewBlobUrl.current);
      previewBlobUrl.current = null;
    }
  }, []);

  const closePreview = useCallback(() => {
    revokePreviewUrl();
    setPreview(null);
  }, [revokePreviewUrl]);

  useEffect(() => () => revokePreviewUrl(), [revokePreviewUrl]);

  const openPreview = async (file: StoredFile) => {
    const type = getPreviewType(file);
    setPreview({ file, type, loading: true });
    try {
      const res = await fetch(`/api/files/${file.id}/preview`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");

      if (type === "pdf" || type === "image") {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        previewBlobUrl.current = url;
        setPreview({ file, type, blobUrl: url, loading: false });
      } else if (type === "csv") {
        const text = await res.text();
        const rows = text.split("\n").filter(Boolean).map((line) => {
          const result: string[] = [];
          let cur = "";
          let inQ = false;
          for (const ch of line) {
            if (ch === '"') { inQ = !inQ; }
            else if (ch === "," && !inQ) { result.push(cur); cur = ""; }
            else { cur += ch; }
          }
          result.push(cur);
          return result;
        });
        setPreview({ file, type, rows, loading: false });
      } else if (type === "text") {
        const text = await res.text();
        setPreview({ file, type, text, loading: false });
      } else if (type === "excel") {
        const ab = await res.arrayBuffer();
        try {
          const wb = await readFromBuffer(ab);
          const sheet = wb.worksheets[0];
          const rows: any[][] = [];
          sheet.eachRow((row) => {
            rows.push((row.values as any[]).slice(1));
          });
          setPreview({ file, type, rows, loading: false });
        } catch {
          setPreview({ file, type: "unsupported", loading: false });
        }
      } else {
        setPreview({ file, type: "unsupported", loading: false });
      }
    } catch {
      setPreview((p) => p ? { ...p, loading: false, error: true } : null);
    }
  };

  // ── Folder panel ──────────────────────────────────────────────────────────
  const currentFolderName =
    selectedFolderId === "unfiled"
      ? "Unfiled"
      : folders.find((f) => f.id === selectedFolderId)?.name ?? "Files";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">File Storage</h2>
      </div>

      <div className="flex gap-4 min-h-[600px]">
        {/* ── Left: Folders ───────────────────────────────────────────────── */}
        <div className="w-52 shrink-0 flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1 mb-1">Folders</p>

          {/* Unfiled */}
          <button
            className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left hover-elevate ${selectedFolderId === "unfiled" ? "bg-accent text-accent-foreground" : ""}`}
            onClick={() => setSelectedFolderId("unfiled")}
            data-testid="button-folder-unfiled"
          >
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">Unfiled</span>
            <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">{fileCountForFolder(null)}</Badge>
          </button>

          {/* Created folders */}
          {foldersLoading ? (
            <div className="space-y-1 px-1">
              {[1, 2].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
            </div>
          ) : (
            folders.map((folder) => (
              <div key={folder.id} className="group flex items-center gap-1 w-full">
                <button
                  className={`flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-md text-sm text-left hover-elevate ${selectedFolderId === folder.id ? "bg-accent text-accent-foreground" : ""}`}
                  onClick={() => setSelectedFolderId(folder.id)}
                  data-testid={`button-folder-${folder.id}`}
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{folder.name}</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">{fileCountForFolder(folder.id)}</Badge>
                </button>
                <div className="invisible group-hover:visible flex items-center gap-0.5 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => { setRenameFolderId(folder.id); setRenameFolderName(folder.name); setRenameFolderOpen(true); }}
                    data-testid={`button-rename-folder-${folder.id}`}
                    title="Rename folder"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => { setDeleteFolderId(folder.id); setDeleteFolderName(folder.name); setDeleteFolderHasFiles(fileCountForFolder(folder.id) > 0); }}
                    data-testid={`button-delete-folder-${folder.id}`}
                    title="Delete folder"
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          )}

          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => { setNewFolderName(""); setNewFolderOpen(true); }}
            data-testid="button-new-folder"
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            New Folder
          </Button>
        </div>

        {/* ── Right: File Area ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm font-medium flex-1">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              {currentFolderName}
              <span className="text-muted-foreground font-normal text-xs">({folderFiles.length} files)</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-44 h-8 text-sm"
                data-testid="input-file-search"
              />
            </div>
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              data-testid="button-upload-file"
            >
              {uploadMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Uploading...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />Upload</>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.csv,.doc,.docx,.txt,.gif,.bmp,.svg"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadMutation.mutate({ file }); }}
              data-testid="input-file-picker"
            />
          </div>

          {/* File list */}
          <div className="border rounded-md overflow-hidden">
            {filesLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : folderFiles.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <Database className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{search ? "No files match your search." : "No files in this folder. Upload a file above."}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-24">Size</TableHead>
                    <TableHead className="w-32">Uploaded</TableHead>
                    <TableHead className="text-right w-40">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {folderFiles.map((file) => (
                    <TableRow key={file.id} data-testid={`row-file-${file.id}`}>
                      <TableCell className="pr-0">
                        <FileIcon fileType={file.fileType} fileName={file.fileName} className="h-4 w-4" />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm truncate max-w-[260px]">{visibleName(file)}</span>
                          {file.displayName && (
                            <span className="text-xs text-muted-foreground truncate max-w-[260px]">{file.fileName}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{formatSize(file.fileSize)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatDisplayDate(file.uploadedAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => openPreview(file)}
                            title="View"
                            data-testid={`button-view-${file.id}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => { setRenameFileId(file.id); setRenameFileName(visibleName(file)); setRenameFileOpen(true); }}
                            title="Rename"
                            data-testid={`button-rename-file-${file.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => { setMoveFileId(file.id); setMoveFolderTarget(file.folderId ? String(file.folderId) : "unfiled"); setMoveFileOpen(true); }}
                            title="Move"
                            data-testid={`button-move-file-${file.id}`}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleDownload(file)}
                            title="Download"
                            data-testid={`button-download-${file.id}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => { setDeleteFileId(file.id); setDeleteFileName(visibleName(file)); }}
                            title="Delete"
                            data-testid={`button-delete-file-${file.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      {/* ── Preview Modal ────────────────────────────────────────────────────── */}
      <PreviewModal preview={preview} onClose={closePreview} onDownload={handleDownload} />

      {/* ── New Folder Dialog ────────────────────────────────────────────────── */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Folder</DialogTitle></DialogHeader>
          <Input
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newFolderName.trim()) createFolderMutation.mutate(newFolderName.trim()); }}
            autoFocus
            data-testid="input-new-folder-name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button
              disabled={!newFolderName.trim() || createFolderMutation.isPending}
              onClick={() => createFolderMutation.mutate(newFolderName.trim())}
              data-testid="button-create-folder-confirm"
            >
              {createFolderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename Folder Dialog ─────────────────────────────────────────────── */}
      <Dialog open={renameFolderOpen} onOpenChange={setRenameFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename Folder</DialogTitle></DialogHeader>
          <Input
            placeholder="Folder name"
            value={renameFolderName}
            onChange={(e) => setRenameFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && renameFolderName.trim() && renameFolderId) renameFolderMutation.mutate({ id: renameFolderId, name: renameFolderName.trim() }); }}
            autoFocus
            data-testid="input-rename-folder"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameFolderOpen(false)}>Cancel</Button>
            <Button
              disabled={!renameFolderName.trim() || renameFolderMutation.isPending}
              onClick={() => { if (renameFolderId) renameFolderMutation.mutate({ id: renameFolderId, name: renameFolderName.trim() }); }}
              data-testid="button-rename-folder-confirm"
            >
              {renameFolderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Folder Dialog ─────────────────────────────────────────────── */}
      <AlertDialog open={deleteFolderId !== null} onOpenChange={(open) => { if (!open) setDeleteFolderId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder "{deleteFolderName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFolderHasFiles
                ? "This folder still has files. Move or delete them before removing the folder."
                : "This folder will be permanently deleted. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!deleteFolderHasFiles && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={() => { if (deleteFolderId) deleteFolderMutation.mutate(deleteFolderId); }}
                data-testid="button-confirm-delete-folder"
              >
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Rename File Dialog ───────────────────────────────────────────────── */}
      <Dialog open={renameFileOpen} onOpenChange={setRenameFileOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename File</DialogTitle></DialogHeader>
          <Input
            placeholder="Display name"
            value={renameFileName}
            onChange={(e) => setRenameFileName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && renameFileName.trim() && renameFileId) renameFileMutation.mutate({ id: renameFileId, displayName: renameFileName.trim() }); }}
            autoFocus
            data-testid="input-rename-file"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameFileOpen(false)}>Cancel</Button>
            <Button
              disabled={!renameFileName.trim() || renameFileMutation.isPending}
              onClick={() => { if (renameFileId) renameFileMutation.mutate({ id: renameFileId, displayName: renameFileName.trim() }); }}
              data-testid="button-rename-file-confirm"
            >
              {renameFileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Move File Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={moveFileOpen} onOpenChange={setMoveFileOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Move File</DialogTitle></DialogHeader>
          <Select value={moveFolderTarget} onValueChange={setMoveFolderTarget}>
            <SelectTrigger data-testid="select-move-destination">
              <SelectValue placeholder="Select folder..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unfiled">Unfiled</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveFileOpen(false)}>Cancel</Button>
            <Button
              disabled={moveFileMutation.isPending}
              onClick={() => {
                if (!moveFileId) return;
                const folderId = moveFolderTarget === "unfiled" ? null : parseInt(moveFolderTarget);
                moveFileMutation.mutate({ id: moveFileId, folderId });
              }}
              data-testid="button-move-file-confirm"
            >
              {moveFileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete File Dialog ───────────────────────────────────────────────── */}
      <AlertDialog open={deleteFileId !== null} onOpenChange={(open) => { if (!open) setDeleteFileId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteFileName}" will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => { if (deleteFileId) deleteFileMutation.mutate(deleteFileId); }}
              data-testid="button-confirm-delete-file"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
