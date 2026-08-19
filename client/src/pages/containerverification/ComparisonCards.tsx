/**
 * The detailed breakdown of a container verification: the alias-conflict
 * warning that qualifies the whole comparison, and the four cards that split
 * it into the four things a buyer acts on — too much sent, too little sent,
 * something sent that was never ordered, and a price that moved.
 *
 * All four cards are the same object with different columns, so the card
 * shell is shared and each card contributes only its own rows and totals.
 * They read nothing but the rows handed to them.
 *
 * Extracted from ContainerVerification.tsx during the god-file split.
 */
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, DollarSign } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { AliasConflict, ComparisonItem } from "./types";

const OVER = "text-red-600 dark:text-red-400";
const UNDER = "text-amber-600 dark:text-amber-400";
const EXTRA = "text-orange-600 dark:text-orange-400";

/** Red when the difference costs money, green when it saves it. */
function signedTone(value: number) {
  return value > 0 ? OVER : "text-green-600 dark:text-green-400";
}

function signed(value: number, digits: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function sum(items: ComparisonItem[], pick: (item: ComparisonItem) => number) {
  return items.reduce((total, item) => total + pick(item), 0);
}

function ItemCell({ item }: { item: ComparisonItem }) {
  return (
    <TableCell>
      <div className="text-xs font-medium">{item.itemName}</div>
      <div className="text-xs text-muted-foreground font-mono">{item.barcode}</div>
    </TableCell>
  );
}

function BreakdownCard({
  icon,
  title,
  count,
  headings,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  headings: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-sm">
            {title} ({count})
          </CardTitle>
        </div>
        <Badge variant="secondary">{count}</Badge>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">None</p>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>{headings}</TableRow>
              </TableHeader>
              <TableBody>{children}</TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AliasConflictAlert({ conflicts }: { conflicts: AliasConflict[] }) {
  if (conflicts.length === 0) return null;

  return (
    <div
      className="mb-4 rounded-md border border-orange-500/50 bg-orange-500/10 p-3"
      data-testid="alert-alias-conflicts"
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
        <span className="text-sm font-medium text-orange-700 dark:text-orange-400">
          {conflicts.length} barcode alias conflict{conflicts.length > 1 ? "s" : ""} detected — comparison below skipped
          these and may be incomplete
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        A barcode is registered as an alias for one item, but that exact barcode is also the item's own primary code for
        a different stock item. This can cause proforma and loaded quantities to be matched to the wrong item. Fix the
        alias in Stock Item Aliases before trusting this report.
      </p>
      <ul className="text-xs font-mono space-y-1">
        {conflicts.map((c, i) => (
          <li key={i}>
            "{c.aliasCode}" is aliased to {c.aliasedToName} ({c.aliasedToCode}), but is also the primary code of{" "}
            {c.ownerName} ({c.ownerCode})
          </li>
        ))}
      </ul>
    </div>
  );
}

function OverloadedCard({ items }: { items: ComparisonItem[] }) {
  return (
    <BreakdownCard
      icon={<ArrowUpRight className="h-4 w-4 text-red-500" />}
      title="Overloaded"
      count={items.length}
      headings={
        <>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Expected</TableHead>
          <TableHead className="text-right">Loaded</TableHead>
          <TableHead className="text-right">Excess</TableHead>
        </>
      }
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
        <TableCell className="text-right font-mono text-xs font-bold">{sum(items, (c) => c.expectedQty)}</TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${OVER}`}>
          {sum(items, (c) => c.loadedQty)}
        </TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${OVER}`}>
          +{sum(items, (c) => c.loadedQty - c.expectedQty)}
        </TableCell>
      </TableRow>
    </BreakdownCard>
  );
}

function LessLoadedCard({ items }: { items: ComparisonItem[] }) {
  return (
    <BreakdownCard
      icon={<ArrowDownRight className="h-4 w-4 text-amber-500" />}
      title="Less Loaded / Missing"
      count={items.length}
      headings={
        <>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Expected</TableHead>
          <TableHead className="text-right">Loaded</TableHead>
          <TableHead className="text-right">Short</TableHead>
        </>
      }
    >
      {items.map((c) => (
        <TableRow key={c.barcode}>
          <ItemCell item={c} />
          <TableCell className="text-right font-mono text-xs">{c.expectedQty}</TableCell>
          <TableCell className={`text-right font-mono text-xs ${UNDER}`}>{c.loadedQty}</TableCell>
          <TableCell className={`text-right font-mono text-xs ${UNDER}`}>-{c.expectedQty - c.loadedQty}</TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/50 font-bold">
        <TableCell className="text-xs font-bold">Total ({items.length} items)</TableCell>
        <TableCell className="text-right font-mono text-xs font-bold">{sum(items, (c) => c.expectedQty)}</TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${UNDER}`}>
          {sum(items, (c) => c.loadedQty)}
        </TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${UNDER}`}>
          -{sum(items, (c) => c.expectedQty - c.loadedQty)}
        </TableCell>
      </TableRow>
    </BreakdownCard>
  );
}

function NotRequestedCard({ items }: { items: ComparisonItem[] }) {
  return (
    <BreakdownCard
      icon={<AlertTriangle className="h-4 w-4 text-orange-500" />}
      title="Not Requested"
      count={items.length}
      headings={
        <>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Loaded Qty</TableHead>
          <TableHead className="text-right">Total Weight</TableHead>
          <TableHead className="text-right">Total Value</TableHead>
        </>
      }
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
          {sum(items, (c) => c.loadedQty)}
        </TableCell>
        <TableCell className="text-right font-mono text-xs font-bold">
          {sum(items, (c) => c.loadedWeightTotal).toFixed(3)}
        </TableCell>
        <TableCell className="text-right font-mono text-xs font-bold">
          {sum(items, (c) => c.loadedTotalValue).toFixed(2)}
        </TableCell>
      </TableRow>
    </BreakdownCard>
  );
}

function PriceDiffCard({ items }: { items: ComparisonItem[] }) {
  const totalDiff = sum(items, (c) => c.totalPriceDiff);

  return (
    <BreakdownCard
      icon={<DollarSign className="h-4 w-4 text-blue-500" />}
      title="Price Differences"
      count={items.length}
      headings={
        <>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Proforma</TableHead>
          <TableHead className="text-right">Loaded</TableHead>
          <TableHead className="text-right">Diff/Bale</TableHead>
          <TableHead className="text-right">Total Diff</TableHead>
        </>
      }
    >
      {items.map((c) => (
        <TableRow key={c.barcode}>
          <ItemCell item={c} />
          <TableCell className="text-right font-mono text-xs">{c.expectedPricePerBale.toFixed(2)}</TableCell>
          <TableCell className="text-right font-mono text-xs">{c.loadedPricePerBale.toFixed(2)}</TableCell>
          <TableCell className={`text-right font-mono text-xs ${signedTone(c.priceDiffPerBale)}`}>
            {signed(c.priceDiffPerBale, 2)}
          </TableCell>
          <TableCell className={`text-right font-mono text-xs ${signedTone(c.totalPriceDiff)}`}>
            {signed(c.totalPriceDiff, 2)}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/50 font-bold">
        <TableCell className="text-xs font-bold">Total ({items.length} items)</TableCell>
        <TableCell></TableCell>
        <TableCell></TableCell>
        <TableCell></TableCell>
        <TableCell className={`text-right font-mono text-xs font-bold ${signedTone(totalDiff)}`}>
          {signed(totalDiff, 2)}
        </TableCell>
      </TableRow>
    </BreakdownCard>
  );
}

export function ComparisonCards({
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
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <OverloadedCard items={overloaded} />
      <LessLoadedCard items={lessLoaded} />
      <NotRequestedCard items={notRequested} />
      <PriceDiffCard items={priceDiffs} />
    </div>
  );
}
