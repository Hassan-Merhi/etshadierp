import * as React from "react";
import { cn } from "@/lib/utils";

type SkipLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>;

export function SkipLink({
  className,
  children = "Skip to main content",
  href = "#main-content",
  ...props
}: SkipLinkProps) {
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

type VisuallyHiddenProps = React.HTMLAttributes<HTMLSpanElement>;

export function VisuallyHidden({ className, ...props }: VisuallyHiddenProps) {
  return <span className={cn("sr-only", className)} {...props} />;
}

type LiveRegionProps = React.HTMLAttributes<HTMLDivElement> & {
  politeness?: "polite" | "assertive";
  atomic?: boolean;
};

export function LiveRegion({
  className,
  politeness = "polite",
  atomic = true,
  ...props
}: LiveRegionProps) {
  return (
    <div
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-atomic={atomic}
      className={cn("sr-only", className)}
      {...props}
    />
  );
}

type ResponsivePageProps = React.HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
};

export function ResponsivePage({
  className,
  compact = false,
  ...props
}: ResponsivePageProps) {
  return (
    <div
      data-responsive-page="true"
      className={cn(
        "mx-auto flex w-full min-w-0 max-w-full flex-col",
        compact ? "gap-3 sm:gap-4" : "gap-4 sm:gap-6",
        className,
      )}
      {...props}
    />
  );
}

type ResponsiveSectionProps = React.HTMLAttributes<HTMLElement> & {
  label?: string;
};

export function ResponsiveSection({
  className,
  label,
  ...props
}: ResponsiveSectionProps) {
  return (
    <section
      aria-label={label}
      className={cn("w-full min-w-0 max-w-full", className)}
      {...props}
    />
  );
}

type ResponsiveActionsProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
};

export function ResponsiveActions({
  className,
  label = "Page actions",
  ...props
}: ResponsiveActionsProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-10 sm:[&>*]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

type MobileActionBarProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
};

export function MobileActionBar({
  className,
  label = "Form actions",
  ...props
}: MobileActionBarProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "mobile-action-bar flex w-full flex-col-reverse gap-2 sm:static sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-10 sm:[&>*]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

type ResponsiveToolbarProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
};

export function ResponsiveToolbar({
  className,
  label = "Page filters and tools",
  ...props
}: ResponsiveToolbarProps) {
  return (
    <div
      role="search"
      aria-label={label}
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end [&>*]:min-w-0 [&_button]:touch-manipulation [&_input]:min-h-11 [&_select]:min-h-11 sm:[&_input]:min-h-10 sm:[&_select]:min-h-10",
        className,
      )}
      {...props}
    />
  );
}

type ResponsiveGridProps = React.HTMLAttributes<HTMLDivElement> & {
  minColumnWidth?: string;
};

export function ResponsiveGrid({
  className,
  minColumnWidth = "16rem",
  style,
  ...props
}: ResponsiveGridProps) {
  return (
    <div
      className={cn("grid min-w-0 gap-4", className)}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColumnWidth}), 1fr))`,
        ...style,
      }}
      {...props}
    />
  );
}

type ResponsiveFormGridProps = React.HTMLAttributes<HTMLDivElement> & {
  minColumnWidth?: string;
};

export function ResponsiveFormGrid({
  className,
  minColumnWidth = "18rem",
  style,
  ...props
}: ResponsiveFormGridProps) {
  return (
    <div
      data-responsive-form-grid="true"
      className={cn("grid w-full min-w-0 gap-4 [&>*]:min-w-0", className)}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColumnWidth}), 1fr))`,
        ...style,
      }}
      {...props}
    />
  );
}

type AccessibleRegionProps = React.HTMLAttributes<HTMLElement> & {
  label: string;
  as?: "section" | "nav" | "main" | "header";
};

export function AccessibleRegion({
  label,
  as: Comp = "section",
  className,
  ...props
}: AccessibleRegionProps) {
  return <Comp aria-label={label} className={className} {...props} />;
}

type HorizontalScrollRegionProps = React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  description?: string;
};

export function HorizontalScrollRegion({
  label,
  description = "Scroll horizontally to view additional columns.",
  className,
  tabIndex = 0,
  children,
  ...props
}: HorizontalScrollRegionProps) {
  const descriptionId = React.useId();

  return (
    <div
      role="region"
      aria-label={label}
      aria-describedby={descriptionId}
      tabIndex={tabIndex}
      data-horizontal-scroll="true"
      className={cn(
        "max-w-full touch-pan-x overflow-x-auto overscroll-x-contain rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    >
      <VisuallyHidden id={descriptionId}>{description}</VisuallyHidden>
      {children}
    </div>
  );
}
