/**
 * Shared UI primitives — canonical building blocks used across every module
 * (ERP/POS, Factory, Properties, Inventory, Accounting, Reporting,
 * internal-tools). Import from here to keep page-level imports tidy.
 *
 *   import {
 *     PageHeader, StatCard, DashboardCard, SectionCard,
 *     DataTableToolbar, EmptyState, LoadingSkeleton, StatusBadge,
 *     ConfirmDialog, QuickActionCard, ActivityTimeline, AlertPanel,
 *     PropertyCard, FactoryKpiCard, FinancialSummaryCard,
 *   } from "@/components/shared";
 */
export { PageHeader } from "./PageHeader";
export { KPICard } from "./KPICard";
export { StatCard, type StatCardProps, type StatTone } from "./StatCard";
export { DashboardCard, type DashboardCardProps } from "./DashboardCard";
export { SectionCard, type SectionCardProps } from "./SectionCard";
export { DataTableToolbar, type DataTableToolbarProps } from "./DataTableToolbar";
export { EmptyState } from "./ui/empty-state";
export { LoadingSkeleton, type LoadingSkeletonProps } from "./LoadingSkeleton";
export { StatusBadge, type StatusBadgeProps, type StatusKind } from "./StatusBadge";
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmDialogTone } from "./ConfirmDialog";
export { QuickActionCard, type QuickActionCardProps } from "./QuickActionCard";
export { ActivityTimeline, type ActivityTimelineItem, type ActivityTimelineProps } from "./ActivityTimeline";
export { AlertPanel, type AlertPanelProps, type AlertTone } from "./AlertPanel";
export { PropertyCard, type PropertyCardProps } from "./PropertyCard";
export { FactoryKpiCard, type FactoryKpiCardProps } from "./FactoryKpiCard";
export { FinancialSummaryCard, type FinancialSummaryCardProps } from "./FinancialSummaryCard";
