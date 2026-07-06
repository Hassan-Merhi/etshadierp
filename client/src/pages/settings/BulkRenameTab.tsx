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

export function BulkRenameTab() {
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [findText, setFindText] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [wholeWordOnly, setWholeWordOnly] = useState(false);
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [matchingItems, setMatchingItems] = useState<{ id: number; code: string; name: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const buildRegex = () => {
    if (!findText.trim()) return null;
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = wholeWordOnly ? `\\b${escaped}\\b` : escaped;
    const flags = caseInsensitive ? "gi" : "g";
    return new RegExp(pattern, flags);
  };

  const handleSearch = async () => {
    if (!findText.trim()) {
      toast({ title: "Error", description: "Please enter text to find", variant: "destructive" });
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch("/api/stock-items", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stock items");
      const allItems = await res.json();
      const regex = buildRegex();
      if (!regex) return;
      const matches = allItems
        .filter((item: any) => regex.test(item.name))
        .map((item: any) => ({
          id: item.id,
          code: item.code || "",
          name: item.name,
        }));
      regex.lastIndex = 0;
      setMatchingItems(matches);
      setSelectedIds(new Set(matches.map((m: any) => m.id)));
      if (matches.length === 0) {
        toast({ title: "No matches", description: "No stock items matched the search text" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  const getPreviewName = (name: string) => {
    const regex = buildRegex();
    if (!regex) return name;
    return name.replace(regex, replaceWith);
  };

  const renderPreviewName = (name: string) => {
    const regex = buildRegex();
    if (!regex) return name;
    const parts: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const r = new RegExp(regex.source, regex.flags);
    while ((match = r.exec(name)) !== null) {
      if (match.index > lastIndex) {
        parts.push(name.slice(lastIndex, match.index));
      }
      parts.push(
        <span key={match.index} className="text-green-600 dark:text-green-400 font-medium">
          {replaceWith}
        </span>
      );
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) {
        r.lastIndex++;
      }
    }
    if (lastIndex < name.length) {
      parts.push(name.slice(lastIndex));
    }
    return <>{parts}</>;
  };

  const handleApply = async () => {
    if (selectedIds.size === 0) return;
    setIsApplying(true);
    try {
      const res = await modeApiRequest("POST", "/api/stock-items/bulk-rename", {
        findText,
        replaceWith,
        itemIds: Array.from(selectedIds),
        wholeWordOnly,
        caseInsensitive,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      toast({
        title: "Bulk Rename Complete",
        description: `${data.updated} item(s) renamed successfully`,
      });
      if (data.failures && data.failures.length > 0) {
        toast({
          title: "Some items failed",
          description: data.failures.map((f: any) => `${f.name}: ${f.reason}`).join(", "),
          variant: "destructive",
        });
      }
      setMatchingItems([]);
      setSelectedIds(new Set());
      setFindText("");
      setReplaceWith("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  };

  const toggleItem = async (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = async () => setSelectedIds(new Set(matchingItems.map((m) => m.id)));
  const clearAll = async () => setSelectedIds(new Set());

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="text-bulk-rename-title">Bulk Rename Stock Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="bulk-find-text">Find Text</Label>
            <Input
              id="bulk-find-text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              placeholder="Text to find in item names..."
              data-testid="input-bulk-find-text"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bulk-replace-with">Replace With</Label>
            <Input
              id="bulk-replace-with"
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
              placeholder="Replacement text..."
              data-testid="input-bulk-replace-with"
            />
          </div>
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <Checkbox
              id="bulk-whole-word"
              checked={wholeWordOnly}
              onCheckedChange={(checked) => setWholeWordOnly(checked === true)}
              data-testid="checkbox-whole-word"
            />
            <Label htmlFor="bulk-whole-word" className="cursor-pointer">
              Whole word only
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="bulk-case-insensitive"
              checked={caseInsensitive}
              onCheckedChange={(checked) => setCaseInsensitive(checked === true)}
              data-testid="checkbox-case-insensitive"
            />
            <Label htmlFor="bulk-case-insensitive" className="cursor-pointer">
              Case insensitive
            </Label>
          </div>
          <Button onClick={handleSearch} disabled={isSearching || !findText.trim()} data-testid="button-bulk-search">
            {isSearching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Search
          </Button>
        </div>

        {matchingItems.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground" data-testid="text-match-count">
                {matchingItems.length} item(s) found, {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={selectAll} data-testid="button-select-all">
                  Select All
                </Button>
                <Button size="sm" variant="outline" onClick={clearAll} data-testid="button-clear-all">
                  Clear All
                </Button>
              </div>
            </div>
            <div className="border rounded-md overflow-auto max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Item Code</TableHead>
                    <TableHead>Current Name</TableHead>
                    <TableHead>Preview New Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matchingItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => toggleItem(item.id)}
                          data-testid={`checkbox-item-${item.id}`}
                        />
                      </TableCell>
                      <TableCell data-testid={`text-item-code-${item.id}`}>{item.code}</TableCell>
                      <TableCell data-testid={`text-item-name-${item.id}`}>{item.name}</TableCell>
                      <TableCell data-testid={`text-item-preview-${item.id}`}>{renderPreviewName(item.name)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={selectedIds.size === 0 || isApplying} data-testid="button-apply-rename">
                    {isApplying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Apply Changes
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Rename {selectedIds.size} items?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will replace "{findText}" with "{replaceWith}" in {selectedIds.size} selected item name(s).
                      This action cannot be easily undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-rename">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleApply} data-testid="button-confirm-rename">
                      Confirm Rename
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Single source of truth: derived from FactorySidebar nav — new pages appear automatically
const ALL_FACTORY_PAGES_SETTINGS = FACTORY_NAV_PAGES;
const FACTORY_PAGE_GROUPS_SETTINGS = Array.from(new Set(ALL_FACTORY_PAGES_SETTINGS.map((p) => p.group)));

// Single source of truth: derived from FEATURE_KEYS + FEATURE_PAGE_INFO in shared/schema
const ALL_ERP_PAGES: { key: string; label: string; group: string }[] = FEATURE_KEYS.map((key) => ({
  key,
  label: FEATURE_PAGE_INFO[key].label,
  group: FEATURE_PAGE_INFO[key].group,
}));

const ERP_PAGE_GROUPS = Array.from(new Set(ALL_ERP_PAGES.map((p) => p.group)));

const ERP_COST_FIELDS = [
  { key: "daybook_amounts", label: "Transaction Amounts" },
  { key: "accounts_balances", label: "Account Balances" },
  { key: "container_costs", label: "Cost & Fee Columns" },
  { key: "stock_rates", label: "Rate / Price Columns" },
  { key: "analytics_financials", label: "Revenue & Profit" },
  { key: "voucher_amounts", label: "Amount Columns" },
];

const FACTORY_COST_FIELDS = [
  { key: "inventory_avg_rate", label: "Avg Rate Column" },
  { key: "inventory_total_value", label: "Total Value Column" },
  { key: "inventory_sell_price", label: "Sell Price Column" },
  { key: "inventory_sell_value", label: "Sell Value Column" },
  { key: "bale_history_cost_per_kg", label: "Cost/KG Column" },
  { key: "bale_history_total_cost", label: "Total Cost Column" },
  { key: "bales_list_cost_per_kg", label: "Cost/kg Column" },
];

const PAGE_COST_FIELD_MAP: Record<string, { key: string; label: string }[]> = {
  daybook: [ERP_COST_FIELDS[0]],
  accounts: [ERP_COST_FIELDS[1]],
  containers: [ERP_COST_FIELDS[2]],
  stock_items: [ERP_COST_FIELDS[3]],
  analytics: [ERP_COST_FIELDS[4]],
  vouchers: [ERP_COST_FIELDS[5]],
  "factory/location-inventory": [
    FACTORY_COST_FIELDS[0],
    FACTORY_COST_FIELDS[1],
    FACTORY_COST_FIELDS[2],
    FACTORY_COST_FIELDS[3],
  ],
  "factory/bales-history": [FACTORY_COST_FIELDS[4], FACTORY_COST_FIELDS[5]],
  "factory/stock-entry": [FACTORY_COST_FIELDS[6]],
};
