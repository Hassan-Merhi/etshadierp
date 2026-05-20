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


  function getPageLabel(route: string): string {
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
    return route.replace(/^\//, "").replace(/-/g, " ").replace(/\//g, " > ")
      .split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  function WatchUserDialog({ userId, username, onClose }: {
    userId: string;
    username: string;
    onClose: () => void;
  }) {
    const { data: presenceRaw } = useQuery<any>({
      queryKey: ["/api/user-presence", userId],
      queryFn: () => apiRequest("GET", `/api/user-presence/${userId}`),
      refetchInterval: 5000,
    });
    const { data: activityRaw } = useQuery<any>({
      queryKey: ["/api/user-presence", userId, "activity"],
      queryFn: () => apiRequest("GET", `/api/user-presence/${userId}/activity`),
      refetchInterval: 5000,
    });
    const watchStartRef = useRef(Date.now());
    const { data: screenFrameRaw } = useQuery<any>({
      queryKey: ["/api/screen-feed", userId],
      queryFn: () => apiRequest("GET", `/api/screen-feed/${userId}`),
      refetchInterval: 4000,
    });

    // Guard against unexpected non-array / non-object responses
    const presence    = presenceRaw && typeof presenceRaw === "object" && !Array.isArray(presenceRaw) ? presenceRaw : null;
    const activity    = Array.isArray(activityRaw) ? activityRaw : [];
    const screenFrame = screenFrameRaw && typeof screenFrameRaw === "object" && !Array.isArray(screenFrameRaw) ? screenFrameRaw : null;
    const clicks: Array<{ x: number; y: number; label: string; ts: number }> =
      Array.isArray(screenFrame?.clicks) ? screenFrame.clicks : [];

    const isOnline = !!presence;
    const hasScreen = !!screenFrame?.dataUrl;

    // Only show clicks from the last 4 seconds so stale dots fade naturally
    const now = Date.now();
    const recentClicks = clicks.filter(c => (now - c.ts) < 4000);

    const fmtTime = (val: string | Date | null | undefined) => {
      if (!val) return "—";
      const d = new Date(val as string);
      return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };
    const timeAgo = (val: string | Date | null | undefined) => {
      if (!val) return "unknown";
      const d = new Date(val as string);
      if (isNaN(d.getTime())) return "unknown";
      const s = Math.floor((Date.now() - d.getTime()) / 1000);
      if (s < 5)  return "just now";
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      return `${Math.floor(s / 3600)}h ago`;
    };

    return (
      <Dialog open onOpenChange={open => !open && onClose()}>
        <DialogContent
          className="max-w-4xl"
          data-testid="dialog-watch-user"
          data-screenfeed-ignore="true"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isOnline ? (
                <span className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                  <span className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Live</span>
                </span>
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
              )}
              Watching: {username}
              {isOnline && presence && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  · {presence.companyName || "no company"} · {presence.role || "—"}
                  · last seen {timeAgo(presence.lastSeen)}
                </span>
              )}
            </DialogTitle>
            {!isOnline && (
              <DialogDescription>User is currently offline or inactive.</DialogDescription>
            )}
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
            {/* Live screenshot feed */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> Live screen
                {screenFrame?.capturedAt && (
                  <span className="ml-auto normal-case font-normal">
                    captured {timeAgo(screenFrame.capturedAt)}
                  </span>
                )}
              </p>
              <div className="rounded-md border overflow-hidden bg-muted/30 min-h-40 flex items-center justify-center">
                {hasScreen ? (
                  <div className="relative w-full">
                    <img
                      src={screenFrame.dataUrl}
                      alt="Live screen of user"
                      className="w-full block"
                      data-testid="img-screen-feed"
                    />
                    {/* Click dot overlays */}
                    {recentClicks.map((click, i) => {
                      const ageSec = (now - click.ts) / 1000;
                      const opacity = Math.max(0, 1 - ageSec / 4);
                      return (
                        <div
                          key={i}
                          title={click.label}
                          style={{
                            position:  "absolute",
                            left:      `${click.x * 100}%`,
                            top:       `${click.y * 100}%`,
                            transform: "translate(-50%, -50%)",
                            opacity,
                            pointerEvents: "none",
                          }}
                        >
                          <span className="relative flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-orange-500 border-2 border-white" />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                    <Clock className="h-8 w-8 opacity-30" />
                    <p className="text-sm">Waiting for first frame…</p>
                    <p className="text-xs">Updates every 3–5 seconds while watched</p>
                    {(Date.now() - watchStartRef.current) > 10000 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 text-center max-w-xs">
                        Still waiting — user may be on a background tab or screen capture is blocked by their browser.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Recent click log */}
              {clicks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Recent clicks
                  </p>
                  <div className="rounded-md border divide-y max-h-24 overflow-y-auto">
                    {[...clicks].reverse().slice(0, 8).map((click, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1 gap-2 text-xs">
                        <span className="truncate text-muted-foreground">{click.label || "—"}</span>
                        <span className="shrink-0 text-muted-foreground/60">
                          {new Date(click.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Navigation history sidebar */}
            <div className="space-y-2 min-w-0">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                <History className="h-3.5 w-3.5" /> Page history
              </p>
              {activity.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No history yet — pages appear here as the user navigates.
                </p>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-md border divide-y text-sm">
                  {activity.map((evt: any) => (
                    <div key={evt.id} className="px-3 py-2 space-y-0.5">
                      <p className="font-medium leading-tight truncate">{getPageLabel(evt.route)}</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground font-mono truncate">{evt.route}</p>
                        <p className="text-xs text-muted-foreground shrink-0">{fmtTime(evt.occurredAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Current page pill */}
              {isOnline && presence?.currentRoute && (
                <div className="rounded-md border p-2 space-y-0.5 bg-muted/30">
                  <p className="text-xs text-muted-foreground">Currently on</p>
                  <p className="text-sm font-semibold">{getPageLabel(presence.currentRoute)}</p>
                  <p className="text-xs text-muted-foreground font-mono">{presence.currentRoute}</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

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
                              onClick={() => setWatchingUser({ userId: presence.userId, username: presence.username })}
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
                              onClick={() => setWatchingUser({ userId: presence.userId, username: presence.username })}
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
