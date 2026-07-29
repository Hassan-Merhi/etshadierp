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
      className={cn("flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", className)}
      {...props}
    />
  );
}

export function WorkspaceToolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end",
        className,
      )}
      {...props}
    />
  );
}

export function WorkspaceToolbarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end", className)} {...props} />;
}

export function WorkspaceActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end",
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
        "sticky bottom-0 z-10 -mx-1 flex flex-col-reverse gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
