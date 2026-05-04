import {
  Package,
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
  Settings,
  ShoppingCart,
  HardHat,
  UserRound,
  ClipboardCheck,
  Activity,
  Bell,
  Award,
  Beaker,
  Trash2,
  DollarSign,
  Gauge,
  MessageCircle,
  AlertTriangle,
  LayoutGrid,
  Scale,
  Store,
  Table,
  TableProperties,
  KeyRound,
} from "lucide-react";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { useRef, useEffect } from "react";
import {
  ModuleHeader,
  ModuleFooter,
  PinnedNavList,
  SidebarFlatLink,
  SidebarSectionGroup,
  usePinnedOrder,
  useOpenSections,
  MODULE_ACCENT,
  NAV_COLOR,
  type NavItem,
  type NavSection,
} from "@/components/sidebar/sidebarPrimitives";

interface FactoryNavItem extends NavItem {
  adminOnly?: boolean;
  featureFlag?: string;
  featureFlagDefaultOn?: boolean;
  hideKey?: string;
  requiresExplicitAccess?: boolean;
}

interface FactoryNavSection extends NavSection {
  items: FactoryNavItem[];
  developerOnly?: boolean;
}

export const FACTORY_NAV_SECTIONS: FactoryNavSection[] = [
  {
    label: "Overview",
    color: NAV_COLOR.overview,
    items: [
      { title: "Production Analytics", url: "/factory/production-report", icon: BarChart3 },
      { title: "Factory Sheets",       url: "/factory/sheets",            icon: Table     },
    ],
  },
  {
    label: "Operations",
    color: NAV_COLOR.operations,
    items: [
      { title: "Stock Entry",    url: "/factory/stock-entry",    icon: ScanLine },
      { title: "Raw Materials",  url: "/factory/raw-materials",  icon: Package  },
      { title: "Waste Dispatch", url: "/factory/waste-dispatch", icon: Trash2   },
    ],
  },
  {
    label: "Bales",
    color: NAV_COLOR.bales,
    items: [
      { title: "Bale Explorer", url: "/factory/bales-hub", icon: History },
    ],
  },
  {
    label: "Sales",
    color: NAV_COLOR.sales,
    items: [
      { title: "Factory POS",      url: "/factory/pos",                  icon: ShoppingCart },
      { title: "Customers",        url: "/factory/customers",            icon: Users        },
      { title: "Invoicing",        url: "/factory/invoicing",            icon: FileText     },
      { title: "Stock Allocation", url: "/factory/stock-allocation-v5",  icon: LayoutGrid   },
      { title: "Loadings",         url: "/factory/sales/loadings",       icon: Container    },
    ],
  },
  {
    label: "Inventory",
    color: NAV_COLOR.inventory,
    items: [
      { title: "Location Inventory", url: "/factory/location-inventory", icon: MapPin    },
      { title: "Factory Stock OTW",  url: "/factory/stock-otw",          icon: Ship      },
      { title: "Containers",         url: "/factory/containers",         icon: Container },
    ],
  },
  {
    label: "Finance",
    color: NAV_COLOR.finance,
    items: [
      { title: "Workers",   url: "/factory/workers",   icon: HardHat   },
      { title: "Employees", url: "/factory/employees", icon: Users     },
      { title: "Suppliers", url: "/factory/suppliers", icon: UserRound },
      { title: "Vouchers",  url: "/factory/vouchers",  icon: FileText  },
      { title: "Accounts",  url: "/factory/accounts",  icon: Landmark  },
    ],
  },
  {
    label: "Reports",
    color: NAV_COLOR.reports,
    items: [
      { title: "Analytics",          url: "/factory/analytics",          icon: TrendingUp, adminOnly: true },
      { title: "Financial Snapshot", url: "/factory/financial-snapshot", icon: LayoutGrid, adminOnly: true },
    ],
  },
  {
    label: "Rentals",
    color: NAV_COLOR.rentals,
    items: [
      { title: "Shops", url: "/factory/rental/shops", icon: Store },
    ],
  },
  {
    label: "Intelligence",
    color: NAV_COLOR.intelligence,
    developerOnly: true,
    items: [
      { title: "Factory Dashboard", url: "/factory/intelligence/dashboard",       icon: Activity,       featureFlag: "dashboardEnabled"           },
      { title: "KPIs",              url: "/factory/intelligence/kpis",            icon: Gauge,          featureFlag: "kpisEnabled"                },
      { title: "Profitability",     url: "/factory/intelligence/profitability",   icon: DollarSign,     featureFlag: "profitabilityEnabled"       },
      { title: "Waste Tracking",    url: "/factory/intelligence/waste",           icon: Trash2,         featureFlag: "wasteTrackingEnabled"       },
      { title: "Alerts",            url: "/factory/intelligence/alerts",          icon: Bell,           featureFlag: "alertsEnabled"              },
      { title: "Supplier Scores",   url: "/factory/intelligence/supplier-scores", icon: Award,          featureFlag: "supplierScoringEnabled"     },
      { title: "Mix Optimizer",     url: "/factory/intelligence/mix-optimizer",   icon: Beaker,         featureFlag: "mixOptimizerEnabled"        },
      { title: "Cash Flow",         url: "/factory/intelligence/cashflow",        icon: DollarSign,     featureFlag: "cashflowEnabled"            },
      { title: "Net Profit",        url: "/factory/net-profit-analytics",         icon: BarChart3,      featureFlag: "netProfitEnabled"           },
      { title: "Net Position",      url: "/factory/net-position",                 icon: Wallet,         featureFlag: "netProfitEnabled"           },
      { title: "Production Summary",url: "/factory/production-summary",           icon: BarChart3,      featureFlag: "productionSummaryEnabled"   },
      { title: "Supplier Report",   url: "/factory/supplier-report",              icon: ClipboardCheck, featureFlag: "supplierReportEnabled"      },
      { title: "Supplier Statement",url: "/factory/supplier-statement",           icon: ClipboardCheck, featureFlag: "supplierStatementEnabled"   },
      { title: "Intel Settings",    url: "/factory/intelligence/settings",        icon: Settings,       adminOnly: true                           },
    ],
  },
];

