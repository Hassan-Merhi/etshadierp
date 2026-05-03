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


export function LoginHistoryTab() {
  const { formatDisplayDate } = useDateFormat();
  const { data: history, isLoading } = useQuery<any[]>({
    queryKey: ["/api/login-history"],
  });
  
  const [filterUser, setFilterUser] = useState("");
  
  const filteredHistory = history?.filter((entry: any) => {
    if (!filterUser) return true;
    return entry.username.toLowerCase().includes(filterUser.toLowerCase());
  }) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="section-login-history">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold" data-testid="text-login-history-title">Login History</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Filter by username..."
            value={filterUser}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterUser(e.target.value)}
            className="w-48"
            data-testid="input-filter-username"
          />
        </div>
      </div>
      
      {filteredHistory.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No login history found.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="table-responsive">
            <table className="w-full text-sm" data-testid="table-login-history">
              <thead className="sticky top-0 z-30 bg-muted/50">
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">User</th>
                  <th className="text-left p-3 font-medium">Company</th>
                  <th className="text-left p-3 font-medium">Date & Time</th>
                  <th className="text-left p-3 font-medium">IP Address</th>
                  <th className="text-left p-3 font-medium">Location</th>
                  <th className="text-left p-3 font-medium">Device</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((entry: any) => {
                  const loginDate = new Date(entry.loginAt);
                  const locationParts = [entry.city, entry.country].filter(Boolean);
                  const locationStr = locationParts.length > 0 ? locationParts.join(", ") : "Unknown";
                  
                  const ua = entry.userAgent || "";
                  let deviceStr = "Unknown";
                  if (ua.includes("Mobile")) deviceStr = "Mobile";
                  else if (ua.includes("Tablet")) deviceStr = "Tablet";
                  else if (ua.includes("Windows")) deviceStr = "Windows";
                  else if (ua.includes("Mac")) deviceStr = "Mac";
                  else if (ua.includes("Linux")) deviceStr = "Linux";
                  else if (ua.includes("Chrome")) deviceStr = "Chrome";
                  else if (ua.includes("Firefox")) deviceStr = "Firefox";
                  
                  return (
                    <tr key={entry.id} className="border-b last:border-0 hover-elevate" data-testid={`row-login-${entry.id}`}>
                      <td className="p-3 font-medium" data-testid={`text-login-user-${entry.id}`}>{entry.username}</td>
                      <td className="p-3 text-muted-foreground" data-testid={`text-login-company-${entry.id}`}>{entry.companyName || "-"}</td>
                      <td className="p-3 text-muted-foreground" data-testid={`text-login-date-${entry.id}`}>
                        {formatDisplayDate(loginDate)} {loginDate.toLocaleTimeString()}
                      </td>
                      <td className="p-3 font-mono text-xs text-muted-foreground" data-testid={`text-login-ip-${entry.id}`}>{entry.ipAddress || "-"}</td>
                      <td className="p-3 text-muted-foreground" data-testid={`text-login-location-${entry.id}`}>{locationStr}</td>
                      <td className="p-3 text-muted-foreground" data-testid={`text-login-device-${entry.id}`}>{deviceStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      
      <p className="text-xs text-muted-foreground">
        Showing last {filteredHistory.length} login events. Location data is approximate and based on IP address.
      </p>
    </div>
  );
}

