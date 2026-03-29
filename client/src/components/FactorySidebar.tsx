import {
  Package,
  Boxes,
  Tags,
  Search,
  Container,
  History,
  BarChart3,
  ScanLine,
  CheckCircle,
  Users,
  Factory,
  ChevronRight,
  LayoutDashboard,
  BookOpen,
  Landmark,
  FileText,
  PlusCircle,
  Wallet,
  TrendingUp,
  MapPin,
  Ship,
  Database,
  Settings,
  Upload,
  ShoppingCart,
  ClipboardList,
  HardHat,
  UserRound,
  ClipboardCheck,
  Activity,
  RefreshCw,
  Bell,
  Award,
  Beaker,
  Trash2,
  Layers,
  DollarSign,
  Camera,
  Link,
  Gauge,
  MessageCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { useState, useEffect, useRef, Fragment } from "react";

interface MenuItem {
  title: string;
  url: string;
  icon: any;
  adminOnly?: boolean;
  featureFlag?: string;
  requiresExplicitAccess?: boolean;
}

interface MenuGroup {
  title: string;
  icon: any;
  color: string;
  items: MenuItem[];
}

const allMenuGroups: MenuGroup[] = [
  {
    title: "Overview",
    icon: LayoutDashboard,
    color: "text-blue-500",
    items: [
      { title: "Dashboard", url: "/factory/dashboard", icon: LayoutDashboard, requiresExplicitAccess: true },
    ],
  },
  {
    title: "Operations",
    icon: Factory,
    color: "text-orange-500",
    items: [
      { title: "Stock Entry", url: "/factory/stock-entry", icon: ScanLine },
      { title: "Bales & Lookup", url: "/factory/bales-hub", icon: History },
      { title: "Raw Materials", url: "/factory/raw-materials", icon: Package },
      { title: "Bale Products", url: "/factory/bale-products", icon: Tags },
      { title: "Waste Dispatch", url: "/factory/waste-dispatch", icon: Trash2 },
    ],
  },
  {
    title: "Sales",
    icon: ShoppingCart,
    color: "text-green-500",
    items: [
      { title: "Factory POS", url: "/factory/pos", icon: ShoppingCart },
      { title: "Customers", url: "/factory/customers", icon: Users },
      { title: "Loadings", url: "/factory/sales/loadings", icon: Container },
      { title: "Price List", url: "/factory/price-list", icon: DollarSign },
      { title: "Proformas", url: "/factory/sales/proformas", icon: FileText },
      { title: "Pending Invoices", url: "/factory/sales/pending-invoices", icon: ClipboardCheck },
      { title: "Invoices", url: "/factory/sales/invoices", icon: ClipboardList },
    ],
  },
  {
    title: "Inventory",
    icon: MapPin,
    color: "text-purple-500",
    items: [
      { title: "Location Inventory", url: "/factory/location-inventory", icon: MapPin },
      { title: "Bale Ledger", url: "/factory/bale-ledger", icon: Layers },
      { title: "Stock OTW", url: "/factory/stock-otw", icon: Ship },
      { title: "Stock Query", url: "/factory/stock-query", icon: Database },
      { title: "Bale Relabeling", url: "/factory/bale-relabeling", icon: RefreshCw },
    ],
  },
  {
    title: "Finance",
    icon: Wallet,
    color: "text-emerald-500",
    items: [
      { title: "Workers", url: "/factory/workers", icon: HardHat },
      { title: "Employees", url: "/factory/employees", icon: Users },
      { title: "Suppliers", url: "/factory/suppliers", icon: UserRound },
      { title: "Containers", url: "/factory/containers", icon: Container },
    ],
  },
  {
    title: "Accounting",
    icon: Landmark,
    color: "text-amber-500",
    items: [
      { title: "Vouchers", url: "/factory/vouchers", icon: FileText },
      { title: "Accounts", url: "/factory/accounts", icon: Landmark },
      { title: "Agents", url: "/factory/agents", icon: UserRound },
    ],
  },
  {
    title: "Reports",
    icon: ClipboardCheck,
    color: "text-cyan-500",
    items: [
      { title: "Analytics", url: "/factory/analytics", icon: TrendingUp },
      { title: "Net Profit Analytics", url: "/factory/net-profit-analytics", icon: BarChart3 },
      { title: "Production Summary", url: "/factory/production-summary", icon: BarChart3 },
      { title: "Supplier Report", url: "/factory/supplier-report", icon: ClipboardCheck },
      { title: "Supplier Statement", url: "/factory/supplier-statement", icon: ClipboardCheck },
    ],
  },
  {
    title: "Intelligence",
    icon: Gauge,
    color: "text-rose-500",
    items: [
      { title: "Factory Dashboard", url: "/factory/intelligence/dashboard", icon: Activity, featureFlag: "dashboardEnabled" },
      { title: "KPIs", url: "/factory/intelligence/kpis", icon: Gauge, featureFlag: "kpisEnabled" },
      { title: "Profitability", url: "/factory/intelligence/profitability", icon: DollarSign, featureFlag: "profitabilityEnabled" },
      { title: "Waste Tracking", url: "/factory/intelligence/waste", icon: Trash2, featureFlag: "wasteTrackingEnabled" },
      { title: "Alerts", url: "/factory/intelligence/alerts", icon: Bell, featureFlag: "alertsEnabled" },
      { title: "Supplier Scores", url: "/factory/intelligence/supplier-scores", icon: Award, featureFlag: "supplierScoringEnabled" },
      { title: "Mix Optimizer", url: "/factory/intelligence/mix-optimizer", icon: Beaker, featureFlag: "mixOptimizerEnabled" },
      { title: "Cash Flow", url: "/factory/intelligence/cashflow", icon: DollarSign, featureFlag: "cashflowEnabled" },
      { title: "Intelligence Settings", url: "/factory/intelligence/settings", icon: Settings, adminOnly: true },
    ],
  },
];

export const FACTORY_NAV_PAGES: { key: string; label: string; group: string }[] = [
  ...allMenuGroups.flatMap(group =>
    group.items.map(item => ({
      key: item.url.replace(/^\//, ""),
      label: item.title,
      group: group.title,
    }))
  ),
  { key: "factory/daybook", label: "Daybook", group: "Other" },
  { key: "factory/chat",    label: "Chat",    group: "Other" },
  { key: "factory/settings", label: "Settings", group: "Other" },
];

export function FactorySidebar({ user }: { user?: any }) {
  const [location] = useLocation();
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const isAdmin = user?.role === "Admin";
  const { toast } = useToast();
  const { conflictCount } = useConnectivity();
  const prevUnreadRef = useRef<number>(-1);

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread-count"],
    refetchInterval: 60000,
    enabled: !!user,
  });

  useEffect(() => {
    const count = chatUnread?.count || 0;
    if (prevUnreadRef.current === -1) {
      prevUnreadRef.current = count;
      return;
    }
    if (count > prevUnreadRef.current) {
      toast({ title: "New message", description: `You have ${count} unread message${count > 1 ? "s" : ""}.` });
    }
    prevUnreadRef.current = count;
  }, [chatUnread?.count]);

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => {
      const res = await fetch("/api/factory/settings");
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[] }>({
    queryKey: ["/api/factory/my-access"],
    staleTime: 30000,
  });

  const menuGroups = allMenuGroups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.featureFlag && settings) {
        if (settings[item.featureFlag] !== true) return false;
      }
      if (item.featureFlag && !settings) return false;
      if (myAccess && !myAccess.fullAccess && myAccess.pageKeys.length > 0) {
        const pageKey = item.url.replace(/^\//, "");
        if (!myAccess.pageKeys.includes(pageKey)) return false;
      }
      if (item.requiresExplicitAccess && !isAdmin && myAccess) {
        if (myAccess.fullAccess) return false;
        const pageKey = item.url.replace(/^\//, "");
        if (!myAccess.pageKeys.includes(pageKey)) return false;
      }
      return true;
    }),
  })).filter(group => group.items.length > 0);

  useEffect(() => {
    const activeGroup = menuGroups.find(group =>
      group.items.some(item => location === item.url)
    );
    if (activeGroup) {
      setOpenGroups(prev =>
        prev.includes(activeGroup.title) ? prev : [...prev, activeGroup.title]
      );
    }
  }, [location]);

  const toggleGroup = (groupTitle: string) => {
    setOpenGroups((prev) =>
      prev.includes(groupTitle)
        ? prev.filter((g) => g !== groupTitle)
        : [...prev, groupTitle]
    );
  };

  const isGroupActive = (group: MenuGroup) =>
    group.items.some((item) => location === item.url);

  const initials = user?.username
    ? user.username.substring(0, 2).toUpperCase()
    : "AD";

  return (
    <Sidebar>
      {/* Header */}
      <SidebarHeader className="px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-600 text-white shadow-sm">
            <Factory className="h-5 w-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold leading-tight">Factory</span>
            <span className="text-xs text-muted-foreground leading-tight">Production System</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">

              {menuGroups.map((group, groupIdx) => {
                const isOpen = openGroups.includes(group.title);
                const hasActiveItem = isGroupActive(group);
                const isExpanded = isOpen || hasActiveItem;

                return (
                  <Fragment key={group.title}>
                    {/* Subtle separator between major sections */}
                    {groupIdx > 0 && ["Operations", "Finance", "Reports"].includes(group.title) && (
                      <div className="my-1 mx-2 border-t border-sidebar-border/60" />
                    )}

                    <Collapsible
                      open={isExpanded}
                      onOpenChange={() => toggleGroup(group.title)}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            className={`w-full justify-between rounded-md transition-colors ${
                              hasActiveItem
                                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                : ""
                            }`}
                            data-testid={`button-group-${group.title.toLowerCase()}`}
                          >
                            <div className="flex items-center gap-2.5">
                              <group.icon className={`h-4 w-4 shrink-0 ${hasActiveItem ? group.color : "text-muted-foreground"}`} />
                              <span className="text-sm">{group.title}</span>
                            </div>
                            <ChevronRight
                              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                                isExpanded ? "rotate-90" : ""
                              }`}
                            />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <SidebarMenuSub className="ml-3 border-l border-sidebar-border/70 pl-2 my-0.5">
                            {group.items.map((item) => {
                              const isActive = location === item.url;
                              return (
                                <SidebarMenuSubItem key={item.title}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={isActive}
                                    className={`rounded-md text-sm transition-colors ${
                                      isActive
                                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    <a href={item.url} data-testid={`link-factory-${item.url.split('/').pop()}`}>
                                      <item.icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? group.color : ""}`} />
                                      <span className="flex-1">{item.title}</span>
                                    </a>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>

                    {/* Daybook sits right after Overview as a flat item */}
                    {group.title === "Overview" && (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          asChild
                          isActive={location === "/factory/daybook"}
                          className={`rounded-md transition-colors ${
                            location === "/factory/daybook"
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : ""
                          }`}
                        >
                          <a href="/factory/daybook" data-testid="link-factory-daybook" className="flex items-center gap-2.5">
                            <BookOpen className={`h-4 w-4 shrink-0 ${location === "/factory/daybook" ? "text-blue-500" : "text-muted-foreground"}`} />
                            <span className="text-sm">Daybook</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                  </Fragment>
                );
              })}

              {/* Divider before utility items */}
              <div className="my-1 mx-2 border-t border-sidebar-border/60" />

              {/* Chat */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/factory/chat"}
                  className={`rounded-md transition-colors ${
                    location === "/factory/chat"
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : ""
                  }`}
                >
                  <a href="/factory/chat" data-testid="link-factory-chat" className="flex items-center gap-2.5">
                    <MessageCircle className={`h-4 w-4 shrink-0 ${location === "/factory/chat" ? "text-blue-500" : "text-muted-foreground"}`} />
                    <span className="flex-1 text-sm">Chat</span>
                    {(chatUnread?.count || 0) > 0 && (
                      <Badge variant="default" className="text-xs min-w-5 justify-center" data-testid="badge-factory-chat-unread">
                        {chatUnread?.count}
                      </Badge>
                    )}
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Conflict Center */}
              {conflictCount > 0 && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/factory/conflicts"} className="rounded-md">
                    <a href="/factory/conflicts" data-testid="link-factory-conflicts" className="flex items-center gap-2.5">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-orange-500" />
                      <span className="flex-1 text-sm">Conflicts</span>
                      <Badge
                        variant="outline"
                        className="text-xs min-w-5 justify-center border-orange-500/40 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400"
                        data-testid="badge-factory-conflict-count"
                      >
                        {conflictCount}
                      </Badge>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Settings (admin only) */}
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/factory/settings"}
                    className={`rounded-md transition-colors ${
                      location === "/factory/settings"
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : ""
                    }`}
                  >
                    <a href="/factory/settings" data-testid="link-factory-settings" className="flex items-center gap-2.5">
                      <Settings className={`h-4 w-4 shrink-0 ${location === "/factory/settings" ? "text-blue-500" : "text-muted-foreground"}`} />
                      <span className="text-sm">Settings</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs font-medium bg-orange-600/10 text-orange-700 dark:text-orange-400">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium leading-tight truncate">{user?.username || "User"}</span>
            <span className="text-xs text-muted-foreground leading-tight truncate">{user?.role || "Admin"}</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
