import {
  Package,
  Tags,
  Container,
  History,
  BarChart3,
  ScanLine,
  Users,
  Factory,
  LayoutDashboard,
  BookOpen,
  Landmark,
  FileText,
  Wallet,
  TrendingUp,
  MapPin,
  Ship,
  Database,
  Settings,
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
  Gauge,
  MessageCircle,
  AlertTriangle,
  Boxes,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { useRef, useEffect } from "react";

interface NavItem {
  title: string;
  url: string;
  icon: any;
  adminOnly?: boolean;
  featureFlag?: string;
  requiresExplicitAccess?: boolean;
}

interface NavSection {
  label: string;
  color: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Operations",
    color: "#f97316",
    items: [
      { title: "Stock Entry",    url: "/factory/stock-entry",    icon: ScanLine },
      { title: "Raw Materials",  url: "/factory/raw-materials",  icon: Package  },
      { title: "Waste Dispatch", url: "/factory/waste-dispatch", icon: Trash2   },
    ],
  },
  {
    label: "Bales",
    color: "#eab308",
    items: [
      { title: "Bales & Lookup",  url: "/factory/bales-hub",        icon: History   },
      { title: "Bale Products",   url: "/factory/bale-products",    icon: Tags      },
      { title: "Bale Ledger",     url: "/factory/bale-ledger",      icon: Layers    },
      { title: "Bale Relabeling", url: "/factory/bale-relabeling",  icon: RefreshCw },
    ],
  },
  {
    label: "Sales",
    color: "#22c55e",
    items: [
      { title: "Factory POS",       url: "/factory/pos",                       icon: ShoppingCart  },
      { title: "Customers",         url: "/factory/customers",                 icon: Users         },
      { title: "Price List",        url: "/factory/price-list",                icon: DollarSign    },
      { title: "Proformas",         url: "/factory/sales/proformas",           icon: FileText      },
      { title: "Loadings",          url: "/factory/sales/loadings",            icon: Container     },
      { title: "Pending Invoices",  url: "/factory/sales/pending-invoices",    icon: ClipboardCheck},
      { title: "Invoices",          url: "/factory/sales/invoices",            icon: ClipboardList },
    ],
  },
  {
    label: "Inventory",
    color: "#a855f7",
    items: [
      { title: "Location Inventory", url: "/factory/location-inventory", icon: MapPin    },
      { title: "Stock OTW",          url: "/factory/stock-otw",          icon: Ship      },
      { title: "Stock Query",        url: "/factory/stock-query",        icon: Database  },
      { title: "Containers",         url: "/factory/containers",         icon: Container },
    ],
  },
  {
    label: "Finance",
    color: "#10b981",
    items: [
      { title: "Workers",   url: "/factory/workers",   icon: HardHat   },
      { title: "Employees", url: "/factory/employees", icon: Users     },
      { title: "Suppliers", url: "/factory/suppliers", icon: UserRound },
    ],
  },
  {
    label: "Accounting",
    color: "#f59e0b",
    items: [
      { title: "Vouchers", url: "/factory/vouchers", icon: FileText  },
      { title: "Accounts", url: "/factory/accounts", icon: Landmark  },
      { title: "Agents",   url: "/factory/agents",   icon: UserRound },
    ],
  },
  {
    label: "Reports",
    color: "#06b6d4",
    items: [
      { title: "Analytics",           url: "/factory/analytics",             icon: TrendingUp    },
      { title: "Net Profit",          url: "/factory/net-profit-analytics",  icon: BarChart3     },
      { title: "Production Summary",  url: "/factory/production-summary",    icon: BarChart3     },
      { title: "Supplier Report",     url: "/factory/supplier-report",       icon: ClipboardCheck},
      { title: "Supplier Statement",  url: "/factory/supplier-statement",    icon: ClipboardCheck},
    ],
  },
  {
    label: "Intelligence",
    color: "#f43f5e",
    items: [
      { title: "Factory Dashboard", url: "/factory/intelligence/dashboard",       icon: Activity,  featureFlag: "dashboardEnabled"       },
      { title: "KPIs",              url: "/factory/intelligence/kpis",            icon: Gauge,     featureFlag: "kpisEnabled"            },
      { title: "Profitability",     url: "/factory/intelligence/profitability",   icon: DollarSign,featureFlag: "profitabilityEnabled"   },
      { title: "Waste Tracking",    url: "/factory/intelligence/waste",           icon: Trash2,    featureFlag: "wasteTrackingEnabled"   },
      { title: "Alerts",            url: "/factory/intelligence/alerts",          icon: Bell,      featureFlag: "alertsEnabled"          },
      { title: "Supplier Scores",   url: "/factory/intelligence/supplier-scores", icon: Award,    featureFlag: "supplierScoringEnabled" },
      { title: "Mix Optimizer",     url: "/factory/intelligence/mix-optimizer",   icon: Beaker,   featureFlag: "mixOptimizerEnabled"    },
      { title: "Cash Flow",         url: "/factory/intelligence/cashflow",        icon: DollarSign,featureFlag: "cashflowEnabled"        },
      { title: "Intel Settings",    url: "/factory/intelligence/settings",        icon: Settings,  adminOnly: true                      },
    ],
  },
];

