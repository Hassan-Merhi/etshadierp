import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FileText,
  Settings,
  Container,
  BarChart3,
  FolderPlus,
  MapPin,
  Wallet,
  Users,
  Receipt,
  Book,
  UserCheck,
  Search,
  PieChart,
  Ship,
  ArrowLeftRight,
  Factory,
  Barcode,
  ChevronRight,
  Eye,
  Boxes,
  Calculator,
  Store,
  TrendingUp,
  Upload,
  MessageCircle,
  TableProperties,
  ExternalLink,
  AlertTriangle,
  Tag,
  UserRound,
} from "lucide-react";
import { useConnectivity } from "@/contexts/ConnectivityContext";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { ROUTE_TO_FEATURE, type FeatureKey } from "@shared/schema";
import { useState, useEffect, useRef } from "react";
import { useCompany } from "@/contexts/CompanyContext";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface MenuItem {
  title: string;
  url: string;
  icon: any;
}

interface MenuGroup {
  title: string;
  icon: any;
  items: MenuItem[];
}

type NavEntry =
  | ({ kind: "group" } & MenuGroup)
  | ({ kind: "item" } & MenuItem);

const navEntries: NavEntry[] = [
  {
    kind: "group",
    title: "Overview",
    icon: Eye,
    items: [
      { title: "Tracking", url: "/", icon: Ship },
      { title: "Dashboard", url: "/financial-overview", icon: LayoutDashboard },
    ],
  },
  {
    kind: "group",
    title: "Inventory",
    icon: Boxes,
    items: [
      { title: "Location Inventory", url: "/location-inventory", icon: MapPin },
      { title: "Stock OTW", url: "/stock-otw", icon: Ship },
      { title: "Containers", url: "/containers", icon: Container },
      { title: "Stock Items", url: "/stock-items", icon: Package },
      { title: "Stock Query", url: "/stock-query", icon: Search },
      { title: "Optional Vouchers", url: "/optional-vouchers", icon: FileText },
    ],
  },
  {
    kind: "group",
    title: "Accounting",
    icon: Calculator,
    items: [
      { title: "Accounts", url: "/accounts", icon: Wallet },
      { title: "Agents", url: "/agents", icon: UserRound },
      { title: "Suppliers", url: "/suppliers", icon: Users },
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Payroll", url: "/payroll", icon: UserCheck },
    ],
  },
  { kind: "item", title: "Daybook", url: "/daybook", icon: Book },
  { kind: "item", title: "Vouchers", url: "/vouchers", icon: Receipt },
  {
    kind: "group",
    title: "Sales & POS",
    icon: Store,
    items: [
      { title: "POS", url: "/pos", icon: ShoppingCart },
      { title: "POS Daybook", url: "/pos-daybook", icon: Book },
      { title: "Price List", url: "/price-list", icon: Tag },
    ],
  },
  {
    kind: "group",
    title: "Analytics",
    icon: TrendingUp,
    items: [
      { title: "Sales Report", url: "/sales-report", icon: PieChart },
      { title: "Analytics", url: "/analytics", icon: BarChart3 },
      { title: "Net Profit Report", url: "/net-profit-report", icon: TrendingUp },
    ],
  },
  { kind: "item", title: "Create", url: "/create", icon: FolderPlus },
  { kind: "item", title: "Spreadsheet", url: "/spreadsheet", icon: TableProperties },
  { kind: "item", title: "Live Sheets", url: "/live-sheets", icon: ExternalLink },
  { kind: "item", title: "Chat", url: "/chat", icon: MessageCircle },
  { kind: "item", title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar({ user }: { user?: any }) {
  const [location] = useLocation();
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const { selectedCompany } = useCompany();
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

  // Auto-collapse: only keep the group containing current route open
  useEffect(() => {
    const activeGroup = navEntries.find(
      (entry): entry is ({ kind: "group" } & MenuGroup) =>
        entry.kind === "group" && entry.items.some(item => location === item.url)
    );
    if (activeGroup) {
      setOpenGroups([activeGroup.title]);
    }
  }, [location]);

  const { data: myErpPages } = useQuery<{ pageKeys: string[]; fullAccess: boolean }>({
    queryKey: ["/api/my-erp-pages"],
    enabled: !!user,
  });

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    queryFn: async () => {
      const res = await fetch(`/api/company-settings?companyId=${selectedCompany?.id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const allowedPages = new Set<string>(myErpPages?.pageKeys || []);

  const isItemVisible = (item: MenuItem) => {
    const isPOSUser = user?.role?.startsWith("POS");
    const isAdmin = user?.role === "Admin";
    const isDeveloper = user?.role === "Developer";
    const featureKey = ROUTE_TO_FEATURE[item.url];

    if (item.url === "/factory/raw-stock") {
      const isFactoryCompany = selectedCompany?.companyType === "factory";
      if (!isFactoryCompany) return false;
    }

    // Net Profit Report is dev-only until finalized
    if (item.url === "/net-profit-report") {
      return isDeveloper;
    }

    // Chat is always visible to all non-POS users
    if (item.url === "/chat") {
      return !isPOSUser;
    }

    // Price List is visible to all non-POS users
    if (item.url === "/price-list") {
      return !isPOSUser;
    }

    if (isDeveloper || isAdmin || myErpPages?.fullAccess) return true;

    if (isPOSUser) {
      const posRoutes = ["/pos", "/pos-dashboard", "/pos-daybook", "/location-inventory"];
      if (companySettings?.posExcelImportEnabled) {
        posRoutes.push("/pos-import");
      }
      return posRoutes.includes(item.url);
    }

    if (featureKey && allowedPages.size > 0) {
      return allowedPages.has(featureKey);
    }

    if (allowedPages.size === 0 && myErpPages) {
      return false;
    }

    if (item.url === "/settings") return false;
    if (item.url === "/pos-daybook") return isPOSUser;

    return true;
  };

  const toggleGroup = (groupTitle: string) => {
    setOpenGroups((prev) =>
      prev.includes(groupTitle)
        ? prev.filter((g) => g !== groupTitle)
        : [...prev, groupTitle]
    );
  };

  const isGroupActive = (group: MenuGroup) => {
    return group.items.some((item) => location === item.url);
  };

  const initials = user?.username
    ? user.username.substring(0, 2).toUpperCase()
    : "AD";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold">ERP POS</span>
            <span className="text-xs text-muted-foreground">
              Warehouse Management
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navEntries.map((entry) => {
                if (entry.kind === "group") {
                  const visibleItems = entry.items.filter(isItemVisible);
                  if (visibleItems.length === 0) return null;

                  const isOpen = openGroups.includes(entry.title);
                  const hasActiveItem = isGroupActive(entry);

                  return (
                    <Collapsible
                      key={entry.title}
                      open={isOpen || hasActiveItem}
                      onOpenChange={() => toggleGroup(entry.title)}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            className="w-full justify-between"
                            isActive={hasActiveItem && !isOpen}
                          >
                            <div className="flex items-center gap-2">
                              <entry.icon className="h-4 w-4" />
                              <span>{entry.title}</span>
                            </div>
                            <ChevronRight
                              className={`h-4 w-4 transition-transform duration-200 ${
                                isOpen || hasActiveItem ? "rotate-90" : ""
                              }`}
                            />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {visibleItems.map((item) => {
                              const isActive = location === item.url;
                              return (
                                <SidebarMenuSubItem key={item.title}>
                                  <SidebarMenuSubButton asChild isActive={isActive}>
                                    <a href={item.url} data-testid={`link-${item.url}`}>
                                      <item.icon className="h-4 w-4" />
                                      <span>{item.title}</span>
                                    </a>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }

                if (!isItemVisible(entry)) return null;
                const isActive = location === entry.url;
                const unreadCount = entry.title === "Chat" ? (chatUnread?.count || 0) : 0;
                return (
                  <SidebarMenuItem key={entry.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <a href={entry.url} data-testid={`link-${entry.url}`}>
                        <entry.icon className="h-4 w-4" />
                        <span className="flex-1">{entry.title}</span>
                        {unreadCount > 0 && (
                          <Badge variant="default" className="text-xs min-w-5 justify-center" data-testid="badge-chat-unread">
                            {unreadCount}
                          </Badge>
                        )}
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {conflictCount > 0 && (
                <SidebarMenuItem key="conflicts">
                  <SidebarMenuButton asChild isActive={location === "/conflicts"}>
                    <a href="/conflicts" data-testid="link-conflicts">
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                      <span className="flex-1">Conflicts</span>
                      <Badge
                        variant="outline"
                        className="text-xs min-w-5 justify-center border-orange-500/40 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400"
                        data-testid="badge-conflict-count"
                      >
                        {conflictCount}
                      </Badge>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium truncate">{user?.username || "User"}</span>
            <span className="text-xs text-muted-foreground truncate">
              {user?.role || "Role"}
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
