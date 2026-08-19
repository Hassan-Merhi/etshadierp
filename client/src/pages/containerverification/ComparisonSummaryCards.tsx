import { AlertTriangle, ArrowDownRight, ArrowUpRight, DollarSign, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ComparisonItem } from "./types";
import type { ContainerVerificationModel } from "./useContainerVerificationModel";

function SummaryCard({ icon: Icon, title, items, metric, total, className = "" }: {
  icon: LucideIcon;
  title: string;
  items: ComparisonItem[];
  metric: (item: ComparisonItem) => string;
  total: () => string;
  className?: string;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2"><Icon className={`h-4 w-4 ${className}`} /><CardTitle className="text-xs">{title}</CardTitle></div>
        <Badge variant="secondary">{items.length}</Badge>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {items.length === 0 ? <p className="text-xs text-muted-foreground text-center py-3">None</p> : (
          <div className="max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background"><TableRow><TableHead className="text-xs py-1.5 px-3">Name</TableHead><TableHead className="text-xs text-right py-1.5 px-3">Value</TableHead></TableRow></TableHeader>
              <TableBody>{items.map((item) => <TableRow key={item.barcode}><TableCell className="text-xs py-1.5 px-3">{item.itemName}</TableCell><TableCell className={`text-right font-mono text-xs py-1.5 px-3 ${className}`}>{metric(item)}</TableCell></TableRow>)}</TableBody>
            </Table>
          </div>
        )}
        {items.length > 0 && <div className="border-t bg-muted/50 px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold"><span>Total ({items.length})</span><span className={`font-mono ${className}`}>{total()}</span></div>}
      </CardContent>
    </Card>
  );
}

export function ComparisonSummaryCards({ model }: { model: ContainerVerificationModel }) {
  const priceTotal = model.priceDiffs.reduce((sum, item) => sum + item.totalPriceDiff, 0);
  const priceClass = priceTotal > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400";
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
      <SummaryCard icon={ArrowUpRight} title="Overloaded" items={model.overloaded} className="text-red-600 dark:text-red-400" metric={(item) => `+${item.loadedQty - item.expectedQty}`} total={() => `+${model.overloaded.reduce((sum, item) => sum + item.loadedQty - item.expectedQty, 0)}`} />
      <SummaryCard icon={ArrowDownRight} title="Less Loaded" items={model.lessLoaded} className="text-amber-600 dark:text-amber-400" metric={(item) => `-${item.expectedQty - item.loadedQty}`} total={() => `-${model.lessLoaded.reduce((sum, item) => sum + item.expectedQty - item.loadedQty, 0)}`} />
      <SummaryCard icon={AlertTriangle} title="Not Requested" items={model.notRequested} className="text-orange-600 dark:text-orange-400" metric={(item) => String(item.loadedQty)} total={() => String(model.notRequested.reduce((sum, item) => sum + item.loadedQty, 0))} />
      <SummaryCard icon={DollarSign} title="Price Diff" items={model.priceDiffs} className={priceClass} metric={(item) => `${item.priceDiffPerBale > 0 ? "+" : ""}${item.priceDiffPerBale.toFixed(2)}`} total={() => `${priceTotal > 0 ? "+" : ""}${priceTotal.toFixed(2)}`} />
    </div>
  );
}
