import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";

type DateFormatType = "MM/DD/YYYY" | "DD/MM/YYYY";

interface DateFormatContextType {
  dateFormat: DateFormatType;
  setDateFormat: (format: DateFormatType) => void;
  formatDisplayDate: (date: Date | string) => string;
  formatShortDate: (date: Date | string) => string;
  formatDisplayTime: (date: Date | string) => string;
  formatDisplayDateTime: (date: Date | string) => string;
  isLoading: boolean;
  isPending: boolean;
}

const DateFormatContext = createContext<DateFormatContextType | undefined>(undefined);

const getDateFnsFormat = (format: DateFormatType, style: "full" | "short" = "full"): string => {
  if (style === "short") {
    return format === "DD/MM/YYYY" ? "d/MMM/yy" : "MMM d, yy";
  }
  return format === "DD/MM/YYYY" ? "dd/MM/yyyy" : "MM/dd/yyyy";
};

const parseDateString = (dateStr: string): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) {
    return parseISO(dateStr);
  }
  return new Date(dateStr);
};

export function DateFormatProvider({ children }: { children: ReactNode }) {
  const [localFormat, setLocalFormat] = useState<DateFormatType>("MM/DD/YYYY");

  const { data: preferences, isLoading } = useQuery<{ dateFormat: DateFormatType }>({
    queryKey: ["/api/user-preferences"],
  });

  const updateMutation = useMutation({
    mutationFn: async (newFormat: DateFormatType) => {
      return apiRequest("PUT", "/api/user-preferences", { dateFormat: newFormat });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-preferences"] });
    },
  });

  useEffect(() => {
    if (preferences?.dateFormat) {
      setLocalFormat(preferences.dateFormat);
    }
  }, [preferences]);

  const setDateFormat = (format: DateFormatType) => {
    setLocalFormat(format);
    updateMutation.mutate(format);
  };

  const formatDisplayDate = (date: Date | string): string => {
    try {
      const dateObj = typeof date === "string" ? parseDateString(date) : date;
      if (isNaN(dateObj.getTime())) return String(date);
      return format(dateObj, getDateFnsFormat(localFormat, "full"));
    } catch {
      return String(date);
    }
  };

  const formatShortDate = (date: Date | string): string => {
    try {
      const dateObj = typeof date === "string" ? parseDateString(date) : date;
      if (isNaN(dateObj.getTime())) return String(date);
      return format(dateObj, getDateFnsFormat(localFormat, "short"));
    } catch {
      return String(date);
    }
  };

  const formatDisplayTime = (date: Date | string): string => {
    try {
      const dateObj = typeof date === "string" ? new Date(date) : date;
      if (isNaN(dateObj.getTime())) return "";
      return dateObj.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const formatDisplayDateTime = (date: Date | string): string => {
    return `${formatDisplayDate(date)}, ${formatDisplayTime(date)}`;
  };

  return (
    <DateFormatContext.Provider
      value={{
        dateFormat: localFormat,
        setDateFormat,
        formatDisplayDate,
        formatShortDate,
        formatDisplayTime,
        formatDisplayDateTime,
        isLoading,
        isPending: updateMutation.isPending,
      }}
    >
      {children}
    </DateFormatContext.Provider>
  );
}

export function useDateFormat() {
  const context = useContext(DateFormatContext);
  if (context === undefined) {
    throw new Error("useDateFormat must be used within a DateFormatProvider");
  }
  return context;
}
