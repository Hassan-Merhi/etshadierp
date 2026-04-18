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
  TrendingUp,
  MessageCircle,
  TableProperties,
  ExternalLink,
  AlertTriangle,
  Tag,
  UserRound,
  ChevronDown,
  GripVertical,
  ArrowLeftRight,
  ScrollText,
  Building2,
  Store,
} from "lucide-react";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { useLocation } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { ROUTE_TO_FEATURE } from "@shared/schema";
import { useState, useRef, useEffect } from "react";
import { useCompany } from "@/contexts/CompanyContext";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface NavItem {
  title: string;
  url: string;
  icon: any;
}

interface NavSection {
  label: string;
  color: string;
  items: NavItem[];
}

const defaultPinnedItems: NavItem[] = [
  { title: "Tracking",    url: "/",                    icon: Ship            },
  { title: "Dashboard",   url: "/financial-overview",  icon: LayoutDashboard },
  { title: "Agents",      url: "/agents",              icon: UserRound       },
  { title: "Daybook",     url: "/daybook",             icon: Book            },
  { title: "All Daybook", url: "/transaction-journal", icon: ScrollText      },
  { title: "Vouchers",    url: "/vouchers",            icon: Receipt         },
];

const PINNED_ORDER_KEY = "erp-pinned-order";

function loadPinnedOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(PINNED_ORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePinnedOrder(urls: string[]) {
  try {
    localStorage.setItem(PINNED_ORDER_KEY, JSON.stringify(urls));
  } catch {}
}

const navSections: NavSection[] = [
  {
    label: "Inventory",
    color: "#a855f7",
    items: [
      { title: "Location Inventory", url: "/location-inventory", icon: MapPin    },
      { title: "Stock OTW",          url: "/stock-otw",          icon: Ship      },
      { title: "Containers",         url: "/containers",         icon: Container },
      { title: "Stock Items",        url: "/stock-items",        icon: Package   },
      { title: "Stock Query",        url: "/stock-query",        icon: Search    },
      { title: "Optional Vouchers",  url: "/optional-vouchers",  icon: FileText  },
    ],
  },
  {
    label: "Sales & POS",
    color: "#22c55e",
    items: [
      { title: "POS",               url: "/pos",              icon: ShoppingCart },
      { title: "POS Daybook",      url: "/pos-daybook",      icon: Book         },
      { title: "Stock Transfers",  url: "/stock-transfers",  icon: ArrowLeftRight },
      { title: "Price List",       url: "/price-list",       icon: Tag          },
    ],
  },
  {
    label: "Accounting",
    color: "#f59e0b",
    items: [
      { title: "Accounts",              url: "/accounts",             icon: Wallet         },
      { title: "Suppliers",             url: "/suppliers",            icon: Users          },
      { title: "Customers",             url: "/customers",            icon: Users          },
      { title: "Payroll",               url: "/payroll",              icon: UserCheck      },
      { title: "Company Transfer",      url: "/company-transfer",     icon: ArrowLeftRight },
    ],
  },
  {
    label: "Analytics",
    color: "#06b6d4",
    items: [
      { title: "Sales Report",      url: "/sales-report",      icon: PieChart   },
      { title: "Analytics",         url: "/analytics",         icon: BarChart3  },
      { title: "Net Profit Report", url: "/net-profit-report", icon: TrendingUp },
    ],
  },
  {
    label: "Rentals",
    color: "#8b5cf6",
    items: [
      { title: "Warehouses", url: "/erp/rental/warehouses", icon: Building2 },
      { title: "Shops",      url: "/erp/rental/shops",      icon: Store     },
    ],
  },
];

const utilityItems: NavItem[] = [
  { title: "Create",      url: "/create",      icon: FolderPlus      },
  { title: "Spreadsheet", url: "/spreadsheet", icon: TableProperties },
  { title: "Live Sheets", url: "/live-sheets", icon: ExternalLink    },
];

export function AppSidebar({ user }: { user?: any }) {
  const [location] = useLocation();
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { conflictCount } = useConnectivity();
  const prevUnreadRef = useRef<number>(-1);

  // Pinned items drag-and-drop order (persisted to localStorage)
  const [pinnedOrder, setPinnedOrder] = useState<string[]>(() => {
    const saved = loadPinnedOrder();
    if (saved) {
      const defaultUrls = defaultPinnedItems.map(i => i.url);
      // If all defaults are already in saved, use saved (preserving user's custom order)
      const allPresent = defaultUrls.every(u => saved.includes(u));
      if (allPresent) return saved.filter(u => defaultUrls.includes(u));
      // Otherwise reset to default (new items added to defaults)
      return defaultUrls;
    }
    return defaultPinnedItems.map(i => i.url);
  });
  const dragPinnedRef = useRef<string | null>(null);
  const dragOverPinnedRef = useRef<string | null>(null);

  const pinnedItems = pinnedOrder
    .map(url => defaultPinnedItems.find(i => i.url === url))
    .filter(Boolean) as NavItem[];

  const handlePinnedDragStart = (url: string) => {
    dragPinnedRef.current = url;
  };
  const handlePinnedDragOver = (e: React.DragEvent, url: string) => {
    e.preventDefault();
    dragOverPinnedRef.current = url;
  };
  const handlePinnedDrop = (targetUrl: string) => {
    const fromUrl = dragPinnedRef.current;
    if (!fromUrl || fromUrl === targetUrl) return;
    const fromIdx = pinnedOrder.indexOf(fromUrl);
    const toIdx = pinnedOrder.indexOf(targetUrl);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...pinnedOrder];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromUrl);
    setPinnedOrder(next);
    savePinnedOrder(next);
    dragPinnedRef.current = null;
    dragOverPinnedRef.current = null;
  };

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
    const isPOSUser   = user?.role?.startsWith("POS");
    const isAdmin     = user?.role === "Admin";
    const isDeveloper = user?.role === "Developer";
    const featureKey  = ROUTE_TO_FEATURE[item.url];

    if (item.url === "/factory/raw-stock" && selectedCompany?.companyType !== "factory") return false;
    if (item.url === "/net-profit-report") return isDeveloper;
    if (item.url === "/chat")       return !isPOSUser;
    if (item.url === "/price-list") return !isPOSUser;

    if (isDeveloper || isAdmin || myErpPages?.fullAccess) return true;

    if (isPOSUser) {
      const posRoutes = ["/pos", "/pos-dashboard", "/pos-daybook", "/location-inventory"];
      if (companySettings?.posExcelImportEnabled) posRoutes.push("/pos-import");
      return posRoutes.includes(item.url);
    }

    if (featureKey && allowedPages.size > 0) return allowedPages.has(featureKey);
    if (allowedPages.size === 0 && myErpPages)  return false;
    if (item.url === "/settings")    return false;
    if (item.url === "/pos-daybook") return isPOSUser;

    return true;
  };

  const visibleSections = navSections.map(s => ({
    ...s,
    items: s.items.filter(isItemVisible),
  })).filter(s => s.items.length > 0);

  // Auto-open the section containing the active route
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

  const initials = user?.username ? user.username.substring(0, 2).toUpperCase() : "AD";

  const NavLink = ({ item, color }: { item: NavItem; color: string }) => {
    const isActive = location === item.url;
    const unread   = item.url === "/chat" ? (chatUnread?.count || 0) : 0;
    return (
      <a
        href={item.url}
        data-testid={`link-${item.url}`}
        className={`flex items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        }`}
        style={{ borderLeft: `2px solid ${isActive ? color : "transparent"}`, paddingLeft: "8px", paddingRight: "10px" }}
      >
        <item.icon className="h-3.5 w-3.5 shrink-0" style={isActive ? { color } : {}} />
        <span className="flex-1 leading-tight">{item.title}</span>
        {unread > 0 && (
          <Badge variant="default" className="text-xs min-w-5 justify-center" data-testid="badge-chat-unread">{unread}</Badge>
        )}
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
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold leading-tight">ERP POS</span>
            <span className="text-xs text-muted-foreground leading-tight">Warehouse Management</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-2 overflow-y-auto">
        {/* Pinned top items — draggable to reorder */}
        <div className="space-y-0.5 mb-2">
          {pinnedItems.filter(isItemVisible).map(item => {
            const isActive = location === item.url;
            const unread = item.url === "/chat" ? (chatUnread?.count || 0) : 0;
            return (
              <div
                key={item.url}
                onDragOver={(e) => handlePinnedDragOver(e, item.url)}
                onDrop={() => handlePinnedDrop(item.url)}
                className="flex items-center group"
              >
                <span
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); handlePinnedDragStart(item.url); }}
                  className="flex items-center justify-center w-5 py-1.5 cursor-grab opacity-0 group-hover:opacity-40 shrink-0"
                  title="Drag to reorder"
                >
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <a
                  href={item.url}
                  draggable={false}
                  data-testid={`link-${item.url}`}
                  className={`flex flex-1 items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                  }`}
                  style={{ borderLeft: `2px solid ${isActive ? "#3b82f6" : "transparent"}`, paddingLeft: "8px", paddingRight: "10px" }}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0" style={isActive ? { color: "#3b82f6" } : {}} />
                  <span className="flex-1 leading-tight">{item.title}</span>
                  {unread > 0 && (
                    <Badge variant="default" className="text-xs min-w-5 justify-center">{unread}</Badge>
                  )}
                </a>
              </div>
            );
          })}
        </div>

        {/* Collapsible sections */}
        <div className="space-y-1">
          {visibleSections.map(section => {
            const isOpen   = openSections.has(section.label);
            const hasActive = section.items.some(i => location === i.url);
            return (
              <div key={section.label}>
                <button
                  onClick={() => toggleSection(section.label)}
                  data-testid={`button-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
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

        {/* Tools section */}
        {utilityItems.filter(isItemVisible).length > 0 && (
          <div className="mt-4">
            <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Tools
            </p>
            <div className="space-y-0.5">
              {utilityItems.filter(isItemVisible).map(item => (
                <FlatLink key={item.url} href={item.url} icon={item.icon} label={item.title} color="#6b7280" testId={`link-${item.url}`} />
              ))}
            </div>
          </div>
        )}

        {/* Bottom strip */}
        <div className="mt-4 pt-3 border-t border-sidebar-border/60 space-y-0.5">
          {isItemVisible({ title: "Chat", url: "/chat", icon: MessageCircle }) && (
            <FlatLink href="/chat" icon={MessageCircle} label="Chat" color="#3b82f6" badge={chatUnread?.count} testId="link-chat" />
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
          {isItemVisible({ title: "Settings", url: "/settings", icon: Settings }) && (
            <FlatLink href="/settings" icon={Settings} label="Settings" color="#6b7280" testId="link-settings" />
          )}
        </div>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium leading-tight truncate">{user?.username || "User"}</span>
            <span className="text-xs text-muted-foreground leading-tight">{user?.role || "Role"}</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
