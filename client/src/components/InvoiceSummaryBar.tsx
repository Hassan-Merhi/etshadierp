import { cn } from "@/lib/utils";

interface OrderLike {
  status: string;
  grandTotal: string;
  totalQtyBales: number;
  totalWeightKg: string;
}

interface Bucket {
  label: string;
  color: string;
  dotColor: string;
  orders: OrderLike[];
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function sum(orders: OrderLike[], field: "grandTotal" | "totalWeightKg") {
  return orders.reduce((s, o) => s + parseFloat(o[field] || "0"), 0);
}

function sumBales(orders: OrderLike[]) {
  return orders.reduce((s, o) => s + (o.totalQtyBales || 0), 0);
}

export function InvoiceSummaryBar({
  orders,
  hideTotalsUsd = false,
}: {
  orders: OrderLike[];
  hideTotalsUsd?: boolean;
}) {
  const buckets: Bucket[] = [
    {
      label: "Pending Verification",
      color: "text-yellow-700 dark:text-yellow-400",
      dotColor: "bg-yellow-400",
      orders: orders.filter(o => o.status === "PENDING_VERIFICATION"),
    },
    {
      label: "Verified",
      color: "text-green-700 dark:text-green-400",
      dotColor: "bg-green-500",
      orders: orders.filter(o => o.status === "VERIFIED"),
    },
    {
      label: "Loading",
      color: "text-blue-700 dark:text-blue-400",
      dotColor: "bg-blue-500",
      orders: orders.filter(o => o.status === "LOADING"),
    },
    {
      label: "Finalized",
      color: "text-foreground",
      dotColor: "bg-primary",
      orders: orders.filter(o => o.status === "FINALIZED"),
    },
    {
      label: "Draft",
      color: "text-muted-foreground",
      dotColor: "bg-muted-foreground",
      orders: orders.filter(o => o.status === "DRAFT"),
    },
  ].filter(b => b.orders.length > 0);

  if (buckets.length === 0) return null;

  const totalBales = sumBales(orders);
  const totalWeight = sum(orders, "totalWeightKg");
  const totalAmount = sum(orders, "grandTotal");

  return (
    <div className="rounded-md border bg-muted/40 p-3 mb-4 space-y-2" data-testid="invoice-summary-bar">
      {/* Overall total */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground border-b pb-2">
        <span className="font-semibold text-foreground text-sm">{orders.length} orders total</span>
        <span><span className="font-medium text-foreground">{totalBales.toLocaleString()}</span> bales</span>
        <span><span className="font-medium text-foreground">{fmt(totalWeight)}</span> kg</span>
        {!hideTotalsUsd && (
          <span><span className="font-medium text-foreground">${fmt(totalAmount)}</span></span>
        )}
      </div>
      {/* Per-status breakdown */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {buckets.map(b => {
          const bales = sumBales(b.orders);
          const weight = sum(b.orders, "totalWeightKg");
          const amount = sum(b.orders, "grandTotal");
          return (
            <div key={b.label} className="flex items-start gap-2 min-w-[180px]" data-testid={`summary-bucket-${b.label.replace(/\s/g, "-").toLowerCase()}`}>
              <span className={cn("mt-0.5 h-2.5 w-2.5 rounded-full shrink-0", b.dotColor)} />
              <div className="text-xs">
                <div className={cn("font-semibold leading-tight", b.color)}>
                  {b.label} <span className="font-normal text-muted-foreground">({b.orders.length})</span>
                </div>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                  <span><span className="font-medium text-foreground">{bales.toLocaleString()}</span> bales</span>
                  <span><span className="font-medium text-foreground">{fmt(weight)}</span> kg</span>
                  {!hideTotalsUsd && (
                    <span><span className="font-medium text-foreground">${fmt(amount)}</span></span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
