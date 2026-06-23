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

export function ParentCreditAccountSelect({ company }: { company: any }) {
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [isCreating, setIsCreating] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings", company.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/company-settings?companyId=${company.id}`, { credentials: "include" });
        if (res.status === 404) return { companyId: company.id, parentCreditAccountId: null };
        if (!res.ok) throw new Error("Failed to fetch settings");
        return res.json();
      } catch {
        return { companyId: company.id, parentCreditAccountId: null };
      }
    },
  });

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts", company.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/ledger-accounts?companyId=${company.id}`, { credentials: "include" });
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
  });

  const liabilityAccounts = ledgerAccounts.filter(
    (acc: any) => acc.accountType === "Liability" && acc.active && !acc.deletedAt
  );

  const updateSettingsMutation = useMutation({
    mutationFn: async (parentCreditAccountId: number | null) => {
      const res = await modeApiRequest("POST", "/api/company-settings", {
        companyId: company.id,
        parentCreditAccountId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Saved", description: "Parent credit account updated" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await modeApiRequest("POST", "/api/ledger-accounts", {
        companyId: company.id,
        name,
        accountType: "Liability",
        subType: "Current Liability",
      });
      return res.json();
    },
    onSuccess: (newAccount) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      updateSettingsMutation.mutate(newAccount.id);
      setIsCreating(false);
      setNewAccountName("");
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error creating account", description: error.message, variant: "destructive" });
    },
  });

  const currentAccountId = companySettings?.parentCreditAccountId;
  const currentAccount = ledgerAccounts.find((acc: any) => acc.id === currentAccountId);

  if (isCreating) {
    return (
      <div className="flex gap-1 items-center">
        <Input
          value={newAccountName}
          onChange={(e) => setNewAccountName(e.target.value)}
          placeholder="Account name..."
          className="h-8 w-32 text-xs"
          data-testid={`input-new-credit-account-${company.id}`}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => newAccountName && createAccountMutation.mutate(newAccountName)}
          disabled={!newAccountName || createAccountMutation.isPending}
          data-testid={`button-save-credit-account-${company.id}`}
        >
          {createAccountMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setIsCreating(false);
            setNewAccountName("");
          }}
          data-testid={`button-cancel-credit-account-${company.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={currentAccountId?.toString() || "none"}
      onValueChange={(value) => {
        if (value === "create_new") {
          setIsCreating(true);
        } else {
          const accountId = value === "none" ? null : parseInt(value, 10);
          updateSettingsMutation.mutate(accountId);
        }
      }}
      disabled={updateSettingsMutation.isPending}
    >
      <SelectTrigger className="w-40 h-8 text-xs" data-testid={`select-credit-account-${company.id}`}>
        <SelectValue placeholder="Not Set">{currentAccount ? currentAccount.name : "Not Set"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not Set</SelectItem>
        {liabilityAccounts.map((acc: any) => (
          <SelectItem key={acc.id} value={acc.id.toString()}>
            {acc.name}
          </SelectItem>
        ))}
        <SelectItem value="create_new" className="text-primary font-medium">
          + Create New Account
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
