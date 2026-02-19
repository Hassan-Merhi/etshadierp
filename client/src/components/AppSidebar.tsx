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
  Grid3X3,
  ChevronRight,
  Eye,
  Boxes,
  Calculator,
  Store,
  TrendingUp,
  Upload,
  MessageCircle,
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

const menuGroups: MenuGroup[] = [
  {
    title: "Overview",
    icon: Eye,
    items: [
      { title: "Tracking", url: "/", icon: Ship },
      { title: "Dashboard", url: "/financial-overview", icon: LayoutDashboard },
    ],
  },
  {
    title: "Inventory",
    icon: Boxes,
    items: [
      { title: "Daybook", url: "/daybook", icon: Book },
      { title: "Location Inventory", url: "/location-inventory", icon: MapPin },
      { title: "Stock OTW", url: "/stock-otw", icon: Ship },
      { title: "Containers", url: "/containers", icon: Container },
      { title: "Stock Items", url: "/stock-items", icon: Package },
      { title: "Stock Query", url: "/stock-query", icon: Search },
      { title: "Location Summary", url: "/location-summary", icon: Grid3X3 },
    ],
  },
  {
    title: "Accounting",
    icon: Calculator,
    items: [
      { title: "Accounts", url: "/accounts", icon: Wallet },
      { title: "Suppliers", url: "/suppliers", icon: Users },
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Daybook", url: "/daybook", icon: Book },
      { title: "Payroll", url: "/payroll", icon: UserCheck },
    ],
  },
  {
    title: "Sales & POS",
    icon: Store,
    items: [
      { title: "Dashboard", url: "/pos-dashboard", icon: LayoutDashboard },
      { title: "POS", url: "/pos", icon: ShoppingCart },
      { title: "POS Daybook", url: "/pos-daybook", icon: Book },
      { title: "POS Import", url: "/pos-import", icon: Upload },
    ],
  },
  {
    title: "Analytics",
    icon: TrendingUp,
    items: [
      { title: "Sales Report", url: "/sales-report", icon: PieChart },
      { title: "Analytics", url: "/analytics", icon: BarChart3 },
      { title: "Factory Production", url: "/factory/raw-stock", icon: Factory },
      { title: "Barcode Manager", url: "/barcode-manager", icon: Barcode },
    ],
  },
  {
    title: "Vouchers",
    icon: Receipt,
    items: [
      { title: "Vouchers", url: "/vouchers", icon: Receipt },
      { title: "Optional Vouchers", url: "/optional-vouchers", icon: FileText },
      { title: "Transfer Order", url: "/stock-transfer-order", icon: ArrowLeftRight },
    ],
  },
];

const standaloneItems: MenuItem[] = [
  { title: "Create", url: "/create", icon: FolderPlus },
  { title: "Chat", url: "/chat", icon: MessageCircle },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar({ user }: { user?: any }) {
  const [location] = useLocation();
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const prevUnreadRef = useRef<number>(-1);

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread-count"],
    refetchInterval: 10000,
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
    const activeGroup = menuGroups.find(group => 
      group.items.some(item => location === item.url)
    );
    if (activeGroup) {
      setOpenGroups([activeGroup.title]);
    }
  }, [location]);

  const { data: myPermissions = [] } = useQuery<any[]>({
    queryKey: ["/api/my-permissions"],
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

  const allowedFeatures = new Set<string>();
  myPermissions.forEach((p: any) => {
    if (p.enabled) {
      allowedFeatures.add(p.featureKey);
    }
  });

  const isItemVisible = (item: MenuItem) => {
    const isPOSUser = user?.role?.startsWith("POS");
    const isAdmin = user?.role === "Admin";
    const featureKey = ROUTE_TO_FEATURE[item.url];

    if (item.url === "/factory/raw-stock") {
      const isFactoryCompany = selectedCompany?.companyType === "factory";
      if (!isFactoryCompany) return false;
    }

    if (isAdmin) return true;

    if (myPermissions.length > 0 && featureKey) {
      const permissionEntry = myPermissions.find((p: any) => p.featureKey === featureKey);
      return permissionEntry ? permissionEntry.enabled : false;
    }

    if (isPOSUser) {
      const posRoutes = ["/pos", "/pos-dashboard", "/pos-daybook", "/location-inventory"];
      if (companySettings?.posExcelImportEnabled) {
        posRoutes.push("/pos-import");
      }
      return posRoutes.includes(item.url);
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
              {menuGroups.map((group) => {
                const visibleItems = group.items.filter(isItemVisible);
                if (visibleItems.length === 0) return null;

                const isOpen = openGroups.includes(group.title);
                const hasActiveItem = isGroupActive(group);

                return (
                  <Collapsible
                    key={group.title}
                    open={isOpen || hasActiveItem}
                    onOpenChange={() => toggleGroup(group.title)}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          className="w-full justify-between"
                          isActive={hasActiveItem && !isOpen}
                        >
                          <div className="flex items-center gap-2">
                            <group.icon className="h-4 w-4" />
                            <span>{group.title}</span>
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
              })}

              {standaloneItems.map((item) => {
                if (!isItemVisible(item)) return null;
                const isActive = location === item.url;
                const unreadCount = item.title === "Chat" ? (chatUnread?.count || 0) : 0;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <a href={item.url} data-testid={`link-${item.url}`}>
                        <item.icon className="h-4 w-4" />
                        <span className="flex-1">{item.title}</span>
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
