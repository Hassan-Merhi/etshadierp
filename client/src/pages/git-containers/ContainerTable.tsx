import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EnrichedContainerRow, OtwColId, fmtDate } from "./gitContainerTypes";
import {
  EtaCell,
  InlineTextCell,
  InlineDateCell,
  InlineNumberCell,
  InlineTransporterCell,
  InlineBoolCell,
} from "./InlineCells";
import { cn } from "@/lib/utils";

interface ContainerTableProps {
  containers: EnrichedContainerRow[];
  colVis: Record<OtwColId, boolean>;
  sessionCompanyId: number | null;
  onOpenDrawer: (c: EnrichedContainerRow) => void;
  printRef: React.RefObject<HTMLDivElement>;
}

export function ContainerTable({ containers, colVis, sessionCompanyId, onOpenDrawer, printRef }: ContainerTableProps) {
  return (
    <div className="rounded-md border bg-card overflow-hidden h-full flex flex-col shadow-sm">
      <div className="flex-1 overflow-auto custom-scrollbar relative">
        <div ref={printRef}>
          <Table className="text-xs border-collapse">
            <TableHeader className="sticky top-0 z-10 bg-primary/10 dark:bg-primary/15">
              <TableRow className="hover:bg-transparent border-b border-primary/20">
                <TableHead className="w-[110px] font-bold h-9">Container #</TableHead>
                {colVis.supplier && <TableHead className="w-[100px] font-bold h-9">Supplier</TableHead>}
                {colVis.company && <TableHead className="w-[120px] font-bold h-9">Company</TableHead>}
                {colVis.shopName && <TableHead className="w-[100px] font-bold h-9">Shop Name</TableHead>}
                {colVis.eta && <TableHead className="w-[100px] font-bold h-9">ETA DAS</TableHead>}
                {colVis.cost && <TableHead className="w-[85px] font-bold text-right h-9">Cost ($)</TableHead>}
                {colVis.freight && <TableHead className="w-[70px] font-bold text-center h-9">Freight</TableHead>}
                {colVis.truckNo && <TableHead className="w-[100px] font-bold h-9">Truck #</TableHead>}
                {colVis.location && <TableHead className="w-[110px] font-bold h-9">Location</TableHead>}
                {colVis.borderDate && <TableHead className="w-[100px] font-bold h-9">Border Date</TableHead>}
                {colVis.maxOffload && <TableHead className="w-[100px] font-bold h-9">Max Offload</TableHead>}
                {colVis.delayed && <TableHead className="w-[70px] font-bold text-center h-9">Delayed</TableHead>}
                {colVis.docs && <TableHead className="w-[50px] font-bold text-center h-9">Docs</TableHead>}
                {colVis.docsSent && <TableHead className="w-[100px] font-bold h-9">Docs Sent</TableHead>}
                {colVis.transporter && <TableHead className="w-[110px] font-bold h-9">Transporter</TableHead>}
                {colVis.transportFee && <TableHead className="w-[90px] font-bold text-right h-9">Trans. Fee</TableHead>}
                {colVis.agent && <TableHead className="w-[90px] font-bold h-9">Agent</TableHead>}
                {colVis.dutyFee && <TableHead className="w-[80px] font-bold text-right h-9">Duty ($)</TableHead>}
                {colVis.notes && <TableHead className="w-[120px] font-bold h-9">Notes</TableHead>}
                {colVis.blDocs && <TableHead className="w-[120px] font-bold h-9">BL Docs</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {containers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={24} className="h-32 text-center text-muted-foreground italic">
                    No active containers found matching filters.
                  </TableCell>
                </TableRow>
              ) : (
                containers.map((c) => {
                  const freight = parseFloat(c.poFreight ?? "0");
                  const canEditRow = sessionCompanyId === null || c.companyId === sessionCompanyId;

                  const transUpper = (c.transporter ?? "").toUpperCase();
                  const transDays = transUpper.includes("FARHAT") || transUpper.includes("CONTINENTAL") ? 11 : 14;
                  const maxOffDate = c.borderDate
                    ? (() => {
                        const d = new Date(c.borderDate);
                        d.setDate(d.getDate() + transDays);
                        return d.toISOString().slice(0, 10);
                      })()
                    : null;

                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer group hover:bg-muted/50 transition-colors border-b last:border-0"
                      onClick={() => onOpenDrawer(c)}
                      data-testid={`row-container-${c.id}`}
                    >
                      <TableCell className="font-mono font-bold text-[11px] h-10">
                        <span className="group-hover:text-primary transition-colors">{c.containerNumber}</span>
                      </TableCell>
                      {colVis.supplier && (
                        <TableCell className="text-muted-foreground h-10">
                          <span className="truncate block max-w-[90px]" title={c.supplierName ?? ""}>
                            {c.supplierCode || "—"}
                          </span>
                        </TableCell>
                      )}
                      {colVis.company && (
                        <TableCell className="font-medium h-10">
                          <span className="truncate block max-w-[110px]" title={c.companyName}>
                            {c.companyName}
                          </span>
                        </TableCell>
                      )}
                      {colVis.shopName && (
                        <TableCell className="h-10">
                          <span className="truncate block max-w-[90px]" title={c.shopName ?? ""}>
                            {canEditRow ? (
                              <InlineTextCell id={c.id} field="shopName" value={c.shopName} width="90px" />
                            ) : (
                              c.shopName || "—"
                            )}
                          </span>
                        </TableCell>
                      )}
                      {colVis.eta && (
                        <TableCell className="h-10">
                          {canEditRow ? <EtaCell container={c} /> : fmtDate(c.eta)}
                        </TableCell>
                      )}
                      {colVis.cost && (
                        <TableCell className="text-right font-mono text-muted-foreground h-10">
                          {c.grandTotal ? `$${Number(c.grandTotal).toLocaleString()}` : "—"}
                        </TableCell>
                      )}
                      {colVis.freight && (
                        <TableCell className="text-right font-mono text-muted-foreground h-10">
                          {freight > 0 ? `$${freight.toLocaleString()}` : "—"}
                        </TableCell>
                      )}
                      {colVis.truckNo && (
                        <TableCell className="font-mono text-primary font-medium h-10">
                          {canEditRow ? (
                            <InlineTextCell
                              id={c.id}
                              field="numberPlate"
                              value={c.numberPlate}
                              width="90px"
                              uppercase
                            />
                          ) : (
                            c.numberPlate || "—"
                          )}
                        </TableCell>
                      )}
                      {colVis.location && (
                        <TableCell className="h-10">
                          <span className="truncate block max-w-[100px]" title={c.trackingLocation ?? ""}>
                            {canEditRow ? (
                              <InlineTextCell
                                id={c.id}
                                field="trackingLocation"
                                value={c.trackingLocation}
                                width="100px"
                              />
                            ) : (
                              c.trackingLocation || "—"
                            )}
                          </span>
                        </TableCell>
                      )}
                      {colVis.borderDate && (
                        <TableCell className="h-10">
                          {canEditRow ? (
                            <InlineDateCell id={c.id} field="borderDate" value={c.borderDate} />
                          ) : (
                            fmtDate(c.borderDate)
                          )}
                        </TableCell>
                      )}
                      {colVis.maxOffload && (
                        <TableCell className="h-10 font-medium">
                          {maxOffDate ? (
                            <span className={cn(c.isOverdue && "text-red-600")}>{fmtDate(maxOffDate)}</span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      )}
                      {colVis.delayed && (
                        <TableCell className="text-center h-10">
                          {c.daysDelayed && c.daysDelayed > 0 ? (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-md font-bold">
                              {c.daysDelayed}d
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      )}
                      {colVis.docs && (
                        <TableCell className="h-10">
                          <div className="flex justify-center">
                            {canEditRow ? (
                              <InlineBoolCell id={c.id} field="docReceived" value={c.docReceived} />
                            ) : c.docReceived ? (
                              "✅"
                            ) : (
                              "❌"
                            )}
                          </div>
                        </TableCell>
                      )}
                      {colVis.docsSent && (
                        <TableCell className="h-10">
                          {canEditRow ? (
                            <InlineDateCell id={c.id} field="docsSentDate" value={c.docsSentDate} />
                          ) : (
                            fmtDate(c.docsSentDate)
                          )}
                        </TableCell>
                      )}
                      {colVis.transporter && (
                        <TableCell className="h-10">
                          {canEditRow ? (
                            <InlineTransporterCell id={c.id} value={c.transporter} />
                          ) : (
                            c.transporter || "—"
                          )}
                        </TableCell>
                      )}
                      {colVis.transportFee && (
                        <TableCell className="text-right h-10">
                          {canEditRow ? (
                            <InlineNumberCell id={c.id} field="transportFee" value={c.transportFee} width="70px" />
                          ) : c.transportFee ? (
                            `$${Number(c.transportFee).toLocaleString()}`
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      )}
                      {colVis.agent && (
                        <TableCell className="h-10">
                          {canEditRow ? (
                            <InlineTextCell id={c.id} field="agent" value={c.agent} width="80px" />
                          ) : (
                            c.agent || "—"
                          )}
                        </TableCell>
                      )}
                      {colVis.dutyFee && (
                        <TableCell className="text-right h-10">
                          {canEditRow ? (
                            <InlineNumberCell id={c.id} field="dutyFee" value={c.dutyFee} width="70px" />
                          ) : c.dutyFee ? (
                            `$${Number(c.dutyFee).toLocaleString()}`
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      )}
                      {colVis.notes && (
                        <TableCell className="h-10">
                          <span className="truncate block max-w-[110px]" title={c.trackingDescription ?? ""}>
                            {canEditRow ? (
                              <InlineTextCell
                                id={c.id}
                                field="trackingDescription"
                                value={c.trackingDescription}
                                width="110px"
                              />
                            ) : (
                              c.trackingDescription || "—"
                            )}
                          </span>
                        </TableCell>
                      )}
                      {colVis.blDocs && (
                        <TableCell className="h-10">
                          <span className="truncate block max-w-[110px]" title={c.blDocs ?? ""}>
                            {canEditRow ? (
                              <InlineTextCell id={c.id} field="blDocs" value={c.blDocs} width="110px" />
                            ) : (
                              c.blDocs || "—"
                            )}
                          </span>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
