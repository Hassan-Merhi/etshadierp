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
  dismissLabel?: string;
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
 * Consistent inline feedback panel with tone-appropriate screen-reader
 * announcements and a keyboard-accessible dismiss action.
 */
export function AlertPanel({
  tone = "info",
  title,
  description,
  icon,
  actions,
  onDismiss,
  dismissLabel = "Dismiss notification",
  className,
  children,
  "data-testid": testId,
}: AlertPanelProps) {
  const presentation = TONE[tone];
  const Icon = icon ?? presentation.icon;
  const isUrgent = tone === "destructive";

  return (
    <div
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      aria-atomic="true"
      className={cn("flex items-start gap-3 rounded-md border p-3", presentation.wrap, className)}
      data-testid={testId ?? `alert-${tone}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className="text-sm font-semibold leading-tight">{title}</div>}
        {description && <div className="text-xs leading-relaxed opacity-90">{description}</div>}
        {children}
        {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
      </div>
      {onDismiss && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onDismiss}
          className="-mr-1 -mt-1 h-8 w-8 shrink-0 touch-manipulation"
          aria-label={dismissLabel}
          data-testid="button-alert-dismiss"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
