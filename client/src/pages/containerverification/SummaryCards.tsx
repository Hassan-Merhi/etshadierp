/**
 * The compact summary strip of the container verification page: the same four
 * breakdowns as the detailed cards, reduced to a name and a single number so
 * the whole discrepancy fits on one screen.
 *
 * Every tile is the same shape — heading, scrolling name/value list, one
 * sticky total — so one tile is written once and each of the four supplies
 * the number it shows and the colour it shows it in.
 *
 * Extracted from ContainerVerification.tsx during the god-file split.
 */
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, DollarSign } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { ComparisonItem } from "./types";

const OVER = "text-red-600 dark:text-red-400";
const UNDER = "text-amber-600 dark:text-amber-400";
const EXTRA = "text-orange-600 dark:text-orange-400";

function signedTone(value: number) {
  return value > 0 ? OVER : "text-green-600 dark:text-green-400";
}

function sum(items: ComparisonItem[], pick: (item: ComparisonItem) => number) {
  return items.reduce((total, item) => total + pick(item), 0);
}

function SummaryCard({
  icon,
  title,
  valueHeading,
  items,
  valueText,
  valueTone,
  totalText,
  totalTone,
}: {
  icon: ReactNode;
  title: string;
  valueHeading: string;
  items: ComparisonItem[];
  valueText: (item: ComparisonItem) => string;
  valueTone: (item: ComparisonItem) => string;
  totalText: string;
  totalTone: string;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-xs">{title}</CardTitle>
        </div>
        <Badge variant="secondary">{items.length}</Badge>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">None</p>
        ) : (
          <>
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="text-xs py-1.5 px-3">Name</TableHead>
                    <TableHead className="text-xs text-right py-1.5 px-3">{valueHeading}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c) => (
                    <TableRow key={c.barcode}>
                      <TableCell className="text-xs py-1.5 px-3">{c.itemName}</TableCell>
                      <TableCell className={`text-right font-mono text-xs py-1.5 px-3 ${valueTone(c)}`}>
                        {valueText(c)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t bg-muted/50 px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold">
              <span>Total ({items.length})</span>
              <span className={`font-mono ${totalTone}`}>{totalText}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SummaryCards({
  overloaded,
  lessLoaded,
  notRequested,
  priceDiffs,
}: {
  overloaded: ComparisonItem[];
  lessLoaded: ComparisonItem[];
  notRequested: ComparisonItem[];
  priceDiffs: ComparisonItem[];
}) {
  const totalPriceDiff = sum(priceDiffs, (c) => c.totalPriceDiff);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
      <SummaryCard
        icon={<ArrowUpRight className="h-4 w-4 text-red-500" />}
        title="Overloaded"
        valueHeading="Excess"
        items={overloaded}
        valueText={(c) => `+${c.loadedQty - c.expectedQty}`}
        valueTone={() => OVER}
        totalText={`+${sum(overloaded, (c) => c.loadedQty - c.expectedQty)}`}
        totalTone={OVER}
      />
      <SummaryCard
        icon={<ArrowDownRight className="h-4 w-4 text-amber-500" />}
        title="Less Loaded"
        valueHeading="Short"
        items={lessLoaded}
        valueText={(c) => `-${c.expectedQty - c.loadedQty}`}
        valueTone={() => UNDER}
        totalText={`-${sum(lessLoaded, (c) => c.expectedQty - c.loadedQty)}`}
        totalTone={UNDER}
      />
      <SummaryCard
        icon={<AlertTriangle className="h-4 w-4 text-orange-500" />}
        title="Not Requested"
        valueHeading="Qty"
        items={notRequested}
        valueText={(c) => String(c.loadedQty)}
        valueTone={() => EXTRA}
        totalText={String(sum(notRequested, (c) => c.loadedQty))}
        totalTone={EXTRA}
      />
      <SummaryCard
        icon={<DollarSign className="h-4 w-4 text-blue-500" />}
        title="Price Diff"
        valueHeading="Diff/Bale"
        items={priceDiffs}
        valueText={(c) => `${c.priceDiffPerBale > 0 ? "+" : ""}${c.priceDiffPerBale.toFixed(2)}`}
        valueTone={(c) => signedTone(c.priceDiffPerBale)}
        totalText={`${totalPriceDiff > 0 ? "+" : ""}${totalPriceDiff.toFixed(2)}`}
        totalTone={signedTone(totalPriceDiff)}
      />
    </div>
  );
}
