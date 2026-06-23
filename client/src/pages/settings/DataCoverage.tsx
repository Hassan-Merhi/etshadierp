import { CheckCircle2 } from "lucide-react";

export function DataCoverage() {
  const items = [
    "Summary overview",
    "Locations",
    "Ledger accounts",
    "Bank accounts",
    "Fixed assets",
    "All vouchers",
    "All voucher entries",
    "Suppliers + transactions",
    "Customers + transactions",
    "Employees + payrolls",
    "Salary advances",
    "Factory workers",
    "Factory payrolls",
    "Factory attendance",
    "Factory daybook",
    "Stock groups + items",
    "Inventory by location",
    "Stock transfers + revisions",
    "Stock adjustments",
    "Purchase orders + line items",
    "Containers + charges",
    "Container offloads",
    "Bales (sorting)",
    "Factory bales + products",
    "Factory containers",
    "Exchange rates",
    "POS shifts",
    "Sales items",
    "Full audit log",
  ];

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        What's included in each export
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs text-muted-foreground">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
