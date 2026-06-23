import { useState, type ChangeEvent } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { cn } from "@/lib/utils";
import { format, parse, isValid } from "date-fns";

interface DatePickerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}

export function DatePickerInput({
  value,
  onChange,
  placeholder,
  className,
  "data-testid": testId,
}: DatePickerInputProps) {
  const { dateFormat, formatDisplayDate } = useDateFormat();
  const resolvedPlaceholder = placeholder ?? (dateFormat === "MM/DD/YYYY" ? "MM/DD/YYYY" : "DD/MM/YYYY");
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const dateValue = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
  const isValidDate = dateValue && !isNaN(dateValue.getTime());

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange(format(date, "yyyy-MM-dd"));
      setInputValue("");
      setOpen(false);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    setInputValue(rawValue);

    const formats =
      dateFormat === "DD/MM/YYYY"
        ? ["dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy"]
        : ["MM/dd/yyyy", "M/d/yyyy", "MM-dd-yyyy", "M-d-yyyy"];

    for (const fmt of formats) {
      try {
        const parsed = parse(rawValue, fmt, new Date());
        if (isValid(parsed) && parsed.getFullYear() > 1900 && parsed.getFullYear() < 2100) {
          onChange(format(parsed, "yyyy-MM-dd"));
          return;
        }
      } catch {}
    }
  };

  const handleInputBlur = () => {
    setInputValue("");
  };

  const displayValue = inputValue || (isValidDate ? formatDisplayDate(dateValue) : "");

  return (
    <div className={cn("flex gap-1", className)}>
      <Input
        type="text"
        value={displayValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        placeholder={resolvedPlaceholder}
        className="flex-1"
        data-testid={testId}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            data-testid={testId ? `${testId}-calendar` : undefined}
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar mode="single" selected={isValidDate ? dateValue : undefined} onSelect={handleSelect} initialFocus />
        </PopoverContent>
      </Popover>
    </div>
  );
}
