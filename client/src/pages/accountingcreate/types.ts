/**
 * Types for the AccountingCreate page.
 *
 * Extracted from AccountingCreate.tsx during the Phase 4 god-file split.
 */
import {type LucideIcon} from "lucide-react";

export type EntityType = "location" | "ledger" | "employee" | "supplier" | "stockGroup" | "stockItem";

export interface SidebarItem {
  key: EntityType;
  label: string;
  icon: LucideIcon;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}
