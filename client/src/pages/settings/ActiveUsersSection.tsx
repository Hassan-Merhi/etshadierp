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


  export function ActiveUsersSection() {
    const { data: presenceData, isLoading } = useQuery<any[]>({
      queryKey: ["/api/user-presence"],
      refetchInterval: 30000, // Refresh every 30 seconds
    });

    const { data: companies } = useQuery<any[]>({
      queryKey: ["/api/companies"],
    });

    const formatTimeAgo = (dateStr: string) => {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return "Just now";
      if (diffMins === 1) return "1 min ago";
      if (diffMins < 60) return `${diffMins} mins ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours === 1) return "1 hour ago";
      return `${diffHours} hours ago`;
    };

    const getCompanyName = (companyId: number | null) => {
      if (!companyId || !companies) return "—";
      const company = companies.find((c: any) => c.id === companyId);
      return company?.name || "Unknown";
    };

    const getPageLabel = (route: string) => {
      if (!route || route === "/") return "Dashboard";
      const routeLabels: Record<string, string> = {
        "/": "Dashboard",
        "/dashboard": "Dashboard",
        "/locations": "Locations",
        "/locations/inventory": "Location Inventory",
        "/stock-items": "Stock Items",
        "/stock-groups": "Stock Groups",
        "/ledger-accounts": "Ledger Accounts",
        "/vouchers": "Vouchers",
        "/vouchers/payment": "Payment Vouchers",
        "/vouchers/receipt": "Receipt Vouchers",
        "/vouchers/journal": "Journal Vouchers",
        "/vouchers/sales": "Sales Vouchers",
        "/purchase-orders": "Purchase Orders",
        "/containers": "Containers",
        "/containers/otw": "Containers OTW",
        "/employees": "Employees",
        "/customers": "Customers",
        "/suppliers": "Suppliers",
        "/bank-accounts": "Bank Accounts",
        "/reports": "Reports",
        "/reports/profit-loss": "Profit & Loss",
        "/reports/balance-sheet": "Balance Sheet",
        "/settings": "Settings",
        "/pos": "Point of Sale",
        "/pos/sales": "POS Sales",
        "/chatbot": "AI Chatbot",
        "/deleted-items": "Deleted Items",
      };
      if (routeLabels[route]) return routeLabels[route];
      const cleanRoute = route.replace(/^\//, "").replace(/-/g, " ").replace(/\//g, " > ");
      return cleanRoute.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    };

    // Group users by company
    const groupedUsers = presenceData?.reduce((acc: any, presence: any) => {
      const companyId = presence.companyId || "unassigned";
      if (!acc[companyId]) {
        acc[companyId] = [];
      }
      acc[companyId].push(presence);
      return acc;
    }, {} as Record<string, any[]>) || {};

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          <h2 className="text-2xl font-semibold">Active Users</h2>
        </div>
        <p className="text-muted-foreground">
          Monitor currently active users and their location in the application.
        </p>

        {isLoading ? (
          <Card className="p-6">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading active users...</span>
            </div>
          </Card>
        ) : !presenceData || presenceData.length === 0 ? (
          <Card className="p-6">
            <p className="text-muted-foreground">No active users at the moment.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedUsers).map(([companyId, users]: [string, any]) => (
              <Card key={companyId} className="overflow-hidden">
                <div className="px-4 py-3 bg-muted/50 border-b">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <h3 className="font-medium">
                      {companyId === "unassigned" ? "No Company Selected" : getCompanyName(Number(companyId))}
                    </h3>
                    <Badge variant="secondary" className="ml-2">{users.length}</Badge>
                  </div>
                </div>
                {/* Desktop table */}
                <div className="hidden sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Current Page</TableHead>
                        <TableHead>Last Active</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((presence: any) => (
                        <TableRow key={presence.id} data-testid={`row-presence-${presence.id}`}>
                          <TableCell className="font-medium">{presence.username}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{presence.role || "—"}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {getPageLabel(presence.currentRoute)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatTimeAgo(presence.lastSeen)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Mobile card list */}
                <div className="sm:hidden divide-y">
                  {users.map((presence: any) => (
                    <div key={presence.id} data-testid={`row-presence-${presence.id}`} className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{presence.username}</span>
                        <Badge variant="outline" className="text-xs">{presence.role || "—"}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{getPageLabel(presence.currentRoute)}</span>
                        <span>{formatTimeAgo(presence.lastSeen)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

// Data Tools Tab component - consolidates administrative utilities
