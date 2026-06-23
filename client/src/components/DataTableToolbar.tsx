import * as React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DataTableToolbarProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * DataTableToolbar — consistent search + filter + action bar above tables.
 * Replaces ad-hoc flex rows scattered across list pages.
 */
export function DataTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters,
  actions,
  className,
  "data-testid": testId,
}: DataTableToolbarProps) {
  const hasSearch = onSearchChange !== undefined;
  return (
    <div
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4", className)}
      data-testid={testId ?? "toolbar-data-table"}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
        {hasSearch && (
          <div className="relative w-full sm:w-72 max-w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8 pr-8"
              data-testid="input-search"
            />
            {search && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onSearchChange?.("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                data-testid="button-clear-search"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
        {filters && <div className="flex items-center gap-2 flex-wrap">{filters}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}
