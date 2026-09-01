import { Button } from "@/components/ui/button";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { DollarSign } from "lucide-react";

export function CurrencyToggle() {
  const { selectedCurrency, setCurrency, displayCurrency, exchangeRate } = useCurrencyContext();

  if (!displayCurrency) {
    return null;
  }

  const toggleCurrency = () => {
    setCurrency(selectedCurrency === "USD" ? "CFA" : "USD");
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleCurrency}
      className="font-mono text-xs"
      data-testid="button-currency-toggle"
      title={exchangeRate ? `Rate: $1 = ${exchangeRate.toLocaleString()} CFA` : "Set exchange rate in Settings"}
    >
      <DollarSign className="h-3 w-3 mr-1" />
      {selectedCurrency}
    </Button>
  );
}
