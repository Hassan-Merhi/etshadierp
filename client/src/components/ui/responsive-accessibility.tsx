import * as React from "react";
import { cn } from "@/lib/utils";

type SkipLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>;

export function SkipLink({ className, children = "Skip to main content", href = "#main-content", ...props }: SkipLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        "sr-only z-50 rounded-md bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg transition focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

type ResponsiveActionsProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
};

export function ResponsiveActions({ className, label = "Page actions", ...props }: ResponsiveActionsProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

type ResponsiveToolbarProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
};

export function ResponsiveToolbar({ className, label = "Page filters and tools", ...props }: ResponsiveToolbarProps) {
  return (
    <div
      role="search"
      aria-label={label}
      className={cn(
        "flex w-full flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end [&>*]:min-w-0",
        className,
      )}
      {...props}
    />
  );
}

type ResponsiveGridProps = React.HTMLAttributes<HTMLDivElement> & {
  minColumnWidth?: string;
};

export function ResponsiveGrid({ className, minColumnWidth = "16rem", style, ...props }: ResponsiveGridProps) {
  return (
    <div
      className={cn("grid gap-4", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColumnWidth}), 1fr))`, ...style }}
      {...props}
    />
  );
}

type AccessibleRegionProps = React.HTMLAttributes<HTMLElement> & {
  label: string;
  as?: "section" | "nav" | "main" | "header";
};

export function AccessibleRegion({ label, as: Comp = "section", className, ...props }: AccessibleRegionProps) {
  return <Comp aria-label={label} className={className} {...props} />;
}

type HorizontalScrollRegionProps = React.HTMLAttributes<HTMLDivElement> & {
  label: string;
};

export function HorizontalScrollRegion({ label, className, tabIndex = 0, ...props }: HorizontalScrollRegionProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={tabIndex}
      className={cn(
        "max-w-full overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    />
  );
}
