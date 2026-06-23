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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest, factoryApiRequest } from "@/lib/factoryApi";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Edit,
  Building2,
  Users,
  ChevronDown,
  ChevronUp,
  Trash2,
  CalendarRange,
  Settings2,
  Wrench,
  MapPin,
  ChevronRight,
  Bot,
  MessageCircle,
  RefreshCw,
  Calculator,
  Loader2,
  Shield,
  AlertTriangle,
  PieChart,
  Key,
  Lock,
  Package,
  Eye,
  History,
  Clock,
  Upload,
  Download,
  Database,
  TrendingUp,
  ShoppingCart,
  Check,
  X,
  Copy,
  ExternalLink,
  ArrowLeftRight,
  WifiOff,
  Wifi,
  CheckCircle2,
  Printer,
  Layers,
} from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
import { Link } from "wouter";
import { useDateFormat } from "@/contexts/DateFormatContext";
import {
  insertUserSchema,
  insertCompanySchema,
  insertUserCompanyRoleSchema,
  FEATURE_KEYS,
  FEATURE_PAGE_INFO,
  type FeatureKey,
} from "@shared/schema";
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

export function NetPositionAdjustmentCard() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [adjustmentValue, setAdjustmentValue] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);

  const { data: currentUser } = useQuery<{ role?: string }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    queryFn: async () => {
      try {
        const res = await fetch(`/api/company-settings?companyId=${selectedCompany?.id}`, { credentials: "include" });
        if (res.status === 404) return { companyId: selectedCompany?.id, netPositionAdjustment: "0" };
        if (!res.ok) throw new Error("Failed to fetch settings");
        return res.json();
      } catch {
        return { companyId: selectedCompany?.id, netPositionAdjustment: "0" };
      }
    },
  });

  const currentAdjustment = parseFloat(companySettings?.netPositionAdjustment || "0");

  const updateAdjustmentMutation = useMutation({
    mutationFn: async (value: string) => {
      const res = await modeApiRequest("POST", "/api/company-settings", {
        companyId: selectedCompany?.id,
        netPositionAdjustment: value,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Updated",
        description: "Net Position Adjustment has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/profit"] });
      setIsEditing(false);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update adjustment",
        variant: "destructive",
      });
    },
  });

  if (!selectedCompany) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">Select a company to set Net Position Adjustment.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-lg">
            <Calculator className="h-6 w-6 text-blue-500" />
          </div>
          <div>
            <h3 className="font-semibold" data-testid="text-net-position-adjustment-title">
              Net Position Adjustment
            </h3>
            <p className="text-sm text-muted-foreground">
              Reduce the Net Position by a fixed amount (for {selectedCompany.name}). This does not affect Import Cycle
              Balance.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Input
                type="number"
                value={adjustmentValue}
                onChange={(e) => setAdjustmentValue(e.target.value)}
                placeholder="0"
                className="w-32"
                data-testid="input-net-position-adjustment"
              />
              <Button
                size="sm"
                onClick={() => updateAdjustmentMutation.mutate(adjustmentValue)}
                disabled={updateAdjustmentMutation.isPending}
                data-testid="button-save-adjustment"
              >
                {updateAdjustmentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsEditing(false)}
                data-testid="button-cancel-adjustment"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="font-mono text-lg" data-testid="text-current-adjustment">
                ${formatNumber(currentAdjustment)}
              </span>
              {(currentUser?.role === "Admin" || currentUser?.role === "Developer") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAdjustmentValue(currentAdjustment.toString());
                    setIsEditing(true);
                  }}
                  data-testid="button-edit-adjustment"
                >
                  <Edit className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
          {currentUser?.role !== "Admin" && currentUser?.role !== "Developer" && !isEditing && (
            <span className="text-xs text-muted-foreground">(Admin only)</span>
          )}
        </div>
      </div>
    </Card>
  );
}
