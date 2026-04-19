import {
  LayoutDashboard,
  Landmark,
  FileText,
  TrendingUp,
  BookOpen,
  Settings,
  Building2,
  Store,
  ChevronDown,
  ClipboardList,
  ArrowLeftRight,
} from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { useLocation } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useState, useEffect } from "react";

interface NavItem {
  title: string;
  url: string;
  icon: any;
  adminOnly?: boolean;
}

interface NavSection {
  label: string;
  color: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Rentals",
    color: "#10b981",
    items: [
      { title: "Properties (Warehouses)", url: "/properties/rental/warehouses", icon: Building2      },
      { title: "Shops Rented",            url: "/properties/rental/shops",      icon: Store          },
      { title: "Payments Log",            url: "/properties/rental/payments",   icon: ClipboardList  },
      { title: "Cash Transfer",           url: "/properties/transfer",          icon: ArrowLeftRight },
    ],
  },
  {
    label: "Accounting",
    color: "#6366f1",
    items: [
      { title: "Accounts", url: "/properties/accounts", icon: Landmark },
      { title: "Vouchers", url: "/properties/vouchers", icon: FileText },
    ],
  },
  {
    label: "Reports",
    color: "#8b5cf6",
    items: [
      { title: "Analytics",  url: "/properties/analytics", icon: TrendingUp },
    ],
  },
];

export function PropertiesSidebar({ user }: { user?: any }) {
  const [location] = useLocation();
  const isAdmin = user?.role === "Admin" || user?.role === "Developer";

  const activeSection = navSections.find(s => s.items.some(i => location === i.url));
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(activeSection ? [activeSection.label] : [navSections[0].label])
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
    return (
      <a
        href={item.url}
        data-testid={`link-properties-${item.url.split("/").pop()}`}
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

  const FlatLink = ({ href, icon: Icon, label, color = "#6b7280", testId }: {
    href: string; icon: any; label: string; color?: string; testId: string;
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
      </a>
    );
  };

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold leading-tight">Properties</span>
            <span className="text-xs text-muted-foreground leading-tight">Management System</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-2 overflow-y-auto">
        <div className="space-y-0.5 mb-2">
          <FlatLink href="/properties/dashboard" icon={LayoutDashboard} label="Dashboard" color="#6366f1" testId="link-properties-dashboard" />
          <FlatLink href="/properties/daybook" icon={BookOpen} label="Daybook" color="#6366f1" testId="link-properties-daybook" />
        </div>

        <div className="space-y-1">
          {navSections.map(section => {
            const isOpen = openSections.has(section.label);
            const hasActive = section.items.some(i => location === i.url);
            return (
              <div key={section.label}>
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

        <div className="mt-4 pt-3 border-t border-sidebar-border/60 space-y-0.5">
          {isAdmin && (
            <FlatLink href="/properties/settings" icon={Settings} label="Settings" color="#6b7280" testId="link-properties-settings" />
          )}
        </div>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
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
