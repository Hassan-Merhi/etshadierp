import { BarChart3, Building2, LayoutDashboard, Layers, Link2, Wrench } from "lucide-react";
import type { NavItem, NavSection } from "@/components/sidebar/sidebarPrimitives";
import { NAV_COLOR } from "@/components/sidebar/sidebarPrimitives";

export const SUPPLIER_PARTNER_DAILY_ITEMS: NavItem[] = [
  { title: "Overview", url: "/sp", icon: LayoutDashboard },
  { title: "SP Reports", url: "/sp/reports", icon: BarChart3 },
  { title: "Opening Stock", url: "/sp/opening-stock", icon: Layers },
  { title: "Aliases", url: "/sp/aliases", icon: Link2 },
];

export const SUPPLIER_PARTNER_ADMIN_ITEMS: NavItem[] = [
  { title: "Setup", url: "/sp/setup", icon: Wrench },
  { title: "Migration", url: "/sp/gc-migration", icon: Building2 },
];

export const SUPPLIER_PARTNER_SECTIONS: NavSection[] = [
  {
    label: "Supplier Partner",
    color: NAV_COLOR.operations,
    items: SUPPLIER_PARTNER_DAILY_ITEMS,
  },
  {
    label: "SP Administration",
    color: NAV_COLOR.administration,
    items: SUPPLIER_PARTNER_ADMIN_ITEMS,
  },
];

export const SUPPLIER_PARTNER_RECENT_ITEMS: NavItem[] = [
  ...SUPPLIER_PARTNER_DAILY_ITEMS,
  ...SUPPLIER_PARTNER_ADMIN_ITEMS,
];
