import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useErpText } from "@/i18n/modules/erp";

interface LocationInventoryHeaderProps {
  posUser?: any;
  showNegativeStock: boolean;
  setShowNegativeStock: (v: boolean) => void;
}

export function LocationInventoryHeader({
  posUser,
  showNegativeStock,
  setShowNegativeStock,
}: LocationInventoryHeaderProps) {
  const tUi = useErpText();
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
      <div>
        <h1 className="text-2xl font-bold">{tUi("location.inventory")}</h1>
        <p className="text-sm text-muted-foreground">{tUi("manage.inventory.across.all.locations")}</p>
      </div>
      {!posUser && (
        <Button
          variant={showNegativeStock ? "destructive" : "outline"}
          size="sm"
          className="gap-2"
          onClick={() => setShowNegativeStock(!showNegativeStock)}
          data-testid="button-negative-stock"
        >
          <AlertCircle className="h-4 w-4" /> Negative Stock
        </Button>
      )}
    </div>
  );
}
