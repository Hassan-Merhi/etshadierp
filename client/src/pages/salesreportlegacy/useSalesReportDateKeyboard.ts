import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import { addDays, format } from "date-fns";
import { hasAnyOpenDialog } from "@/hooks/use-escape-back";
import type { PeriodFilterValue } from "@/components/ui/period-filter";

export function useSalesReportDateKeyboard(setPeriodFilter: Dispatch<SetStateAction<PeriodFilterValue>>) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "textarea") return;
      if (tag === "input") {
        const inputType = (target as HTMLInputElement).type || "text";
        if (["text", "number", "email", "password", "search", "tel", "url"].includes(inputType)) return;
      }
      if (tag === "select" || hasAnyOpenDialog()) return;

      const isBack = event.key === "-" || event.code === "Minus";
      const isForward =
        (event.key === "+" && event.shiftKey) || (event.code === "Equal" && event.shiftKey) || event.key === "=";
      if (!isBack && !isForward) return;

      event.preventDefault();
      const delta = isBack ? -1 : 1;
      setPeriodFilter((previous) => ({
        fromDate: format(addDays(new Date(previous.fromDate), delta), "yyyy-MM-dd"),
        toDate: format(addDays(new Date(previous.toDate), delta), "yyyy-MM-dd"),
        preset: "custom",
      }));
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [setPeriodFilter]);
}
