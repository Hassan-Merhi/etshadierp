/**
 * The four detailed comparison cards on the container verification page:
 * overloaded, less loaded / missing, not requested and price differences.
 *
 * Split out of ContainerVerification.tsx unchanged — same columns, same
 * colouring, same totals row per card and the same "None" empty state.
 */
import { AlertTriangle, ArrowDownRight, ArrowUpRight, DollarSign } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ComparisonItem } from "./types";
import type { ContainerVerificationModel } from "./useContainerVerificationModel";

const OVER = "text-red-600 dark:text-red-400";
const SHORT = "text-amber-600 dark:text-amber-400";
const EXTRA = "text-orange-600 dark:text-orange-400";
const GAIN = "text-green-600 dark:text-green-400";

function signedClass(value: number): string {
  return value > 0 ? OVER : GAIN;
}

function ComparisonCard({
  icon: Icon,
  iconClass,
  title,
  items,
  headers,
  children,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  items: ComparisonItem[];
  headers: string[];
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconClass}`} />
          <CardTitle className="text-sm">
            {title} ({items.length})
          </CardTitle>
        </div>
        <Badge variant="secondary">{items.length}</Badge>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">None</p>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  {headers.map((h, i) => (
                    <TableHead key={h} className={i === 0 ? undefined : "text-right"}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>{children}</TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ItemCell({ item }: { item: ComparisonItem }) {
  return (
    <TableCell>
      <div className="text-xs font-medium">{item.itemName}</div>
      <div className="text-xs text-muted-foreground font-mono">{item.barcode}</div>
    </TableCell>
  );
}

function OverloadedCard({ items }: { items: ComparisonItem[] }) {
  return (
    <ComparisonCard
      icon={ArrowUpRight}
      iconClass="text-red-500"
      title="Overloaded"
      items={items}
      headers={["Item", "Expected", "Loaded", "Excess"]}
    >
      {items.map((c) => (
        <TableRow key={c.barcode}>
          <ItemCell item={c} />
          <TableCell className="text-right font-mono text-xs">{c.expectedQty}</TableCell>
          <TableCell className={`text-right font-mono text-xs ${OVER}`}>{c.loadedQty}</TableCell>
          <TableCell className={`text-right font-mono text-xs ${OVER}`}>+{c.loadedQty - c.expectedQty}</TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/50 font-bold">
        <TableCell className="text-xs font-bold">Total ({items.length} items)</TableCell>
        <TableCell className="text-right font-mono text-xs font-bold">
          {items.reduce((s, c) => s + c.expectedQty, 0)}
        </TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${OVER}`}>
          {items.reduce((s, c) => s + c.loadedQty, 0)}
        </TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${OVER}`}>
          +{items.reduce((s, c) => s + (c.loadedQty - c.expectedQty), 0)}
        </TableCell>
      </TableRow>
    </ComparisonCard>
  );
}

function LessLoadedCard({ items }: { items: ComparisonItem[] }) {
  return (
    <ComparisonCard
      icon={ArrowDownRight}
      iconClass="text-amber-500"
      title="Less Loaded / Missing"
      items={items}
      headers={["Item", "Expected", "Loaded", "Short"]}
    >
      {items.map((c) => (
        <TableRow key={c.barcode}>
          <ItemCell item={c} />
          <TableCell className="text-right font-mono text-xs">{c.expectedQty}</TableCell>
          <TableCell className={`text-right font-mono text-xs ${SHORT}`}>{c.loadedQty}</TableCell>
          <TableCell className={`text-right font-mono text-xs ${SHORT}`}>-{c.expectedQty - c.loadedQty}</TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/50 font-bold">
        <TableCell className="text-xs font-bold">Total ({items.length} items)</TableCell>
        <TableCell className="text-right font-mono text-xs font-bold">
          {items.reduce((s, c) => s + c.expectedQty, 0)}
        </TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${SHORT}`}>
          {items.reduce((s, c) => s + c.loadedQty, 0)}
        </TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${SHORT}`}>
          -{items.reduce((s, c) => s + (c.expectedQty - c.loadedQty), 0)}
        </TableCell>
      </TableRow>
    </ComparisonCard>
  );
}

function NotRequestedCard({ items }: { items: ComparisonItem[] }) {
  return (
    <ComparisonCard
      icon={AlertTriangle}
      iconClass="text-orange-500"
      title="Not Requested"
      items={items}
      headers={["Item", "Loaded Qty", "Total Weight", "Total Value"]}
    >
      {items.map((c) => (
        <TableRow key={c.barcode}>
          <ItemCell item={c} />
          <TableCell className={`text-right font-mono text-xs ${EXTRA}`}>{c.loadedQty}</TableCell>
          <TableCell className="text-right font-mono text-xs">{c.loadedWeightTotal.toFixed(3)}</TableCell>
          <TableCell className="text-right font-mono text-xs">{c.loadedTotalValue.toFixed(2)}</TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/50 font-bold">
        <TableCell className="text-xs font-bold">Total ({items.length} items)</TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${EXTRA}`}>
          {items.reduce((s, c) => s + c.loadedQty, 0)}
        </TableCell>
        <TableCell className="text-right font-mono text-xs font-bold">
          {items.reduce((s, c) => s + c.loadedWeightTotal, 0).toFixed(3)}
        </TableCell>
        <TableCell className="text-right font-mono text-xs font-bold">
          {items.reduce((s, c) => s + c.loadedTotalValue, 0).toFixed(2)}
        </TableCell>
      </TableRow>
    </ComparisonCard>
  );
}

function PriceDiffCard({ items }: { items: ComparisonItem[] }) {
  const totalDiff = items.reduce((s, c) => s + c.totalPriceDiff, 0);
  return (
    <ComparisonCard
      icon={DollarSign}
      iconClass="text-blue-500"
      title="Price Differences"
      items={items}
      headers={["Item", "Proforma", "Loaded", "Diff/Bale", "Total Diff"]}
    >
      {items.map((c) => (
        <TableRow key={c.barcode}>
          <ItemCell item={c} />
          <TableCell className="text-right font-mono text-xs">{c.expectedPricePerBale.toFixed(2)}</TableCell>
          <TableCell className="text-right font-mono text-xs">{c.loadedPricePerBale.toFixed(2)}</TableCell>
          <TableCell className={`text-right font-mono text-xs ${signedClass(c.priceDiffPerBale)}`}>
            {c.priceDiffPerBale > 0 ? "+" : ""}
            {c.priceDiffPerBale.toFixed(2)}
          </TableCell>
          <TableCell className={`text-right font-mono text-xs ${signedClass(c.totalPriceDiff)}`}>
            {c.totalPriceDiff > 0 ? "+" : ""}
            {c.totalPriceDiff.toFixed(2)}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/50 font-bold">
        <TableCell className="text-xs font-bold">Total ({items.length} items)</TableCell>
        <TableCell></TableCell>
        <TableCell></TableCell>
        <TableCell></TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${signedClass(totalDiff)}`}>
          {totalDiff > 0 ? "+" : ""}
          {totalDiff.toFixed(2)}
        </TableCell>
      </TableRow>
    </ComparisonCard>
  );
}

export function ComparisonCards({ model }: { model: ContainerVerificationModel }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <OverloadedCard items={model.overloaded} />
      <LessLoadedCard items={model.lessLoaded} />
      <NotRequestedCard items={model.notRequested} />
      <PriceDiffCard items={model.priceDiffs} />
    </div>
  );
}
