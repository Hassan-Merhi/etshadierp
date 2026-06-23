import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AlertTone = "info" | "success" | "warning" | "destructive";

export interface AlertPanelProps {
  tone?: AlertTone;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
  children?: React.ReactNode;
  "data-testid"?: string;
}

const TONE: Record<AlertTone, { wrap: string; icon: LucideIcon }> = {
  info: { wrap: "border-info/30 bg-info-soft text-info-soft-foreground", icon: Info },
  success: { wrap: "border-success/30 bg-success-soft text-success-soft-foreground", icon: CheckCircle2 },
  warning: { wrap: "border-warning/30 bg-warning-soft text-warning-soft-foreground", icon: AlertTriangle },
  destructive: {
    wrap: "border-destructive/30 bg-destructive-soft text-destructive-soft-foreground",
    icon: AlertCircle,
  },
};

/**
 * AlertPanel — inline informational/warning panel. Replaces ad-hoc colored
 * divs ("draft restored", "needs approval", "offline mode") with one
 * consistent component.
 */
export function AlertPanel({
  tone = "info",
  title,
  description,
  icon,
  actions,
  onDismiss,
  className,
  children,
  "data-testid": testId,
}: AlertPanelProps) {
  const t = TONE[tone];
  const Icon = icon ?? t.icon;
  return (
    <div
      role="alert"
      className={cn("rounded-md border p-3 flex items-start gap-3", t.wrap, className)}
      data-testid={testId ?? `alert-${tone}`}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className="text-sm font-semibold leading-tight">{title}</div>}
        {description && <div className="text-xs leading-relaxed opacity-90">{description}</div>}
        {children}
        {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
      </div>
      {onDismiss && (
        <Button
          size="icon"
          variant="ghost"
          onClick={onDismiss}
          className="h-6 w-6 -mt-1 -mr-1 shrink-0"
          aria-label="Dismiss"
          data-testid="button-alert-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
