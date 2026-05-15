import {
  Landmark,
  FileText,
  BookOpen,
  Settings,
  Building2,
  Store,
  ClipboardList,
  ArrowLeftRight,
  KeyRound,
} from "lucide-react";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { useMemo } from "react";
import { useRecentNav } from "@/hooks/use-recent-nav";
import { Clock } from "lucide-react";
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

export const PROPERTIES_NAV_SECTIONS: NavSection[] = [
  {
    label: "Rentals",
    color: NAV_COLOR.finance,
    items: [
      { title: "Properties (Warehouses)", url: "/properties/rental/warehouses", icon: Building2      },
      { title: "Shops Rented",            url: "/properties/rental/shops",      icon: Store          },
      { title: "Payments Log",            url: "/properties/rental/payments",   icon: ClipboardList  },
      { title: "Cash Transfer",           url: "/properties/transfer",          icon: ArrowLeftRight },
    ],
  },
  {
    label: "Accounting",
    color: NAV_COLOR.accounting,
    items: [
      { title: "Accounts", url: "/properties/accounts", icon: Landmark },
      { title: "Vouchers", url: "/properties/vouchers", icon: FileText },
    ],
  },
];

const PROPERTIES_PINNED_DEFAULTS: NavItem[] = [
  { title: "Daybook", url: "/properties/daybook", icon: BookOpen },
];

export function PropertiesSidebar({ user }: { user?: any }) {
  const isAdmin = user?.role === "Admin" || user?.role === "Developer";

  const { items: pinnedItems, reorder: reorderPinned } = usePinnedOrder(
    "properties-pinned-order",
    PROPERTIES_PINNED_DEFAULTS,
  );

  const { openSections, toggleSection } = useOpenSections(PROPERTIES_NAV_SECTIONS, {
    defaultFirstWhenNoneActive: true,
  });

  const allNavItems = useMemo(
    () => [
      ...PROPERTIES_PINNED_DEFAULTS,
      ...PROPERTIES_NAV_SECTIONS.flatMap((s) => s.items),
    ],
    [],
  );
  const recentItems = useRecentNav(allNavItems);

  const testIdFor = (i: NavItem) => `link-properties-${i.url.split("/").pop()}`;

  return (
    <Sidebar>
      <ModuleHeader
        icon={Building2}
        label="Business OS"
        tagline="Properties / Rentals"
        accent={MODULE_ACCENT.properties}
      />

      <SidebarContent className="px-3 py-2 overflow-y-auto">
        <PinnedNavList
          items={pinnedItems}
          color={NAV_COLOR.pinned}
          onReorder={reorderPinned}
          testIdFor={testIdFor}
        />

        <div className="space-y-1">
          {PROPERTIES_NAV_SECTIONS.map((section) => (
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
                  testId={`link-props-recent-${item.url.replace(/\//g, "-")}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-sidebar-border/60 space-y-0.5">
          <SidebarFlatLink href="/my-settings" icon={KeyRound} label="My Settings" testId="link-properties-my-settings" />
          {isAdmin && (
            <SidebarFlatLink href="/properties/settings" icon={Settings} label="Settings" testId="link-properties-settings" />
          )}
        </div>
      </SidebarContent>

      <ModuleFooter user={user} accent={MODULE_ACCENT.properties} />
    </Sidebar>
  );
}
