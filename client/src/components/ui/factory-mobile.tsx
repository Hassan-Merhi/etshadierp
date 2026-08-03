import * as React from "react";

import { cn } from "@/lib/utils";

const FactoryMobilePage = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <section
      ref={ref}
      data-factory-mobile-page="true"
      className={cn(
        "flex min-w-0 max-w-full flex-col gap-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:gap-5 sm:pb-0",
        className
      )}
      {...props}
    />
  )
);
FactoryMobilePage.displayName = "FactoryMobilePage";

const FactoryMobileHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-factory-mobile-header="true"
      className={cn("flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}
      {...props}
    />
  )
);
FactoryMobileHeader.displayName = "FactoryMobileHeader";

const FactoryMobileHeaderActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      aria-label="Factory page actions"
      data-factory-mobile-actions="true"
      className={cn(
        "grid w-full min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",
        className
      )}
      {...props}
    />
  )
);
FactoryMobileHeaderActions.displayName = "FactoryMobileHeaderActions";

const FactoryMobileWorkflowGrid = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-factory-mobile-workflow="true"
      className={cn("grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]", className)}
      {...props}
    />
  )
);
FactoryMobileWorkflowGrid.displayName = "FactoryMobileWorkflowGrid";

const FactoryMobileScannerPanel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-factory-mobile-scanner="true"
      className={cn("min-w-0 rounded-xl border bg-card p-3 shadow-sm sm:p-4", className)}
      {...props}
    />
  )
);
FactoryMobileScannerPanel.displayName = "FactoryMobileScannerPanel";

const FactoryMobileStatus = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-factory-mobile-status="true"
      className={cn("min-w-0 rounded-lg border px-3 py-2 text-sm leading-relaxed", className)}
      {...props}
    />
  )
);
FactoryMobileStatus.displayName = "FactoryMobileStatus";

const FactoryMobileActionBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      aria-label="Factory workflow actions"
      data-factory-mobile-action-bar="true"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid min-w-0 grid-cols-1 gap-2 border-t bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur min-[360px]:grid-cols-2 sm:static sm:flex sm:flex-wrap sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",
        className
      )}
      {...props}
    />
  )
);
FactoryMobileActionBar.displayName = "FactoryMobileActionBar";

export {
  FactoryMobileActionBar,
  FactoryMobileHeader,
  FactoryMobileHeaderActions,
  FactoryMobilePage,
  FactoryMobileScannerPanel,
  FactoryMobileStatus,
  FactoryMobileWorkflowGrid,
};
