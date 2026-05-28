import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FileText,
  Settings,
  Layers,
  BarChart3,
  FolderPlus,

  Wallet,
  Users,
  Receipt,
  Book,
  UserCheck,

  PieChart,
  Ship,
  TrendingUp,
  MessageCircle,
  TableProperties,
  ExternalLink,
  AlertTriangle,
  Tag,
  UserRound,
  ArrowLeftRight,
  ScrollText,
  Building2,
  Store,
  ClipboardList,
  KeyRound,
  LayoutGrid,
  Handshake,
  Globe,
  Boxes,
  PackagePlus,
  Tags,
  Wrench,
  Bot,
  ShieldCheck,
} from "lucide-react";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";
import { ROUTE_TO_FEATURE } from "@shared/schema";
import { useRef, useEffect, useMemo } from "react";
import { useCompany } from "@/contexts/CompanyContext";
import { useRecentNav } from "@/hooks/use-recent-nav";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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

const defaultPinnedItems: NavItem[] = [
  { title: "Tracking",    url: "/tracking",             icon: Ship            },
  { title: "Dashboard",   url: "/financial-overview",  icon: LayoutDashboard },
  { title: "Agent Ledger", url: "/agents",              icon: UserRound       },
  { title: "Daybook",     url: "/daybook",             icon: Book            },
  { title: "All Daybook", url: "/transaction-journal", icon: ScrollText      },
  { title: "Vouchers",    url: "/vouchers",            icon: Receipt         },
];

