import { CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subDays } from "date-fns";

export type PeriodPreset = "all_time" | "today" | "yesterday" | "this_month" | "last_1_month" | "last_6_months" | "this_year" | "custom";

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

  const handlePresetChange = (preset: PeriodPreset) => {
    if (preset === "custom") {
      const dates = getPresetDates("custom");
      onChange({ ...dates, preset: "custom" });
    } else {
      const dates = getPresetDates(preset);
      onChange({ ...dates, preset });
    }
  };

  const fromDateObj = value.fromDate ? new Date(value.fromDate + "T12:00:00") : undefined;
  const toDateObj = value.toDate ? new Date(value.toDate + "T12:00:00") : undefined;

  function buildLabel(): string {
    if (value.preset === "all_time") return "All Time";
    if (value.preset === "yesterday") return "Yesterday";
    if (value.preset === "custom") return "Custom Range";
    if (fromDateObj && toDateObj) {
      const from = formatDisplayDate(fromDateObj);
      const to = formatDisplayDate(toDateObj);
      if (from === to) return from;
      return `${from} – ${to}`;
    }
    if (fromDateObj) return formatDisplayDate(fromDateObj);
    return "Select period";
  }

  const displayLabel = buildLabel();
  const isCustom = value.preset === "custom";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            data-testid={testId || "period-filter-dropdown"}
          >
            <CalendarIcon className="h-4 w-4 shrink-0" />
            <span className="max-w-[200px] truncate">{displayLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={() => handlePresetChange("all_time")}
            data-testid="period-preset-all-time"
          >
            All Time
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handlePresetChange("today")}
            data-testid="period-preset-today"
          >
            Today
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handlePresetChange("yesterday")}
            data-testid="period-preset-yesterday"
          >
            Yesterday
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handlePresetChange("this_month")}
            data-testid="period-preset-this-month"
          >
            This Month
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handlePresetChange("last_1_month")}
            data-testid="period-preset-last-1-month"
          >
            Last 1 Month
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handlePresetChange("last_6_months")}
            data-testid="period-preset-last-6-months"
          >
            Last 6 Months
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handlePresetChange("this_year")}
            data-testid="period-preset-this-year"
          >
            This Year
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handlePresetChange("custom")}
            data-testid="period-preset-custom"
          >
            Custom Range...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isCustom && !hideCustomInputs && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={value.fromDate}
            data-testid="period-filter-from"
            onChange={(e) => onChange({ ...value, fromDate: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            value={value.toDate}
            data-testid="period-filter-to"
            onChange={(e) => onChange({ ...value, toDate: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}
    </div>
  );
}
