import { BarChart3, Wrench } from "lucide-react";
import type { NavItem, NavSection } from "@/components/sidebar/sidebarPrimitives";
import { NAV_COLOR } from "@/components/sidebar/sidebarPrimitives";

export const SUPPLIER_PARTNER_DAILY_ITEMS: NavItem[] = [
  { title: "Setup", url: "/sp/setup", icon: Wrench },
  { title: "SP Reports", url: "/sp/reports", icon: BarChart3 },
];

export const SUPPLIER_PARTNER_SECTIONS: NavSection[] = [
  {
    label: "Supplier Partner",
    color: NAV_COLOR.operations,
    items: SUPPLIER_PARTNER_DAILY_ITEMS,
  },
];

export const SUPPLIER_PARTNER_RECENT_ITEMS: NavItem[] = [...SUPPLIER_PARTNER_DAILY_ITEMS];
