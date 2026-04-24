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
  ChevronDown,
  LayoutGrid,
  Scale,
  Building2,
  Store,
} from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { useState, useRef, useEffect } from "react";

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
  developerOnly?: boolean;
}

const navSections: NavSection[] = [
  {
    label: "Overview",
    color: "#3b82f6",
    items: [
      { title: "Production Report", url: "/factory/production-report", icon: BarChart3 },
    ],
  },
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
      { title: "Bales & Lookup",  url: "/factory/bales-hub",          icon: History   },
      { title: "Bale Products",   url: "/factory/bale-products",      icon: Tags      },
      { title: "Bale Ledger",     url: "/factory/bale-ledger",        icon: Layers    },
    ],
  },
  {
    label: "Sales",
    color: "#22c55e",
    items: [
      { title: "Factory POS",      url: "/factory/pos",                    icon: ShoppingCart   },
      { title: "Customers",        url: "/factory/customers",              icon: Users          },
      { title: "Price List",       url: "/factory/price-list",             icon: DollarSign     },
      { title: "Invoicing",        url: "/factory/invoicing",              icon: FileText       },
      { title: "Stock Allocation", url: "/factory/stock-allocation",       icon: LayoutGrid     },
      { title: "Loadings",         url: "/factory/sales/loadings",         icon: Container      },
    ],
  },
  {
    label: "Inventory",
    color: "#a855f7",
    items: [
      { title: "Location Inventory", url: "/factory/location-inventory", icon: MapPin    },
      { title: "Factory Stock OTW",   url: "/factory/stock-otw",          icon: Ship      },
      { title: "Stock Query",        url: "/factory/stock-query",        icon: Database  },
      { title: "Containers",         url: "/factory/containers",         icon: Container },
    ],
  },
  {
    label: "Finance",
    color: "#10b981",
    items: [
      { title: "Workers",          url: "/factory/workers",                   icon: HardHat        },
      { title: "Employees",        url: "/factory/employees",                 icon: Users          },
      { title: "Suppliers",        url: "/factory/suppliers",                 icon: UserRound      },
      { title: "Broker Statement", url: "/factory/broker-visual-statement",   icon: Scale          },
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
      { title: "Analytics",           url: "/factory/analytics",          icon: TrendingUp },
      { title: "Financial Snapshot",  url: "/factory/financial-snapshot", icon: LayoutGrid  },
    ],
  },
  {
    label: "Rentals",
    color: "#8b5cf6",
    items: [
      { title: "Warehouses",   url: "/factory/rental/warehouses", icon: Building2     },
      { title: "Shops",        url: "/factory/rental/shops",      icon: Store         },
      { title: "Payments Log", url: "/factory/rental/payments",   icon: ClipboardList },
    ],
  },
  {
    label: "Intelligence",
    color: "#f43f5e",
    developerOnly: true,
    items: [
      { title: "Factory Dashboard", url: "/factory/intelligence/dashboard",       icon: Activity,   featureFlag: "dashboardEnabled"           },
      { title: "KPIs",              url: "/factory/intelligence/kpis",            icon: Gauge,      featureFlag: "kpisEnabled"                },
      { title: "Profitability",     url: "/factory/intelligence/profitability",   icon: DollarSign, featureFlag: "profitabilityEnabled"       },
      { title: "Waste Tracking",    url: "/factory/intelligence/waste",           icon: Trash2,     featureFlag: "wasteTrackingEnabled"       },
      { title: "Alerts",            url: "/factory/intelligence/alerts",          icon: Bell,       featureFlag: "alertsEnabled"              },
      { title: "Supplier Scores",   url: "/factory/intelligence/supplier-scores", icon: Award,      featureFlag: "supplierScoringEnabled"     },
      { title: "Mix Optimizer",     url: "/factory/intelligence/mix-optimizer",   icon: Beaker,     featureFlag: "mixOptimizerEnabled"        },
      { title: "Cash Flow",         url: "/factory/intelligence/cashflow",        icon: DollarSign, featureFlag: "cashflowEnabled"            },
      { title: "Net Profit",        url: "/factory/net-profit-analytics",         icon: BarChart3,  featureFlag: "netProfitEnabled"           },
      { title: "Net Position",      url: "/factory/net-position",                 icon: Wallet,     featureFlag: "netProfitEnabled"           },
      { title: "Production Summary",url: "/factory/production-summary",           icon: BarChart3,  featureFlag: "productionSummaryEnabled"   },
      { title: "Supplier Report",   url: "/factory/supplier-report",              icon: ClipboardCheck, featureFlag: "supplierReportEnabled"  },
      { title: "Supplier Statement",url: "/factory/supplier-statement",           icon: ClipboardCheck, featureFlag: "supplierStatementEnabled"},
      { title: "Intel Settings",    url: "/factory/intelligence/settings",        icon: Settings,   adminOnly: true                           },
    ],
  },
];

