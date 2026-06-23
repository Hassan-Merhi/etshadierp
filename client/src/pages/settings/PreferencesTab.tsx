import { Settings2, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { POSReceiptSettings } from "./POSReceiptSettings";

interface PreferencesTabProps {
  dateFormat: string;
  setDateFormat: (fmt: "MM/DD/YYYY" | "DD/MM/YYYY") => void;
  isDateFormatPending: boolean;
}

export function PreferencesTab({ dateFormat, setDateFormat, isDateFormatPending }: PreferencesTabProps) {
  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          Preferences
        </h2>
        <p className="text-muted-foreground text-sm mt-1">Customize your display and regional settings.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Date Format</CardTitle>
          <CardDescription>Choose how dates are displayed across the application.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["MM/DD/YYYY", "DD/MM/YYYY"] as const).map((fmt) => (
            <label
              key={fmt}
              className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${dateFormat === fmt ? "border-primary bg-primary/5" : "border-border hover-elevate"}`}
            >
              <input
                type="radio"
                name="dateFormat"
                value={fmt}
                checked={dateFormat === fmt}
                onChange={() => setDateFormat(fmt)}
                disabled={isDateFormatPending}
                className="accent-primary"
                data-testid={`radio-date-format-${fmt}`}
              />
              <div>
                <div className="font-medium text-sm">{fmt}</div>
                <div className="text-xs text-muted-foreground">
                  {fmt === "MM/DD/YYYY" ? "e.g. 12/31/2025 (US style)" : "e.g. 31/12/2025 (International style)"}
                </div>
              </div>
              {dateFormat === fmt && <Check className="h-4 w-4 text-primary ml-auto" />}
            </label>
          ))}
          {isDateFormatPending && <p className="text-xs text-muted-foreground">Saving…</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">POS Receipt Settings</CardTitle>
          <CardDescription>Configure how POS receipts are displayed and printed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <POSReceiptSettings />
        </CardContent>
      </Card>
    </div>
  );
}
