import { Calendar, CheckCircle2, DollarSign, Users } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface PayrollSummaryTotals {
  netSalary: number;
  baseSalary: number;
  productionBonus: number;
  pendingProductionBonus: number;
  otherBonuses: number;
}

interface PayrollSummaryCardsProps {
  recordCount: number;
  totals: PayrollSummaryTotals;
}

export function PayrollSummaryCards({ recordCount, totals }: PayrollSummaryCardsProps) {
  const cards = [
    { label: "Records", value: String(recordCount), Icon: Users },
    { label: "Total Net Salary", value: `$${totals.netSalary.toFixed(2)}`, Icon: DollarSign },
    { label: "Total Base", value: `$${totals.baseSalary.toFixed(2)}`, Icon: DollarSign },
    { label: "Production Bonus", value: `$${totals.productionBonus.toFixed(2)}`, Icon: CheckCircle2 },
    { label: "Pending Bonus", value: `$${totals.pendingProductionBonus.toFixed(2)}`, Icon: Calendar },
    { label: "Other Bonus", value: `$${totals.otherBonuses.toFixed(2)}`, Icon: DollarSign },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {cards.map(({ label, value, Icon }) => (
        <Card key={label}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{label}</p>
            </div>
            <p className="mt-1 font-mono text-xl font-bold">{value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
