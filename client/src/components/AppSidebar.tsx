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
  TrendingUp,
  UserCheck,
  FileSpreadsheet,
  Search,
  PieChart,
  Ship,
  HandCoins,
  ArrowLeftRight,
  Package2,
  Layers,
  Barcode,
  Tags,
  AlertCircle,
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
    title: "POS Daybook",
    url: "/pos-daybook",
    icon: Book,
  },
  {
    title: "Stock Items",
    url: "/stock-items",
    icon: Package,
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
    title: "Sold Containers",
    url: "/sold-containers",
    icon: HandCoins,
  },
  {
    title: "Stock OTW",
    url: "/stock-otw",
    icon: Ship,
  },
  {
    title: "Factory Bales",
    url: "/bales",
    icon: Package2,
  },
  {
    title: "Mix Batches",
    url: "/mix-batches",
    icon: Layers,
  },
  {
    title: "Production Bales",
    url: "/production-bales",
    icon: Barcode,
  },
  {
    title: "Bale Products",
    url: "/bale-products",
    icon: Tags,
  },
  {
    title: "Analytics",
    url: "/analytics",
    icon: BarChart3,
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
    title: "Customers",
    url: "/customers",
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
    title: "Payroll",
    url: "/payroll",
    icon: UserCheck,
  },
  {
    title: "Create",
    url: "/create",
    icon: FolderPlus,
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
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
  {
    title: "Orphaned Records",
    url: "/orphaned-records",
    icon: AlertCircle,
  },
];

export function AppSidebar({ user }: { user?: any }) {
  const [location] = useLocation();

  // Filter menu items based on user role
  const visibleMenuItems = menuItems.filter((item) => {
    const isPOSUser = user?.role?.startsWith("POS");
    
    // POS users only see: POS, POS Daybook, and Location Inventory
    if (isPOSUser) {
      return ["/pos", "/pos-daybook", "/location-inventory"].includes(item.url);
    }
    
    // For non-POS users:
    // Settings and Orphaned Records are Admin only
    if (item.url === "/settings" || item.url === "/orphaned-records") {
      return user?.role === "Admin";
    }
    
    // POS Daybook is only for POS users (hide from others)
    if (item.url === "/pos-daybook") {
      return isPOSUser; // This is redundant now but kept for clarity
    }
    
    // All other items are visible to non-POS users
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
