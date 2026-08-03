import * as React from "react";

import { cn } from "@/lib/utils";

export function WorkspacePage({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 space-y-5 sm:space-y-6", className)} {...props} />;
}

export function WorkspaceSection({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("min-w-0 space-y-3", className)} {...props} />;
}

export function WorkspaceSectionHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
        className,
      )}
      {...props}
    />
  );
}

export function WorkspaceToolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-2",
        "[&_[data-radix-select-trigger]]:w-full sm:[&_[data-radix-select-trigger]]:w-auto",
        "[&_input]:min-w-0 [&_input]:w-full sm:[&_input]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

export function WorkspaceToolbarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end",
        "[&>*]:min-w-0",
        className,
      )}
      {...props}
    />
  );
}

export function WorkspaceActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid w-full min-w-0 grid-cols-1 gap-2 xs:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end",
        "[&>*]:min-w-0 [&_button]:w-full sm:[&_button]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

export function ResponsiveTableFrame({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border bg-card [scrollbar-gutter:stable]",
        className,
      )}
      tabIndex={0}
      role="region"
      aria-label="Scrollable data table"
      {...props}
    />
  );
}

export function FormActionBar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-1 grid grid-cols-1 gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 xs:grid-cols-2 sm:flex sm:justify-end",
        "[&_button]:w-full sm:[&_button]:w-auto",
        className,
      )}
      {...props}
    />
  );
}