export const FACTORY_NAV_PAGES: { key: string; label: string; group: string }[] = [
  ...navSections.flatMap(s =>
    s.items.map(item => ({ key: item.url.replace(/^\//, ""), label: item.title, group: s.label }))
  ),
  { key: "factory/dashboard", label: "Dashboard", group: "Overview" },
  { key: "factory/daybook",   label: "Daybook",   group: "Other"    },
  { key: "factory/chat",      label: "Chat",      group: "Other"    },
  { key: "factory/settings",  label: "Settings",  group: "Other"    },
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
    if (count > prevUnreadRef.current)
      toast({ title: "New message", description: `You have ${count} unread message${count > 1 ? "s" : ""}.` });
    prevUnreadRef.current = count;
  }, [chatUnread?.count]);

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
    staleTime: 30000,
  });

  const isDeveloper = user?.role === "Developer";

  const visibleSections = navSections
    .filter(s => !s.developerOnly || isDeveloper)
    .map(s => ({
      ...s,
      items: s.items.filter(item => {
        if (item.adminOnly && !isAdmin) return false;
        if (item.featureFlag) { if (!settings || settings[item.featureFlag] !== true) return false; }
        if (myAccess && !myAccess.fullAccess && myAccess.pageKeys.length > 0)
          if (!myAccess.pageKeys.includes(item.url.replace(/^\//, ""))) return false;
        if (item.requiresExplicitAccess && !isAdmin && myAccess) {
          if (myAccess.fullAccess) return false;
          if (!myAccess.pageKeys.includes(item.url.replace(/^\//, ""))) return false;
        }
        return true;
      }),
    })).filter(s => s.items.length > 0);

  // Auto-open the section that contains the active route
  const activeSection = visibleSections.find(s => s.items.some(i => location === i.url));
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(activeSection ? [activeSection.label] : [])
  );

  useEffect(() => {
    if (activeSection) {
      setOpenSections(prev => {
        if (prev.has(activeSection.label)) return prev;
        const next = new Set(prev);
        next.add(activeSection.label);
        return next;
      });
    }
  }, [location]);

  const toggleSection = (label: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  const hasDashboard = isAdmin || (myAccess && !myAccess.fullAccess && myAccess.pageKeys.includes("factory/dashboard"));
  const initials = user?.username ? user.username.substring(0, 2).toUpperCase() : "AD";

  const NavLink = ({ item, color }: { item: NavItem; color: string }) => {
    const isActive = location === item.url;
    return (
      <a
        href={item.url}
        data-testid={`link-factory-${item.url.split("/").pop()}`}
        className={`flex items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        }`}
        style={{ borderLeft: `2px solid ${isActive ? color : "transparent"}`, paddingLeft: "8px", paddingRight: "10px" }}
      >
        <item.icon className="h-3.5 w-3.5 shrink-0" style={isActive ? { color } : {}} />
        <span className="flex-1 leading-tight">{item.title}</span>
      </a>
    );
  };

  const FlatLink = ({ href, icon: Icon, label, color = "#6b7280", badge, testId }: {
    href: string; icon: any; label: string; color?: string; badge?: number; testId: string;
  }) => {
    const isActive = location === href;
    return (
      <a
        href={href}
        data-testid={testId}
        className={`flex items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        }`}
        style={{ borderLeft: `2px solid ${isActive ? color : "transparent"}`, paddingLeft: "8px", paddingRight: "10px" }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" style={isActive ? { color } : {}} />
        <span className="flex-1 leading-tight">{label}</span>
        {badge != null && badge > 0 && (
          <Badge variant="default" className="text-xs min-w-5 justify-center">{badge}</Badge>
        )}
      </a>
    );
  };

  return (
    <Sidebar>
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

      <SidebarContent className="px-3 py-2 overflow-y-auto">
        {/* Pinned top items */}
        <div className="space-y-0.5 mb-2">
          {hasDashboard && (
            <FlatLink href="/factory/dashboard" icon={LayoutDashboard} label="Dashboard" color="#3b82f6" testId="link-factory-dashboard" />
          )}
          {settings?.daybookEnabled !== false && !myAccess?.hiddenCostFields?.includes("hide_tab_daybook") && (
            <FlatLink href="/factory/daybook" icon={BookOpen} label="Daybook" color="#3b82f6" testId="link-factory-daybook" />
          )}
        </div>

        {/* Collapsible sections */}
        <div className="space-y-1">
          {visibleSections.map(section => {
            const isOpen = openSections.has(section.label);
            const hasActive = section.items.some(i => location === i.url);
            return (
              <div key={section.label}>
                {/* Section toggle header */}
                <button
                  onClick={() => toggleSection(section.label)}
                  data-testid={`button-section-${section.label.toLowerCase()}`}
                  className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-left transition-colors hover:bg-sidebar-accent/30"
                >
                  <span
                    className="flex-1 text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: section.color, opacity: hasActive ? 1 : 0.65 }}
                  >
                    {section.label}
                  </span>
                  <ChevronDown
                    className="h-3 w-3 shrink-0 transition-transform duration-200"
                    style={{ color: section.color, opacity: 0.65, transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                  />
                </button>

                {/* Section items */}
                {isOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {section.items.map(item => (
                      <NavLink key={item.url} item={item} color={section.color} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom utility strip */}
        <div className="mt-4 pt-3 border-t border-sidebar-border/60 space-y-0.5">
          <FlatLink href="/factory/chat" icon={MessageCircle} label="Chat" color="#3b82f6" badge={chatUnread?.count} testId="link-factory-chat" />
          {conflictCount > 0 && (
            <a
              href="/factory/conflicts"
              data-testid="link-factory-conflicts"
              className="flex items-center gap-2.5 rounded-md py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
              style={{ borderLeft: "2px solid transparent", paddingLeft: "8px", paddingRight: "10px" }}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-500" />
              <span className="flex-1 leading-tight">Conflicts</span>
              <Badge variant="outline" className="text-xs min-w-5 justify-center border-orange-500/40 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400" data-testid="badge-factory-conflict-count">
                {conflictCount}
              </Badge>
            </a>
          )}
          {isAdmin && (
            <FlatLink href="/factory/settings" icon={Settings} label="Settings" color="#6b7280" testId="link-factory-settings" />
          )}
        </div>
      </SidebarContent>

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
