import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Package, FileText, Users, Clock, X, ChevronUp, ChevronDown } from "lucide-react";
import { AlertDigest } from "./chatWidgetTypes";

export function AlertsDigest({ onClose, onPrefill }: { onClose: () => void; onPrefill: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const { data: alerts, isLoading } = useQuery<AlertDigest>({
    queryKey: ["/api/chatbot/alerts"],
    staleTime: 5 * 60 * 1000,
  });

  const totalAlerts =
    (alerts?.lowStock.length ?? 0) +
    (alerts?.openPOs.length ?? 0) +
    (alerts?.overdueCustomers.length ?? 0) +
    (alerts?.pendingPayrolls.length ?? 0);

  if (!isLoading && totalAlerts === 0) return null;

  return (
    <div
      className="mx-3 mt-3 mb-1 rounded-md border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/30 text-sm overflow-hidden"
      data-testid="alerts-digest"
    >
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-amber-700 dark:text-amber-400 font-medium"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-toggle-alerts"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {isLoading ? "Loading alerts…" : `${totalAlerts} item${totalAlerts !== 1 ? "s" : ""} need attention`}
        </span>
        <span className="flex items-center gap-1">
          <button
            className="text-amber-500 hover:text-amber-700 p-0.5"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            data-testid="button-dismiss-alerts"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && !isLoading && alerts && (
        <div className="px-3 pb-3 space-y-2 border-t border-amber-500/20">
          {alerts.lowStock.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 mt-2 mb-1">
                <Package className="h-3 w-3" /> Low Stock ({alerts.lowStock.length})
              </p>
              <ul className="space-y-0.5">
                {alerts.lowStock.slice(0, 4).map((item) => (
                  <li key={item.id} className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span className="truncate">{item.name}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-amber-600 dark:text-amber-400">
                        {item.qty} / {item.reorderLevel}
                      </span>
                      <button
                        className="text-xs text-primary underline shrink-0"
                        onClick={() => onPrefill(`Record stock adjustment for "${item.name}" (code: ${item.code})`)}
                        data-testid={`alert-action-stock-adj-${item.id}`}
                        title="Record adjustment"
                      >
                        Adjust
                      </button>
                    </span>
                  </li>
                ))}
                {alerts.lowStock.length > 4 && (
                  <li className="text-xs text-muted-foreground italic">+{alerts.lowStock.length - 4} more</li>
                )}
              </ul>
            </div>
          )}

          {alerts.openPOs.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                <FileText className="h-3 w-3" /> Open POs ({alerts.openPOs.length})
              </p>
              <ul className="space-y-0.5">
                {alerts.openPOs.slice(0, 3).map((po) => (
                  <li key={po.id} className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span>{po.poNumber}</span>
                    <button
                      className="text-xs text-primary underline shrink-0"
                      onClick={() => onPrefill(`Show details for purchase order ${po.poNumber}`)}
                      data-testid={`alert-action-po-${po.id}`}
                    >
                      Details
                    </button>
                  </li>
                ))}
                {alerts.openPOs.length > 3 && (
                  <li className="text-xs text-muted-foreground italic">+{alerts.openPOs.length - 3} more</li>
                )}
              </ul>
            </div>
          )}

          {alerts.overdueCustomers.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                <Users className="h-3 w-3" /> Customer Receivables ({alerts.overdueCustomers.length})
              </p>
              <ul className="space-y-0.5">
                {alerts.overdueCustomers.slice(0, 3).map((c) => (
                  <li
                    key={c.customerId}
                    className="text-xs text-muted-foreground flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-amber-600 dark:text-amber-400">
                        ${c.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                      <button
                        className="text-xs text-primary underline"
                        onClick={() => onPrefill(`Record a payment receipt from customer "${c.name}"`)}
                        data-testid={`alert-action-customer-${c.customerId}`}
                      >
                        Receipt
                      </button>
                    </span>
                  </li>
                ))}
                {alerts.overdueCustomers.length > 3 && (
                  <li className="text-xs text-muted-foreground italic">+{alerts.overdueCustomers.length - 3} more</li>
                )}
              </ul>
            </div>
          )}

          {alerts.pendingPayrolls.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                <Clock className="h-3 w-3" /> Pending Payrolls ({alerts.pendingPayrolls.length})
              </p>
              <ul className="space-y-0.5">
                {alerts.pendingPayrolls.map((p) => (
                  <li key={p.id} className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span>
                      {p.periodStart} – {p.periodEnd}
                    </span>
                    <button
                      className="text-xs text-primary underline shrink-0"
                      onClick={() => onPrefill(`Show payroll summary for ${p.periodStart} to ${p.periodEnd}`)}
                      data-testid={`alert-action-payroll-${p.id}`}
                    >
                      Details
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
