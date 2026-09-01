import * as React from "react";
import { Link } from "wouter";
import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface QuickActionCardProps {
  title: string;
  description?: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  tone?: "primary" | "success" | "warning" | "info" | "destructive";
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

const TONE: Record<NonNullable<QuickActionCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  destructive: "bg-destructive-soft text-destructive",
};

/**
 * QuickActionCard — compact action tile used on dashboards / module landings
 * to launch a common workflow (e.g. "New Sale", "Receive Stock").
 */
export function QuickActionCard({
  title,
  description,
  icon: Icon,
  href,
  onClick,
  tone = "primary",
  disabled,
  className,
  "data-testid": testId,
}: QuickActionCardProps) {
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const inner = (
    <Card
      className={cn(
        "p-4 flex items-start gap-3 h-full",
        !disabled && "hover-elevate active-elevate-2 cursor-pointer",
        disabled && "opacity-60 cursor-not-allowed",
        className
      )}
      onClick={disabled ? undefined : onClick}
      data-testid={testId ?? `card-action-${slug}`}
    >
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-md shrink-0", TONE[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-tight truncate">{title}</div>
        {description && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{description}</p>}
      </div>
    </Card>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}
