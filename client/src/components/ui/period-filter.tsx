import { useState } from "react";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { cn } from "@/lib/utils";
import {
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  subDays,
} from "date-fns";
import type { DateRange } from "react-day-picker";

export type PeriodPreset =
  | "all_time"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_1_month"
  | "last_6_months"
  | "this_year"
  | "custom";

export interface PeriodFilterValue {
  fromDate: string;
  toDate: string;
  preset: PeriodPreset;
}

interface PeriodFilterProps {
  value: PeriodFilterValue;
  onChange: (value: PeriodFilterValue) => void;
  defaultPreset?: PeriodPreset;
  className?: string;
  hideCustomInputs?: boolean;
  "data-testid"?: string;
}

function getPresetDates(preset: PeriodPreset): { fromDate: string; toDate: string } {
  const today = new Date();
  const formatDate = (d: Date) => format(d, "yyyy-MM-dd");

  switch (preset) {
    case "all_time":
      return { fromDate: "", toDate: "" };
    case "today":
      return {
        fromDate: formatDate(startOfDay(today)),
        toDate: formatDate(endOfDay(today)),
      };
    case "yesterday": {
      const yesterday = subDays(today, 1);
      return {
        fromDate: formatDate(startOfDay(yesterday)),
        toDate: formatDate(endOfDay(yesterday)),
      };
    }
    case "this_week":
      return {
        fromDate: formatDate(startOfWeek(today, { weekStartsOn: 1 })),
        toDate: formatDate(endOfWeek(today, { weekStartsOn: 1 })),
      };
    case "this_month":
      return {
        fromDate: formatDate(startOfMonth(today)),
        toDate: formatDate(endOfMonth(today)),
      };
    case "last_1_month": {
      const lastMonth = subMonths(today, 1);
      return {
        fromDate: formatDate(startOfMonth(lastMonth)),
        toDate: formatDate(endOfMonth(lastMonth)),
      };
    }
    case "last_6_months": {
      const sixMonthsAgo = subMonths(today, 6);
      const lastMonth = subMonths(today, 1);
      return {
        fromDate: formatDate(startOfMonth(sixMonthsAgo)),
        toDate: formatDate(endOfMonth(lastMonth)),
      };
    }
    case "this_year":
      return {
        fromDate: formatDate(startOfYear(today)),
        toDate: formatDate(endOfYear(today)),
      };
    case "custom":
    default:
      return {
        fromDate: formatDate(startOfMonth(today)),
        toDate: formatDate(endOfMonth(today)),
      };
  }
}

export function getDefaultPeriodValue(preset: PeriodPreset = "this_month"): PeriodFilterValue {
  const dates = getPresetDates(preset);
  return { ...dates, preset };
}

export function PeriodFilter({
  value,
  onChange,
  className,
  hideCustomInputs = false,
  "data-testid": testId,
}: PeriodFilterProps) {
  const { formatDisplayDate } = useDateFormat();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const fromDateObj = value.fromDate ? new Date(value.fromDate + "T12:00:00") : undefined;
  const toDateObj = value.toDate ? new Date(value.toDate + "T12:00:00") : undefined;

  const calendarRange: DateRange | undefined =
    fromDateObj || toDateObj ? { from: fromDateObj, to: toDateObj } : undefined;

  const handlePresetChange = (preset: PeriodPreset) => {
    if (preset === "custom") {
      // Defer until after the DropdownMenu close event finishes propagating,
      // otherwise the Dialog immediately dismisses from the same outside-click.
      setTimeout(() => setCalendarOpen(true), 0);
    } else {
      const dates = getPresetDates(preset);
      onChange({ ...dates, preset });
    }
  };

  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range) return;
    const formatDate = (d: Date) => format(d, "yyyy-MM-dd");
    const fromDate = range.from ? formatDate(range.from) : value.fromDate;
    const toDate = range.to ? formatDate(range.to) : "";
    onChange({ fromDate, toDate, preset: "custom" });
    if (range.from && range.to) {
      setCalendarOpen(false);
    }
  };

  function buildLabel(): string {
    if (value.preset === "all_time") return "All Time";
    if (value.preset === "yesterday") return "Yesterday";
    if (value.preset === "this_week") return "This Week";
    if (fromDateObj && toDateObj) {
      const from = formatDisplayDate(fromDateObj);
      const to = formatDisplayDate(toDateObj);
      if (from === to) return from;
      return `${from} – ${to}`;
    }
    if (fromDateObj) return formatDisplayDate(fromDateObj);
    if (value.preset === "custom") return "Custom Range";
    return "Select period";
  }

  const displayLabel = buildLabel();

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1" data-testid={testId || "period-filter-dropdown"}>
            <CalendarIcon className="h-4 w-4 shrink-0" />
            <span className="max-w-[200px] truncate">{displayLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => handlePresetChange("all_time")} data-testid="period-preset-all-time">
            All Time
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handlePresetChange("today")} data-testid="period-preset-today">
            Today
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handlePresetChange("yesterday")} data-testid="period-preset-yesterday">
            Yesterday
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handlePresetChange("this_week")} data-testid="period-preset-this-week">
            This Week
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handlePresetChange("this_month")} data-testid="period-preset-this-month">
            This Month
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handlePresetChange("last_1_month")} data-testid="period-preset-last-1-month">
            Last 1 Month
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handlePresetChange("last_6_months")}
            data-testid="period-preset-last-6-months"
          >
            Last 6 Months
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handlePresetChange("this_year")} data-testid="period-preset-this-year">
            This Year
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handlePresetChange("custom")} data-testid="period-preset-custom">
            Custom Range...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Calendar dialog for custom range */}
      {!hideCustomInputs && (
        <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
          <DialogContent className="w-auto max-w-[95vw] p-0">
            <DialogHeader className="p-3 border-b">
              <DialogTitle className="text-sm font-medium">Select date range</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Click a start date, then an end date</p>
            </DialogHeader>
            <Calendar
              mode="range"
              selected={calendarRange}
              onSelect={handleRangeSelect}
              numberOfMonths={2}
              defaultMonth={fromDateObj ?? new Date()}
            />
            {calendarRange?.from && !calendarRange?.to && (
              <div className="p-3 border-t text-xs text-muted-foreground text-center">
                Now click an end date
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
