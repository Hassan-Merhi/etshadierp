import { useState } from "react";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from "date-fns";

export type PeriodPreset = "all_time" | "today" | "this_month" | "last_1_month" | "last_6_months" | "this_year" | "custom";

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
  "data-testid"?: string;
}

const presetLabels: Record<PeriodPreset, string> = {
  all_time: "All Time",
  today: "Today",
  this_month: "This Month",
  last_1_month: "Last 1 Month",
  last_6_months: "Last 6 Months",
  this_year: "This Year",
  custom: "Custom Range",
};

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
    case "this_month":
      return {
        fromDate: formatDate(startOfMonth(today)),
        toDate: formatDate(endOfMonth(today)),
      };
    case "last_1_month":
      return {
        fromDate: formatDate(subMonths(today, 1)),
        toDate: formatDate(today),
      };
    case "last_6_months":
      return {
        fromDate: formatDate(subMonths(today, 6)),
        toDate: formatDate(today),
      };
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
  "data-testid": testId,
}: PeriodFilterProps) {
  const { formatDisplayDate } = useDateFormat();
  const [showFromCalendar, setShowFromCalendar] = useState(false);
  const [showToCalendar, setShowToCalendar] = useState(false);

  const handlePresetChange = (preset: PeriodPreset) => {
    if (preset === "custom") {
      onChange({ ...value, preset: "custom" });
    } else {
      const dates = getPresetDates(preset);
      onChange({ ...dates, preset });
    }
  };

  const handleFromDateChange = (date: Date | undefined) => {
    if (date) {
      onChange({
        ...value,
        fromDate: format(date, "yyyy-MM-dd"),
        preset: "custom",
      });
      setShowFromCalendar(false);
    }
  };

  const handleToDateChange = (date: Date | undefined) => {
    if (date) {
      onChange({
        ...value,
        toDate: format(date, "yyyy-MM-dd"),
        preset: "custom",
      });
      setShowToCalendar(false);
    }
  };

  const fromDateObj = value.fromDate ? new Date(value.fromDate) : undefined;
  const toDateObj = value.toDate ? new Date(value.toDate) : undefined;

  const displayLabel = value.preset === "custom"
    ? `${fromDateObj ? formatDisplayDate(fromDateObj) : ""} - ${toDateObj ? formatDisplayDate(toDateObj) : ""}`
    : presetLabels[value.preset];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            data-testid={testId || "period-filter-dropdown"}
          >
            <CalendarIcon className="h-4 w-4" />
            <span className="max-w-[180px] truncate">{displayLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
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

      {value.preset === "custom" && (
        <div className="flex items-center gap-1">
          <Popover open={showFromCalendar} onOpenChange={setShowFromCalendar}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-[110px] justify-start text-left font-normal"
                data-testid="period-from-date"
              >
                {fromDateObj ? formatDisplayDate(fromDateObj) : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={fromDateObj}
                onSelect={handleFromDateChange}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <span className="text-muted-foreground">-</span>
          <Popover open={showToCalendar} onOpenChange={setShowToCalendar}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-[110px] justify-start text-left font-normal"
                data-testid="period-to-date"
              >
                {toDateObj ? formatDisplayDate(toDateObj) : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={toDateObj}
                onSelect={handleToDateChange}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