export const FACTORY_NAV_PAGES: { key: string; label: string; group: string }[] = [
  ...FACTORY_NAV_SECTIONS.flatMap(s =>
    s.items.map(item => ({ key: item.url.replace(/^\//, ""), label: item.title, group: s.label }))
  ),
  { key: "factory/dashboard", label: "Dashboard", group: "Overview" },
  { key: "factory/daybook",   label: "Daybook",   group: "Other"    },
  { key: "factory/chat",      label: "Chat",      group: "Other"    },
  { key: "factory/settings",  label: "Settings",  group: "Other"    },
];

const FACTORY_PINNED_DEFAULTS: NavItem[] = [
  { title: "Dashboard", url: "/factory/dashboard", icon: LayoutDashboard },
  { title: "Daybook",   url: "/factory/daybook",   icon: BookOpen        },
  { title: "Agents",    url: "/factory/agents",    icon: UserRound       },
];

export function useFactoryVisibleSections(user?: any): {
  sections: FactoryNavSection[];
  isPinnedVisible: (item: NavItem) => boolean;
  hasDashboard: boolean;
  isAdmin: boolean;
  isDeveloper: boolean;
} {
  const isDeveloper = user?.role === "Developer";
  const isAdmin = user?.role === "Admin" || isDeveloper;

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
    enabled: !!user,
  });

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
    staleTime: 30000,
    enabled: !!user,
  });

  const hasDashboard = !!(isAdmin || (myAccess && !myAccess.fullAccess && myAccess.pageKeys.includes("factory/dashboard")));

  const isPinnedVisible = (item: NavItem): boolean => {
    if (item.url === "/factory/dashboard") return hasDashboard;
    if (item.url === "/factory/daybook") {
      return settings?.daybookEnabled !== false && !myAccess?.hiddenCostFields?.includes("hide_tab_daybook");
    }
    if (item.url === "/factory/agents") {
      return !myAccess?.hiddenCostFields?.includes("hide_tab_agents");
    }
    return true;
  };

  const sections = FACTORY_NAV_SECTIONS
    .filter(s => !s.developerOnly || isDeveloper)
    .map(s => ({
      ...s,
      items: s.items.filter((item) => {
        if (item.adminOnly && !isAdmin) return false;
        if (item.featureFlag) {
          if (item.featureFlagDefaultOn) {
            if (settings && settings[item.featureFlag] === false) return false;
          } else {
            if (!settings || settings[item.featureFlag] !== true) return false;
          }
        }
        if (myAccess && !myAccess.fullAccess && myAccess.pageKeys.length > 0)
          if (!myAccess.pageKeys.includes(item.url.replace(/^\//, ""))) return false;
        if (item.hideKey && myAccess?.hiddenCostFields?.includes(item.hideKey)) return false;
        if (item.requiresExplicitAccess && !isAdmin && myAccess) {
          if (myAccess.fullAccess) return false;
          if (!myAccess.pageKeys.includes(item.url.replace(/^\//, ""))) return false;
        }
        return true;
      }),
    })).filter(s => s.items.length > 0);

  return { sections, isPinnedVisible, hasDashboard, isAdmin, isDeveloper };
}

export function FactorySidebar({ user }: { user?: any }) {
  const { toast } = useToast();
  const { conflictCount } = useConnectivity();
  const prevUnreadRef = useRef<number>(-1);

  const { items: pinnedItems, reorder: reorderPinned } = usePinnedOrder(
    "factory-pinned-order",
    FACTORY_PINNED_DEFAULTS,
  );

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

  const { sections: visibleSections, isPinnedVisible, isAdmin, isDeveloper } = useFactoryVisibleSections(user);

  const { openSections, toggleSection } = useOpenSections(visibleSections);

  const testIdFor = (i: NavItem) => `link-factory-${i.url.split("/").pop()}`;

  return (
    <Sidebar>
      <ModuleHeader
        icon={Factory}
        label="Business OS"
        tagline="Factory / Production"
        accent={MODULE_ACCENT.factory}
      />

      <SidebarContent className="px-3 py-2 overflow-y-auto">
        <PinnedNavList
          items={pinnedItems}
          color={NAV_COLOR.pinned}
          onReorder={reorderPinned}
          isVisible={isPinnedVisible}
          testIdFor={testIdFor}
        />

        <div className="space-y-1">
          {visibleSections.map((section) => (
            <SidebarSectionGroup
              key={section.label}
              section={section}
              isOpen={openSections.has(section.label)}
              onToggle={() => toggleSection(section.label)}
              sectionTestId={`button-section-${section.label.toLowerCase()}`}
              testIdFor={testIdFor}
            />
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-sidebar-border/60 space-y-0.5">
          {isDeveloper && <SidebarFlatLink href="/factory/spreadsheet" icon={TableProperties} label="Spreadsheet" testId="link-factory-spreadsheet" />}
          <SidebarFlatLink href="/factory/chat" icon={MessageCircle} label="Chat" color={NAV_COLOR.pinned} badge={chatUnread?.count} testId="link-factory-chat" />
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
          {!["Admin", "Owner", "Developer"].includes(user?.role) && (
            <SidebarFlatLink href="/my-settings" icon={KeyRound} label="My Settings" testId="link-factory-my-settings" />
          )}
          {(isAdmin || isDeveloper) && (
            <SidebarFlatLink href="/factory/settings" icon={Settings} label="Settings" testId="link-factory-settings" />
          )}
          {isDeveloper && (
            <SidebarFlatLink href="/factory/intelligence/settings" icon={Settings} label="Intel Settings" color={NAV_COLOR.intelligence} testId="link-factory-intel-settings" />
          )}
        </div>
      </SidebarContent>

      <ModuleFooter
        user={user}
        avatarClassName="text-xs font-semibold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
      />
    </Sidebar>
  );
}
