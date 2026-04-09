  import { useState, useEffect, useRef } from "react";
  import { useConnectivity } from "@/contexts/ConnectivityContext";
  import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
  import { OfflinePrepPanel } from "@/components/OfflinePrepPanel";
  import { useForm } from "react-hook-form";
  import { zodResolver } from "@hookform/resolvers/zod";
  import { z } from "zod";
  import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  import { Alert, AlertDescription } from "@/components/ui/alert";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from "@/components/ui/alert-dialog";
  import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
  } from "@/components/ui/form";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { Checkbox } from "@/components/ui/checkbox";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Badge } from "@/components/ui/badge";
  import { Skeleton } from "@/components/ui/skeleton";
  import { Switch } from "@/components/ui/switch";
  
  import { useToast } from "@/hooks/use-toast";
  import { useMutation, useQuery } from "@tanstack/react-query";
  import { queryClient, apiRequest } from "@/lib/queryClient";
  import { useAppMode } from "@/contexts/AppModeContext";
  import { getApiRequest, factoryApiRequest } from "@/lib/factoryApi";
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, ShoppingCart, Check, X, Copy, ExternalLink, ArrowLeftRight, WifiOff, Wifi, CheckCircle2, Printer, Layers } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema, FEATURE_KEYS, FEATURE_PAGE_INFO, type FeatureKey } from "@shared/schema";
  import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
  import { ExchangeRateSettings } from "@/components/ExchangeRateSettings";
  import { formatNumber } from "@/lib/formatNumber";
  
  const userFormSchema = insertUserSchema;
  const companyFormSchema = insertCompanySchema;
  const roleAssignmentSchema = insertUserCompanyRoleSchema.refine(
    (data) => {
      // If role is POS, assignedLocationId must be present
      if (data.role.startsWith("POS") && !data.assignedLocationId) {
        return false;
      }
      return true;
    },
    {
      message: "POS roles require an assigned location",
      path: ["assignedLocationId"],
    }
  );
  
  type UserFormData = z.infer<typeof userFormSchema>;
  type CompanyFormData = z.infer<typeof companyFormSchema>;
  type RoleAssignmentData = z.infer<typeof roleAssignmentSchema>;


export function FileStorageTab() {
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: files = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/files"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, desc }: { file: File; desc: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      if (desc) formData.append("description", desc);
      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "File uploaded", description: "Your file has been stored." });
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/files/${id}`),
    onSuccess: () => {
      toast({ title: "File deleted" });
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate({ file, desc: description });
  };

  const handleDownload = async (id: number, fileName: string) => {
    try {
      const res = await fetch(`/api/files/${id}/download`, { credentials: "include" });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">File Storage</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload a File</CardTitle>
          <CardDescription>Store documents, reports, or any files (max 10 MB each).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex-1"
              data-testid="input-file-description"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              data-testid="button-upload-file"
            >
              {uploadMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Uploading...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />Choose File</>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file-picker"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stored Files</CardTitle>
          <CardDescription>{files.length} file{files.length !== 1 ? "s" : ""} stored</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Database className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No files stored yet. Upload a file above.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file: any) => (
                  <TableRow key={file.id} data-testid={`row-file-${file.id}`}>
                    <TableCell className="font-medium max-w-[200px] truncate">{file.fileName}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">{file.description || "—"}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">{formatSize(file.fileSize)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDisplayDate(file.uploadedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDownload(file.id, file.fileName)}
                          data-testid={`button-download-${file.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <AlertDialog open={deleteId === file.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteId(file.id)}
                              data-testid={`button-delete-file-${file.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete file?</AlertDialogTitle>
                              <AlertDialogDescription>
                                "{file.fileName}" will be permanently deleted. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(file.id)}
                                className="bg-destructive text-destructive-foreground"
                                data-testid={`button-confirm-delete-${file.id}`}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

