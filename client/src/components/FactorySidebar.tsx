import {
  Package,
  Boxes,
  Tags,
  Search,
  Container,
  History,
  BarChart3,
  ArrowRightLeft,
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
import { useState, useEffect } from "react";

interface MenuItem {
  title: string;
  url: string;
  icon: any;
  adminOnly?: boolean;
}

interface MenuGroup {
  title: string;
  icon: any;
  items: MenuItem[];
}

const allMenuGroups: MenuGroup[] = [
  {
    title: "Overview",
    icon: LayoutDashboard,
    items: [
      { title: "Dashboard", url: "/factory/dashboard", icon: LayoutDashboard },
      { title: "Daybook", url: "/factory/daybook", icon: BookOpen },
    ],
  },
  {
    title: "Master Data",
    icon: Tags,
    items: [
      { title: "Suppliers", url: "/factory/suppliers", icon: Users },
      { title: "Containers", url: "/factory/containers", icon: Container },
      { title: "Bale Products", url: "/factory/bale-products", icon: Tags },
    ],
  },
  {
    title: "Raw Materials",
    icon: Package,
    items: [
      { title: "Raw Stock", url: "/factory/raw-stock", icon: Package },
      { title: "Mix Batches", url: "/factory/mix-batches", icon: Boxes },
    ],
  },
  {
    title: "Production",
    icon: ScanLine,
    items: [
      { title: "Pressing", url: "/factory/pressing", icon: ScanLine },
      { title: "Finalize / Counting", url: "/factory/finalize", icon: CheckCircle },
      { title: "Bales History", url: "/factory/bales-history", icon: History },
    ],
  },
  {
    title: "Logistics",
    icon: ArrowRightLeft,
    items: [
      { title: "Bale Transfers", url: "/factory/bale-transfers", icon: ArrowRightLeft },
    ],
  },
  {
    title: "Inventory",
    icon: MapPin,
    items: [
      { title: "Location Inventory", url: "/factory/location-inventory", icon: MapPin },
      { title: "Stock OTW", url: "/factory/stock-otw", icon: Ship },
      { title: "Stock Query", url: "/factory/stock-query", icon: Database },
    ],
  },
  {
    title: "Accounting",
    icon: Landmark,
    items: [
      { title: "Accounts", url: "/factory/accounts", icon: Landmark },
      { title: "Vouchers", url: "/factory/vouchers", icon: FileText },
      { title: "Create", url: "/factory/create", icon: PlusCircle },
    ],
  },
  {
    title: "Finance",
    icon: Wallet,
    items: [
      { title: "Payroll", url: "/factory/payroll", icon: Wallet },
      { title: "Analytics", url: "/factory/analytics", icon: TrendingUp },
      { title: "Production Summary", url: "/factory/production-summary", icon: BarChart3 },
    ],
  },
  {
    title: "Traceability",
    icon: Search,
    items: [
      { title: "Barcode Lookup", url: "/factory/barcode-lookup", icon: Search },
    ],
  },
  {
    title: "Data",
    icon: Upload,
    items: [
      { title: "Import Data", url: "/factory/import", icon: Upload },
      { title: "Settings", url: "/factory/settings", icon: Settings, adminOnly: true },
    ],
  },
];

export function FactorySidebar({ user }: { user?: any }) {
  const [location] = useLocation();
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const isAdmin = user?.role === "Admin";

  const menuGroups = allMenuGroups.map(group => ({
    ...group,
    items: group.items.filter(item => !item.adminOnly || isAdmin),
  })).filter(group => group.items.length > 0);

  useEffect(() => {
    const activeGroup = menuGroups.find(group =>
      group.items.some(item => location === item.url)
    );
    if (activeGroup) {
      setOpenGroups([activeGroup.title]);
    }
  }, [location]);

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
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-600 text-white">
            <Factory className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold">Factory</span>
            <span className="text-xs text-muted-foreground">
              Production System
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuGroups.map((group) => {
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
                          {group.items.map((item) => {
                            const isActive = location === item.url;
                            return (
                              <SidebarMenuSubItem key={item.title}>
                                <SidebarMenuSubButton asChild isActive={isActive}>
                                  <a href={item.url} data-testid={`link-factory-${item.url.split('/').pop()}`}>
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