// Central page registry for permission settings
export const FACTORY_NAV_PAGES: { key: string; label: string; group: string }[] = [
  ...navSections.flatMap(s =>
    s.items.map(item => ({
      key: item.url.replace(/^\//, ""),
      label: item.title,
      group: s.label,
    }))
  ),
  { key: "factory/dashboard", label: "Dashboard",  group: "Overview" },
  { key: "factory/daybook",   label: "Daybook",    group: "Other"    },
  { key: "factory/chat",      label: "Chat",       group: "Other"    },
  { key: "factory/settings",  label: "Settings",   group: "Other"    },
];

export function FactorySidebar({ user }: { user?: any }) {
  const [location] = useLocation();
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
    if (prevUnreadRef.current === -1) { prevUnreadRef.current = count; return; }
    if (count > prevUnreadRef.current) {
      toast({ title: "New message", description: `You have ${count} unread message${count > 1 ? "s" : ""}.` });
    }
    prevUnreadRef.current = count;
  }, [chatUnread?.count]);

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[] }>({
    queryKey: ["/api/factory/my-access"],
    staleTime: 30000,
  });

  const visibleSections = navSections.map(s => ({
    ...s,
    items: s.items.filter(item => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.featureFlag) {
        if (!settings) return false;
        if (settings[item.featureFlag] !== true) return false;
      }
      if (myAccess && !myAccess.fullAccess && myAccess.pageKeys.length > 0) {
        if (!myAccess.pageKeys.includes(item.url.replace(/^\//, ""))) return false;
      }
      if (item.requiresExplicitAccess && !isAdmin && myAccess) {
        if (myAccess.fullAccess) return false;
        if (!myAccess.pageKeys.includes(item.url.replace(/^\//, ""))) return false;
      }
      return true;
    }),
  })).filter(s => s.items.length > 0);

  const initials = user?.username ? user.username.substring(0, 2).toUpperCase() : "AD";

  const hasDashboard = !myAccess || myAccess.fullAccess
    ? isAdmin
    : myAccess.pageKeys.includes("factory/dashboard");

  // Single nav item renderer
  const NavLink = ({ item, color }: { item: NavItem; color: string }) => {
    const isActive = location === item.url;
    return (
      <a
        href={item.url}
        data-testid={`link-factory-${item.url.split("/").pop()}`}
        className={`
          group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors
          ${isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"}
        `}
        style={isActive ? { borderLeft: `2px solid ${color}`, paddingLeft: "8px" } : { borderLeft: "2px solid transparent", paddingLeft: "8px" }}
      >
        <item.icon
          className="h-3.5 w-3.5 shrink-0 transition-colors"
          style={isActive ? { color } : {}}
        />
        <span className="flex-1 leading-tight">{item.title}</span>
      </a>
    );
  };

  // Top-level flat link (Dashboard, Daybook, Chat, Settings)
  const FlatLink = ({
    href, icon: Icon, label, color = "currentColor", badge, testId,
  }: {
    href: string; icon: any; label: string; color?: string; badge?: number; testId: string;
  }) => {
    const isActive = location === href;
    return (
      <a
        href={href}
        data-testid={testId}
        className={`
          flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors
          ${isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"}
        `}
        style={isActive ? { borderLeft: `2px solid ${color}`, paddingLeft: "8px" } : { borderLeft: "2px solid transparent", paddingLeft: "8px" }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" style={isActive ? { color } : {}} />
        <span className="flex-1 leading-tight">{label}</span>
        {badge != null && badge > 0 && (
          <Badge variant="default" className="text-xs min-w-5 justify-center" data-testid={`badge-${testId}`}>
            {badge}
          </Badge>
        )}
      </a>
    );
  };

  return (
    <Sidebar>
      {/* ── Header ───────────────────────────────── */}
      <SidebarHeader className="px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-600 text-white">
            <Factory className="h-5 w-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold leading-tight">Factory</span>
            <span className="text-xs text-muted-foreground leading-tight">Production System</span>
          </div>
        </div>
      </SidebarHeader>

      {/* ── Scrollable nav ───────────────────────── */}
      <SidebarContent className="px-3 py-2 overflow-y-auto">

        {/* Top-level pinned items */}
        <div className="mb-1 space-y-0.5">
          {hasDashboard && (
            <FlatLink href="/factory/dashboard" icon={LayoutDashboard} label="Dashboard" color="#3b82f6" testId="link-factory-dashboard" />
          )}
          <FlatLink href="/factory/daybook" icon={BookOpen} label="Daybook" color="#3b82f6" testId="link-factory-daybook" />
        </div>

        {/* Sectioned nav */}
        {visibleSections.map((section, idx) => (
          <div key={section.label} className={idx === 0 ? "mt-3" : "mt-4"}>
            {/* Section label */}
            <p
              className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: section.color, opacity: 0.7 }}
            >
              {section.label}
            </p>
            {/* Section items */}
            <div className="space-y-0.5">
              {section.items.map(item => (
                <NavLink key={item.url} item={item} color={section.color} />
              ))}
            </div>
          </div>
        ))}

        {/* ── Utility links ───────────────────────── */}
        <div className="mt-4 pt-3 border-t border-sidebar-border/60 space-y-0.5">
          <FlatLink
            href="/factory/chat"
            icon={MessageCircle}
            label="Chat"
            color="#3b82f6"
            badge={chatUnread?.count}
            testId="link-factory-chat"
          />
          {conflictCount > 0 && (
            <a
              href="/factory/conflicts"
              data-testid="link-factory-conflicts"
              className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
              style={{ borderLeft: "2px solid transparent", paddingLeft: "8px" }}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-500" />
              <span className="flex-1 leading-tight">Conflicts</span>
              <Badge
                variant="outline"
                className="text-xs min-w-5 justify-center border-orange-500/40 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400"
                data-testid="badge-factory-conflict-count"
              >
                {conflictCount}
              </Badge>
            </a>
          )}
          {isAdmin && (
            <FlatLink href="/factory/settings" icon={Settings} label="Settings" color="#6b7280" testId="link-factory-settings" />
          )}
        </div>

      </SidebarContent>

      {/* ── Footer ───────────────────────────────── */}
      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs font-semibold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium leading-tight truncate">{user?.username || "User"}</span>
            <span className="text-xs text-muted-foreground leading-tight">{user?.role || "Admin"}</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
