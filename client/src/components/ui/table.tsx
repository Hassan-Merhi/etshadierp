import * as React from "react";

import { cn } from "@/lib/utils";

type TableProps = React.TableHTMLAttributes<HTMLTableElement> & {
  wrapperClassName?: string;
  scrollLabel?: string;
  scrollDescription?: string;
  minimumWidth?: string;
};

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  (
    {
      className,
      wrapperClassName,
      scrollLabel = "Scrollable data table",
      scrollDescription = "Scroll horizontally to view additional columns.",
      minimumWidth,
      style,
      ...props
    },
    ref
  ) => {
    const descriptionId = React.useId();

    return (
      <div
        role="region"
        aria-label={scrollLabel}
        aria-describedby={descriptionId}
        tabIndex={0}
        data-horizontal-scroll="true"
        data-table-scroll-region="true"
        className={cn(
          "relative max-w-full touch-pan-x overflow-x-auto overscroll-x-contain rounded-md border border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-slate-600",
          wrapperClassName
        )}
      >
        <span id={descriptionId} className="sr-only">
          {scrollDescription}
        </span>
        <table
          ref={ref}
          data-responsive-table="true"
          className={cn("w-full min-w-full caption-bottom border-collapse text-sm tabular-nums", className)}
          style={{ minWidth: minimumWidth, ...style }}
          {...props}
        />
      </div>
    );
  }
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn(
        "sticky top-0 z-30 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80 [&_tr]:border-b [&_tr]:border-slate-300 dark:[&_tr]:border-slate-600",
        className
      )}
      {...props}
    />
  )
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-b-0", className)} {...props} />
  )
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn(
        "border-t border-slate-300 bg-muted/50 font-medium [&>tr]:last:border-b-0 dark:border-slate-600",
        className
      )}
      {...props}
    />
  )
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-slate-300 transition-colors odd:bg-background even:bg-muted/20 hover:bg-primary/5 data-[state=selected]:bg-muted dark:border-slate-600",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-10 whitespace-nowrap border-r border-slate-300 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground last:border-r-0 dark:border-slate-600 sm:h-8 sm:px-2 sm:text-[10px] [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "min-w-0 break-words border-r border-slate-300 px-3 py-2 text-xs align-middle last:border-r-0 dark:border-slate-600 sm:px-2 sm:py-1 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  )
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
