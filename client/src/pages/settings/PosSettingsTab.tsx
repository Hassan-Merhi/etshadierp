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
      if (data.role === "POS" && !data.assignedLocationId) {
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


export function PosSettingsTab() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    queryFn: async () => {
      const res = await fetch(`/api/company-settings?companyId=${selectedCompany?.id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await modeApiRequest("POST", "/api/company-settings", {
        companyId: selectedCompany?.id,
        posExcelImportEnabled: enabled,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings", selectedCompany?.id] });
      toast({ title: "Updated", description: "POS Excel Import setting has been saved." });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const timezoneMutation = useMutation({
    mutationFn: async (tz: string) => {
      const res = await modeApiRequest("POST", "/api/company-settings", {
        companyId: selectedCompany?.id,
        timezone: tz === "browser" ? null : tz,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings", selectedCompany?.id] });
      toast({ title: "Updated", description: "Timezone setting has been saved." });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (!selectedCompany) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">Select a company to configure POS settings.</p>
      </Card>
    );
  }

  const isEnabled = companySettings?.posExcelImportEnabled ?? false;
  const currentTimezone = companySettings?.timezone || "browser";

  const TIMEZONE_OPTIONS = [
    { value: "browser", label: "Browser / Device local time" },
    { value: "UTC", label: "UTC — Coordinated Universal Time (UTC+0)" },
    { value: "Africa/Maputo", label: "Africa/Maputo (UTC+2)" },
    { value: "Africa/Cairo", label: "Africa/Cairo (UTC+2)" },
    { value: "Africa/Lagos", label: "Africa/Lagos (UTC+1)" },
    { value: "Africa/Nairobi", label: "Africa/Nairobi (UTC+3)" },
    { value: "Africa/Johannesburg", label: "Africa/Johannesburg (UTC+2)" },
    { value: "Asia/Beirut", label: "Asia/Beirut (UTC+2/+3)" },
    { value: "Asia/Dubai", label: "Asia/Dubai (UTC+4)" },
    { value: "Asia/Riyadh", label: "Asia/Riyadh (UTC+3)" },
    { value: "Asia/Kolkata", label: "Asia/Kolkata (UTC+5:30)" },
    { value: "Asia/Shanghai", label: "Asia/Shanghai (UTC+8)" },
    { value: "Europe/London", label: "Europe/London (UTC+0/+1)" },
    { value: "Europe/Paris", label: "Europe/Paris (UTC+1/+2)" },
    { value: "America/New_York", label: "America/New_York (UTC-5/-4)" },
    { value: "America/Chicago", label: "America/Chicago (UTC-6/-5)" },
    { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-8/-7)" },
    { value: "America/Sao_Paulo", label: "America/Sao_Paulo (UTC-3)" },
    { value: "Australia/Sydney", label: "Australia/Sydney (UTC+10/+11)" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShoppingCart className="h-5 w-5" />
        <h2 className="text-lg font-semibold" data-testid="text-pos-settings-title">POS Settings</h2>
      </div>
      <p className="text-sm text-muted-foreground">Configure features available to POS users for {selectedCompany.name}.</p>

      <Card className="p-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="p-3 bg-blue-500/10 rounded-lg shrink-0">
            <Clock className="h-6 w-6 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <h3 className="font-semibold" data-testid="text-company-timezone-title">Company Timezone</h3>
              <p className="text-sm text-muted-foreground">
                Fix the date used for all transactions and reports to a specific timezone.
                Useful when staff computers are in a different timezone than the business location.
              </p>
            </div>
            <Select
              value={currentTimezone}
              onValueChange={(tz) => timezoneMutation.mutate(tz)}
              disabled={timezoneMutation.isPending}
            >
              <SelectTrigger className="w-full max-w-sm" data-testid="select-company-timezone">
                <SelectValue placeholder="Select timezone…" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`option-timezone-${opt.value}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <Upload className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <h3 className="font-semibold" data-testid="text-pos-excel-import-title">POS Excel Import</h3>
              <p className="text-sm text-muted-foreground">
                Allow POS users to import sales from Excel files. When enabled, a "POS Import" option appears in their sidebar.
              </p>
            </div>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            disabled={toggleMutation.isPending}
            data-testid="switch-pos-excel-import"
          />
        </div>
      </Card>
    </div>
  );
}


