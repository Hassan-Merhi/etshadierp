import { useState, useMemo } from "react";
import { formatNumber } from "@/lib/formatNumber";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layers, Pencil, Trash2, MessageCircle, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

interface MixBatchRow {
  id: number;
  batchCode: string;
  name: string | null;
  totalWeightKg: string;
  usedKg: string;
  remainingKg: string;
  costPerKg: string;
  totalCost: string;
  status: string;
  operatorUser: string | null;
  batchDate: string | null;
  carryForwardFromId: number | null;
  createdAt: string;
}

interface MixBatchListProps {
  mixBatches: MixBatchRow[];
  isLoading: boolean;
  onEdit: (batch: MixBatchRow) => void;
  onDelete: (id: number) => void;
  onViewDetail: (batch: MixBatchRow) => void;
  onSendWhatsApp: () => void;
  isSendingWhatsApp: boolean;
  mixBatchDate: string;
  setMixBatchDate: (date: string) => void;
  mixBatchesByDate: any[];
  mixBatchesByDateLoading: boolean;
  mixBatchPrintRef: React.RefObject<HTMLDivElement>;
  formatDisplayDate: (date: string) => string;
}

export function MixBatchList({
  mixBatches,
  isLoading,
  onEdit,
  onDelete,
  onViewDetail,
  onSendWhatsApp,
  isSendingWhatsApp,
  mixBatchDate,
  setMixBatchDate,
  mixBatchesByDate,
  mixBatchesByDateLoading,
  mixBatchPrintRef,
  formatDisplayDate,
}: MixBatchListProps) {
  const [showAllMixBatches, setShowAllMixBatches] = useState(false);
  const BATCH_PREVIEW_COUNT = 15;

  const visibleMixBatches = useMemo(
    () => (showAllMixBatches ? mixBatches : mixBatches.slice(0, BATCH_PREVIEW_COUNT)),
    [mixBatches, showAllMixBatches]
  );

  const fmtKg = (n: number) => formatNumber(n, 3);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 flex-wrap">
        <div className="space-y-1">
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="h-4.5 w-4.5 text-amber-500" />
            Recent Mix Batches
          </CardTitle>
          <p className="text-xs text-muted-foreground">Historical list of blends and their cost origins</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg border border-border/50">
            <input
              type="date"
              value={mixBatchDate}
              onChange={(e) => setMixBatchDate(e.target.value)}
              className="bg-transparent border-none text-sm font-medium focus:ring-0 px-2 py-1 outline-none"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={onSendWhatsApp}
              disabled={isSendingWhatsApp || mixBatchesByDate.length === 0}
              data-testid="button-send-mix-batch-whatsapp"
              className="h-8 gap-2"
            >
              {isSendingWhatsApp ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageCircle className="h-3.5 w-3.5" />
              )}
              Send WhatsApp
            </Button>
          </div>
        </div>

        {/* Hidden printable card — screenshotted by html2canvas */}
        <div
          ref={mixBatchPrintRef}
          style={{
            position: "fixed",
            top: "-9999px",
            left: "-9999px",
            width: "680px",
            backgroundColor: "#111827",
            color: "#f9fafb",
            padding: "24px",
            fontFamily: "Inter, system-ui, sans-serif",
            borderRadius: "12px",
            zIndex: -1,
          }}
        >
          <div style={{ marginBottom: "16px", borderBottom: "1px solid #374151", paddingBottom: "12px" }}>
            <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "4px" }}>
              {new Date(mixBatchDate + "T00:00:00").toLocaleDateString("en-US", {
                month: "2-digit",
                day: "2-digit",
                year: "numeric",
              })}
            </div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#f9fafb" }}>Mix Batch Details</div>
          </div>

          {mixBatchesByDate.map((batch: any) => (
            <div key={batch.id} style={{ marginBottom: "20px" }}>
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}
              >
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "monospace", color: "#f9fafb" }}>
                    {batch.batchCode}
                  </div>
                  {batch.name && (
                    <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>{batch.name}</div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: "999px",
                    backgroundColor: batch.status === "COMPLETED" ? "#166534" : "#374151",
                    color: batch.status === "COMPLETED" ? "#bbf7d0" : "#d1d5db",
                    border: "1px solid " + (batch.status === "COMPLETED" ? "#16a34a" : "#4b5563"),
                  }}
                >
                  {batch.status}
                </span>
              </div>

              <div style={{ display: "flex", gap: "16px", marginBottom: "14px" }}>
                {[
                  { label: "Total Weight", value: formatNumber(batch.totalWeightKg) + " kg" },
                  { label: "Total Cost", value: "$" + formatNumber(batch.totalCost) },
                  { label: "Cost/kg", value: "$" + (parseFloat(batch.costPerKg) || 0).toFixed(2) },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    style={{ flex: 1, backgroundColor: "#1f2937", borderRadius: "8px", padding: "10px 14px" }}
                  >
                    <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "4px" }}>{stat.label}</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, fontFamily: "monospace", color: "#f9fafb" }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>

              {batch.sources?.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#1f2937" }}>
                      {["SOURCE", "CONTAINER", "WEIGHT", "$/KG", "TOTAL"].map((h, i) => (
                        <th
                          key={h}
                          style={{
                            padding: "8px 10px",
                            textAlign: i > 1 ? "right" : "left",
                            color: "#6b7280",
                            fontWeight: 600,
                            fontSize: "10px",
                            borderBottom: "1px solid #374151",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {batch.sources.map((src: any, idx: number) => (
                      <tr key={src.id} style={{ backgroundColor: idx % 2 === 0 ? "transparent" : "#1a2332" }}>
                        <td style={{ padding: "7px 10px", color: "#f9fafb", fontWeight: 500 }}>{src.sourceName}</td>
                        <td
                          style={{ padding: "7px 10px", color: "#9ca3af", fontFamily: "monospace", fontSize: "11px" }}
                        >
                          {src.containerNumber || "—"}
                        </td>
                        <td
                          style={{ padding: "7px 10px", color: "#f9fafb", textAlign: "right", fontFamily: "monospace" }}
                        >
                          {formatNumber(src.weightKg)} kg
                        </td>
                        <td
                          style={{ padding: "7px 10px", color: "#f9fafb", textAlign: "right", fontFamily: "monospace" }}
                        >
                          ${(parseFloat(src.costPerKg) || 0).toFixed(2)}
                        </td>
                        <td
                          style={{ padding: "7px 10px", color: "#f9fafb", textAlign: "right", fontFamily: "monospace" }}
                        >
                          ${formatNumber(src.totalCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          <div
            style={{
              marginTop: "16px",
              borderTop: "1px solid #374151",
              paddingTop: "10px",
              fontSize: "10px",
              color: "#6b7280",
              textAlign: "right",
            }}
          >
            Generated {new Date().toLocaleString()}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : mixBatches.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-40">Batch Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="min-w-32 whitespace-nowrap">Date</TableHead>
                  <TableHead className="min-w-32 text-right whitespace-nowrap">Total (kg)</TableHead>
                  <TableHead className="min-w-36 text-right whitespace-nowrap">Blended Cost</TableHead>
                  <TableHead className="min-w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleMixBatches.map((batch) => {
                  const total = parseFloat(batch.totalWeightKg) || 0;
                  return (
                    <TableRow key={batch.id} data-testid={`row-mix-batch-${batch.id}`}>
                      <TableCell
                        className="font-mono font-medium text-sm cursor-pointer hover:underline text-primary"
                        onClick={() => onViewDetail(batch)}
                        data-testid={`link-mix-batch-detail-${batch.id}`}
                      >
                        {batch.batchCode}
                      </TableCell>
                      <TableCell className="text-sm cursor-pointer hover:underline" onClick={() => onViewDetail(batch)}>
                        {batch.name || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {batch.batchDate ? formatDisplayDate(batch.batchDate) : formatDisplayDate(batch.createdAt)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatNumber(total)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        ${parseFloat(batch.costPerKg || "0").toFixed(4)}/kg
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => onEdit(batch)}
                            data-testid={`button-edit-mix-batch-${batch.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => onDelete(batch.id)}
                            data-testid={`button-delete-mix-batch-${batch.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {mixBatches.length > BATCH_PREVIEW_COUNT && (
                <tbody>
                  <tr>
                    <td colSpan={6} className="py-2 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllMixBatches(!showAllMixBatches)}
                        data-testid="button-toggle-show-all-batches"
                        className="text-xs text-muted-foreground"
                      >
                        {showAllMixBatches
                          ? `Show less`
                          : `Show all ${mixBatches.length} batches (${mixBatches.length - BATCH_PREVIEW_COUNT} hidden)`}
                      </Button>
                    </td>
                  </tr>
                </tbody>
              )}
              {(() => {
                const sumTotal = mixBatches.reduce((s, b) => s + (parseFloat(b.totalWeightKg) || 0), 0);
                const sumUsed = mixBatches.reduce((s, b) => s + (parseFloat(b.usedKg) || 0), 0);
                const sumRemaining = mixBatches.reduce((s, b) => s + (parseFloat(b.remainingKg) || 0), 0);
                const weightedCost = mixBatches.reduce(
                  (s, b) => s + (parseFloat(b.totalWeightKg) || 0) * (parseFloat(b.costPerKg) || 0),
                  0
                );
                const blendedCost = sumTotal > 0 ? weightedCost / sumTotal : 0;
                return (
                  <tfoot className="border-t-2 border-border bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={3} className="px-4 py-3 text-sm font-semibold text-foreground">
                        Combined Total
                        <div className="text-xs text-muted-foreground font-normal">
                          {mixBatches.length} batch{mixBatches.length !== 1 ? "es" : ""}
                        </div>
                      </TableCell>
                      <TableCell
                        className="px-4 py-3 text-right font-mono font-semibold text-sm"
                        data-testid="text-mix-summary-total"
                      >
                        {fmtKg(sumTotal)}
                      </TableCell>
                      <TableCell
                        className="px-4 py-3 text-right font-mono font-semibold text-sm"
                        data-testid="text-mix-summary-used"
                      >
                        {fmtKg(sumUsed)}
                      </TableCell>
                      <TableCell
                        className="px-4 py-3 text-right font-mono font-semibold text-sm"
                        data-testid="text-mix-summary-remaining"
                      >
                        {fmtKg(sumRemaining)}
                      </TableCell>
                      <TableCell
                        className="px-4 py-3 text-right font-mono font-semibold text-sm"
                        data-testid="text-mix-summary-cost"
                      >
                        ${blendedCost.toFixed(4)}/kg
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </tfoot>
                );
              })()}
            </Table>
          </div>
        ) : (
          <div className="text-center py-10">
            <Layers className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">No mix batches</h3>
            <p className="text-muted-foreground text-sm mt-1">No mix batches yet. Create one to get started.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
