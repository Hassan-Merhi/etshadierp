import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: ReactNode;
  className?: string;
}

export function PageShell({ children, className }: PageShellProps) {
  return <main className={cn("space-y-6 p-3 sm:p-6", className)}>{children}</main>;
}

interface PageActionsProps {
  children: ReactNode;
  className?: string;
}

export function PageActions({ children, className }: PageActionsProps) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

interface FinancialReportHeaderProps {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function FinancialReportHeader({ title, children, className }: FinancialReportHeaderProps) {
  return (
    <div className={cn("bg-primary text-primary-foreground", className)}>
      <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm font-semibold">
        <span>{title}</span>
        {children}
      </div>
    </div>
  );
}

export const financialNumberClassName = "text-right font-mono tabular-nums";
