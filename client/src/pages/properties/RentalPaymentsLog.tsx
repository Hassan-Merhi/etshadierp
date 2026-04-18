import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Search } from "lucide-react";
import { format } from "date-fns";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMoney = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

type PaymentRow = {
  id: number;
  paymentDate: string;
  amount: string;
  forYear: number;
  forMonth: number;
  notes: string | null;
  contractId: number;
  unitId: number;
  tenantName: string | null;
  unitNumber: string | null;
  locationGroup: string | null;
};

interface Props {
  pageTitle: string;
  pageIcon?: React.ReactNode;
  testIdPrefix: string;
  apiBase?: string;
}

export default function RentalPaymentsLog({
  pageTitle,
  pageIcon,
  testIdPrefix,
  apiBase = "/api/properties/rental",
}: Props) {
  const { selectedCompany } = useCompany();
  const [search, setSearch] = useState("");

  const { data: payments = [], isLoading } = useQuery<PaymentRow[]>({
    queryKey: [apiBase + "/payments", selectedCompany?.id],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/payments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load payments");
      return res.json();
    },
    enabled: !!selectedCompany,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(p =>
      (p.tenantName ?? "").toLowerCase().includes(q) ||
      (p.unitNumber ?? "").toLowerCase().includes(q) ||
      (p.locationGroup ?? "").toLowerCase().includes(q) ||
      (p.notes ?? "").toLowerCase().includes(q)
    );
  }, [payments, search]);

  const total = filtered.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="p-4 space-y-4" data-testid={`page-${testIdPrefix}-payments-log`}>
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3">
          {pageIcon ?? <ClipboardList className="h-7 w-7 text-indigo-600" />}
          <div>
            <h1 className="text-xl font-bold">{pageTitle}</h1>
            <p className="text-xs text-muted-foreground">All payment receipts recorded across all units, sorted by date.</p>
          </div>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search tenant, unit, notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid={`input-${testIdPrefix}-payments-search`}
          />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL PAYMENTS</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid={`stat-${testIdPrefix}-total-payments`}>{filtered.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL AMOUNT RECEIVED</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid={`stat-${testIdPrefix}-total-amount`}>${fmtMoney(total)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">UNIQUE TENANTS</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set(filtered.map(p => p.tenantName).filter(Boolean)).size}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payments table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading payments…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {payments.length === 0 ? "No payments recorded yet." : "No payments match your search."}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Date</th>
                    <th className="text-left px-3 py-2 font-semibold">Client Name</th>
                    <th className="text-left px-3 py-2 font-semibold">Unit</th>
                    <th className="text-right px-3 py-2 font-semibold">Amount</th>
                    <th className="text-left px-3 py-2 font-semibold">For Month</th>
                    <th className="text-left px-3 py-2 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={p.id} className={`border-t ${i % 2 === 1 ? "bg-muted/20" : ""}`} data-testid={`row-payment-${p.id}`}>
                      <td className="px-3 py-2 tabular-nums text-sm">
                        {format(new Date(p.paymentDate), "dd MMM yyyy")}
                      </td>
                      <td className="px-3 py-2 font-medium">{p.tenantName ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{p.unitNumber ?? "—"}</span>
                        {p.locationGroup && (
                          <Badge variant="outline" className="ml-1.5 text-xs">{p.locationGroup}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-green-700 dark:text-green-400">
                        ${fmtMoney(p.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {MONTH_NAMES[p.forMonth]} {p.forYear}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.notes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 bg-muted/30">
                  <tr>
                    <td className="px-3 py-2 font-semibold" colSpan={3}>TOTAL</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-green-700 dark:text-green-400">
                      ${fmtMoney(total)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
