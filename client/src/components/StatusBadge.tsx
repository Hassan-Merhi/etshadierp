import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  CircleDot,
  Pause,
  Loader2,
  type LucideIcon,
} from "lucide-react";

export type StatusKind =
  | "active" | "inactive" | "draft" | "pending" | "approved" | "rejected"
  | "completed" | "in_progress" | "cancelled" | "paid" | "unpaid" | "overdue"
  | "available" | "low_stock" | "out_of_stock" | "rented" | "occupied" | "vacant"
  | "success" | "warning" | "error" | "info" | "neutral";

interface StatusMeta {
  label: string;
  variant: "success" | "warning" | "info" | "destructive" | "muted" | "secondary" | "outline";
  icon?: LucideIcon;
}

const STATUS_MAP: Record<StatusKind, StatusMeta> = {
  active:       { label: "Active",       variant: "success",     icon: CheckCircle2 },
  inactive:     { label: "Inactive",     variant: "muted",       icon: CircleDot },
  draft:        { label: "Draft",        variant: "secondary",   icon: Pause },
  pending:      { label: "Pending",      variant: "warning",     icon: Clock },
  approved:     { label: "Approved",     variant: "success",     icon: CheckCircle2 },
  rejected:     { label: "Rejected",     variant: "destructive", icon: XCircle },
  completed:    { label: "Completed",    variant: "success",     icon: CheckCircle2 },
  in_progress:  { label: "In Progress",  variant: "info",        icon: Loader2 },
  cancelled:    { label: "Cancelled",    variant: "muted",       icon: XCircle },
  paid:         { label: "Paid",         variant: "success",     icon: CheckCircle2 },
  unpaid:       { label: "Unpaid",       variant: "warning",     icon: AlertTriangle },
  overdue:      { label: "Overdue",      variant: "destructive", icon: AlertTriangle },
  available:    { label: "Available",    variant: "success",     icon: CheckCircle2 },
  low_stock:    { label: "Low Stock",    variant: "warning",     icon: AlertTriangle },
  out_of_stock: { label: "Out of Stock", variant: "destructive", icon: XCircle },
  rented:       { label: "Rented",       variant: "info",        icon: CheckCircle2 },
  occupied:     { label: "Occupied",     variant: "info",        icon: CheckCircle2 },
  vacant:       { label: "Vacant",       variant: "muted",       icon: CircleDot },
  success:      { label: "Success",      variant: "success",     icon: CheckCircle2 },
  warning:      { label: "Warning",      variant: "warning",     icon: AlertTriangle },
  error:        { label: "Error",        variant: "destructive", icon: XCircle },
  info:         { label: "Info",         variant: "info",        icon: CircleDot },
  neutral:      { label: "—",            variant: "muted",       icon: CircleDot },
};

export interface StatusBadgeProps {
  status: StatusKind | string;
  label?: string;
  showIcon?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * StatusBadge — canonical pill for entity status across the app. Maps domain
 * statuses to consistent colors and optional icons.
 */
export function StatusBadge({
  status,
  label,
  showIcon = true,
  className,
  "data-testid": testId,
}: StatusBadgeProps) {
  const key = String(status).toLowerCase().replace(/[\s-]/g, "_") as StatusKind;
  const meta = STATUS_MAP[key] ?? { label: String(status), variant: "muted" as const };
  const Icon = meta.icon;
  const text = label ?? meta.label;
  return (
    <Badge
      variant={meta.variant}
      className={cn("gap-1", className)}
      data-testid={testId ?? `badge-status-${key}`}
    >
      {showIcon && Icon && <Icon className={cn("h-3 w-3", key === "in_progress" && "animate-spin")} />}
      {text}
    </Badge>
  );
}
