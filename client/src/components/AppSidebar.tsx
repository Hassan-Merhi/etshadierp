import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  DollarSign,
  FileText,
  Settings,
  Container,
  BarChart3,
  FolderPlus,
  Upload,
  MapPin,
  Wallet,
  Users,
  Receipt,
  Book,
  Scale,
  TrendingUp,
  UserCheck,
  FileSpreadsheet,
  Search,
  PieChart,
  Tags,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useLocation } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Point of Sale",
    url: "/pos",
    icon: ShoppingCart,
  },
  {
    title: "Inventory",
    url: "/inventory",
    icon: Package,
  },
  {
    title: "Stock Items",
    url: "/stock-items",
    icon: Tags,
  },
  {
    title: "Location Inventory",
    url: "/location-inventory",
    icon: MapPin,
  },
  {
    title: "Containers",
    url: "/containers",
    icon: Container,
  },
  {
    title: "PO Import",
    url: "/po-import",
    icon: Upload,
  },
  {
    title: "Financial",
    url: "/financial",
    icon: DollarSign,
  },
  {
    title: "Accounts",
    url: "/accounts",
    icon: Wallet,
  },
  {
    title: "Suppliers",
    url: "/suppliers",
    icon: Users,
  },
  {
    title: "Vouchers",
    url: "/vouchers",
    icon: Receipt,
  },
  {
    title: "Daybook",
    url: "/daybook",
    icon: Book,
  },
  {
    title: "Reports",
    url: "/reports",
    icon: FileText,
  },
  {
    title: "Balance Sheet",
    url: "/balance-sheet",
    icon: Scale,
  },
  {
    title: "Profit & Loss",
    url: "/profit-loss",
    icon: TrendingUp,
  },
  {
    title: "Payroll",
    url: "/payroll",
    icon: UserCheck,
  },
  {
    title: "Create Master Data",
    url: "/create",
    icon: FolderPlus,
  },
  {
    title: "Import Stock Items",
    url: "/import-stock-items",
    icon: FileSpreadsheet,
  },
  {
    title: "Stock Query",
    url: "/stock-query",
    icon: Search,
  },
  {
    title: "Sales Report",
    url: "/sales-report",
    icon: PieChart,
  },
  {
    title: "Analytics",
    url: "/analytics",
    icon: BarChart3,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar({ user }: { user?: any }) {
  const [location] = useLocation();

  // Filter menu items based on user role
  const visibleMenuItems = menuItems.filter((item) => {
    // Settings is Admin only
    if (item.url === "/settings") {
      return user?.role === "Admin";
    }
    return true;
  });

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
          <SidebarGroupLabel>Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <a href={item.url} data-testid={`link-${item.url}`}>
                        <item.icon className="h-5 w-5" />
                        <span>{item.title}</span>
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