export const ERP_NAV_SECTIONS: NavSection[] = [
  {
    label: "Inventory",
    color: NAV_COLOR.inventory,
    items: [
      { title: "Inventory",         url: "/inventory",         icon: Layers   },
      { title: "Stock",             url: "/stock",             icon: Package  },
      { title: "Optional Vouchers", url: "/optional-vouchers", icon: FileText },
    ],
  },
  {
    label: "Sales & POS",
    color: NAV_COLOR.sales,
    items: [
      { title: "POS",          url: "/pos",          icon: ShoppingCart },
      { title: "Sales Tools",  url: "/sales-tools",  icon: LayoutGrid   },
    ],
  },
  {
    label: "Accounting",
    color: NAV_COLOR.accounting,
    items: [
      { title: "Accounts",         url: "/accounts",         icon: Wallet         },
      { title: "Parties",          url: "/parties",          icon: Handshake      },
      { title: "Payroll",          url: "/payroll",          icon: UserCheck      },
      { title: "Company Transfer", url: "/company-transfer", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Analytics",
    color: NAV_COLOR.analytics,
    items: [
      { title: "Sales Report",      url: "/sales-report",      icon: PieChart   },
      { title: "Analytics",         url: "/analytics",         icon: BarChart3  },
      { title: "Net Profit Report", url: "/net-profit-report", icon: TrendingUp },
    ],
  },
  {
    label: "Rentals",
    color: NAV_COLOR.rentals,
    items: [
      { title: "Shops",         url: "/erp/rental/shops",      icon: Store          },
    ],
  },
  {
    label: "AI Tools",
    color: NAV_COLOR.analytics,
    devOnly: true,
    items: [
      { title: "AI Command Center", url: "/ai-command-center", icon: Bot         },
      { title: "AI Validation",     url: "/ai-validation",     icon: ShieldCheck },
    ],
  },
];

const utilityItems: NavItem[] = [
  { title: "Create",      url: "/create",      icon: FolderPlus      },
  { title: "Spreadsheet", url: "/spreadsheet", icon: TableProperties },
  { title: "Live Sheets", url: "/live-sheets", icon: ExternalLink    },
];

export const ERP_PINNED_ITEMS = defaultPinnedItems;
export const ERP_UTILITY_ITEMS = utilityItems;

export function useErpVisibleSections(user?: any): {
  sections: NavSection[];
  isItemVisible: (item: NavItem) => boolean;
  visibleUtilityItems: NavItem[];
  visiblePinnedItems: NavItem[];
} {
  const { selectedCompany } = useCompany();

  const { data: myErpPages } = useQuery<{ pageKeys: string[]; fullAccess: boolean }>({
    queryKey: ["/api/my-erp-pages"],
    enabled: !!user,
  });

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    queryFn: async () => {
      const res = await fetch(`/api/company-settings?companyId=${selectedCompany?.id}`, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
  });

  const allowedPages = new Set<string>(myErpPages?.pageKeys || []);

  const isItemVisible = (item: NavItem): boolean => {
    const isPOSUser   = user?.role === "POS";
    const isAdmin     = user?.role === "Admin" || user?.role === "Developer";
    const isDeveloper = user?.role === "Developer";
    const isOwner     = user?.role === "Owner";
    const featureKey  = ROUTE_TO_FEATURE[item.url];

    if (item.url === "/factory/raw-stock" && selectedCompany?.companyType !== "factory" && selectedCompany?.companyType !== "factory_v2") return false;
    if (item.url === "/net-profit-report")       return isDeveloper;
    if (item.url === "/company-transfer")        return isDeveloper;
    if (item.url === "/spreadsheet")             return isDeveloper;
    if (item.url === "/live-sheets")             return isDeveloper;
    if (item.url === "/chat")        return !isPOSUser;
    if (item.url === "/settings" && isOwner) return false;

    if (isDeveloper || isAdmin || myErpPages?.fullAccess) return true;

    if (isPOSUser) {
      const posRoutes = ["/pos", "/pos-dashboard", "/pos-daybook", "/sales-tools", "/location-inventory"];
      if (companySettings?.posExcelImportEnabled) posRoutes.push("/pos-import");
      return posRoutes.includes(item.url);
    }

    if (featureKey && allowedPages.size > 0) return allowedPages.has(featureKey);
    if (allowedPages.size === 0 && myErpPages)  return false;
    if (item.url === "/settings")    return false;

    return true;
  };

  const isDeveloper = user?.role === "Developer";

  const sections = ERP_NAV_SECTIONS.map(s => ({
    ...s,
    items: s.items.filter(isItemVisible),
  })).filter(s => s.items.length > 0 && (!s.devOnly || isDeveloper));

  return {
    sections,
    isItemVisible,
    visibleUtilityItems: utilityItems.filter(isItemVisible),
    visiblePinnedItems: defaultPinnedItems.filter(isItemVisible),
  };
}

export function AppSidebar({ user }: { user?: any }) {
  const { toast } = useToast();
  const { conflictCount } = useConnectivity();
  const { selectedCompany } = useCompany();
  const prevUnreadRef = useRef<number>(-1);

  const { items: pinnedItems, reorder: reorderPinned } = usePinnedOrder(
    "erp-pinned-order",
    defaultPinnedItems,
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

  const { sections: visibleSections, isItemVisible } = useErpVisibleSections(user);

  const { openSections, toggleSection } = useOpenSections(visibleSections);

  const allNavItems = useMemo(
    () => [
      ...defaultPinnedItems,
      ...ERP_NAV_SECTIONS.flatMap((s) => s.items),
      ...utilityItems,
    ],
    [],
  );
  const recentItems = useRecentNav(allNavItems, selectedCompany?.id);

  const trailingFor = (item: NavItem) => {
    if (item.url !== "/chat") return null;
    const unread = chatUnread?.count || 0;
    if (unread <= 0) return null;
    return (
      <Badge variant="default" className="text-xs min-w-5 justify-center" data-testid="badge-chat-unread">
        {unread}
      </Badge>
    );
  };

  return (
    <Sidebar>
      <ModuleHeader
        icon={Package}
        label="Business OS"
        tagline="ERP / Warehouse"
        accent={MODULE_ACCENT.erp}
      />

      <SidebarContent className="px-3 py-2 overflow-y-auto">
        <PinnedNavList
          items={pinnedItems}
          color={NAV_COLOR.pinned}
          onReorder={reorderPinned}
          isVisible={isItemVisible}
          testIdFor={(i) => `link-${i.url}`}
          trailingFor={trailingFor}
        />

        <div className="space-y-1">
          {visibleSections.map((section) => (
            <SidebarSectionGroup
              key={section.label}
              section={section}
              isOpen={openSections.has(section.label)}
              onToggle={() => toggleSection(section.label)}
              sectionTestId={`button-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
              testIdFor={(i) => `link-${i.url}`}
              trailingFor={trailingFor}
            />
          ))}
          {selectedCompany?.companyType === "supplier_partner" && (
            <SidebarSectionGroup
              section={{
                label: "Supplier Partner",
                color: NAV_COLOR.operations,
                items: [
                  { title: "SP Reports",    url: "/sp/reports",        icon: BarChart3      },
                  { title: "Setup",         url: "/sp/setup",          icon: Wrench         },
                  { title: "Migration",     url: "/sp/migration",      icon: ArrowLeftRight },
                  { title: "GC Migration",  url: "/sp/gc-migration",   icon: Building2      },
                ],
              }}
              isOpen={openSections.has("Supplier Partner")}
              onToggle={() => toggleSection("Supplier Partner")}
              sectionTestId="button-section-supplier-partner"
              testIdFor={(i) => `link-${i.url}`}
              trailingFor={() => null}
            />
          )}
        </div>

        {recentItems.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Recent
            </p>
            <div className="space-y-0.5">
              {recentItems.map((item) => (
                <SidebarFlatLink
                  key={item.url}
                  href={item.url}
                  icon={Clock}
                  label={item.title}
                  testId={`link-recent-${item.url.replace(/\//g, "-")}`}
                />
              ))}
            </div>
          </div>
        )}

        {utilityItems.filter(isItemVisible).length > 0 && (
          <div className="mt-4">
            <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Tools
            </p>
            <div className="space-y-0.5">
              {utilityItems.filter(isItemVisible).map((item) => (
                <SidebarFlatLink
                  key={item.url}
                  href={item.url}
                  icon={item.icon}
                  label={item.title}
                  testId={`link-${item.url}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-sidebar-border/60 space-y-0.5">
          {isItemVisible({ title: "Chat", url: "/chat", icon: MessageCircle }) && (
            <SidebarFlatLink
              href="/chat"
              icon={MessageCircle}
              label="Chat"
              color={NAV_COLOR.pinned}
              badge={chatUnread?.count}
              testId="link-chat"
            />
          )}
          {conflictCount > 0 && (
            <a
              href="/conflicts"
              data-testid="link-conflicts"
              className="flex items-center gap-2.5 rounded-md py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
              style={{ borderLeft: "2px solid transparent", paddingLeft: "8px", paddingRight: "10px" }}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-500" />
              <span className="flex-1 leading-tight">Conflicts</span>
              <Badge variant="outline" className="text-xs min-w-5 justify-center border-orange-500/40 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400" data-testid="badge-conflict-count">
                {conflictCount}
              </Badge>
            </a>
          )}
          {!["Admin", "Owner", "Developer"].includes(user?.role) && (
            <SidebarFlatLink href="/my-settings" icon={KeyRound} label="My Settings" testId="link-my-settings" />
          )}
          {isItemVisible({ title: "Settings", url: "/settings", icon: Settings }) && (
            <SidebarFlatLink href="/settings" icon={Settings} label="Settings" testId="link-settings" />
          )}
        </div>
      </SidebarContent>

      <ModuleFooter user={user} accent={MODULE_ACCENT.erp} />
    </Sidebar>
  );
}
