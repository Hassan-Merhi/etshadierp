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
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, ShoppingCart, Check, X, Copy, ExternalLink, ArrowLeftRight, WifiOff, Wifi, CheckCircle2, Printer, Layers, Maximize2 } from "lucide-react";
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


  import { getPageLabel, WatchUserDialog } from "./WatchUserDialog";

  export function ActiveUsersSection() {
    const [watchingUser, setWatchingUser] = useState<{ userId: string; username: string } | null>(null);

    const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
    const isDeveloper = currentUser?.role === "Developer";

    const { data: presenceData, isLoading } = useQuery<any[]>({
      queryKey: ["/api/user-presence"],
      refetchInterval: 30000,
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

    // Group users by company
    const safePresenceData = Array.isArray(presenceData) ? presenceData : [];
    const groupedUsers = safePresenceData.reduce((acc: any, presence: any) => {
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
        ) : safePresenceData.length === 0 ? (
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
                        <TableHead className="w-16" />
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
                          {isDeveloper && (
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid={`button-watch-${presence.userId}`}
                              disabled={!presence.userId}
                              onClick={() => presence.userId && setWatchingUser({ userId: String(presence.userId), username: presence.username })}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              Watch
                            </Button>
                          </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Mobile card list */}
                <div className="sm:hidden divide-y">
                  {users.map((presence: any) => (
                    <div key={presence.id} data-testid={`row-presence-${presence.id}`} className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium text-sm">{presence.username}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{presence.role || "—"}</Badge>
                          {isDeveloper && (
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid={`button-watch-mobile-${presence.userId}`}
                              disabled={!presence.userId}
                              onClick={() => presence.userId && setWatchingUser({ userId: String(presence.userId), username: presence.username })}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              Watch
                            </Button>
                          )}
                        </div>
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

        {watchingUser && (
          <WatchUserDialog
            userId={watchingUser.userId}
            username={watchingUser.username}
            onClose={() => setWatchingUser(null)}
          />
        )}
      </div>
    );
  }

// Data Tools Tab component - consolidates administrative utilities
