import React from "react";
import { Link } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Container } from "@shared/schema";
import { OtwEditableCell } from "./OtwEditableCell";
import { OtwFreightCell } from "./OtwFreightCell";
import { OtwContainerActions } from "./OtwContainerActions";

interface OtwContainerRowProps {
  container: Container;
  getSupplierName: (id: number) => string;
  formatAmount: (n: number) => string;
  freightStatusMap: Record<number, { totalFreight: number; totalPaid: number; status: string }>;
  getEditValue: (container: Container, field: keyof Container) => any;
  setEditValue: (id: number, field: keyof Container, value: any) => Promise<void>;
  hasChanges: (id: number) => boolean;
  saveTracking: (id: number) => Promise<void>;
  savingIds: Set<number>;
  handleKeyDown: (e: React.KeyboardEvent, id: number, fieldIdx: number) => void;
  autoSizeStyle: (value: unknown, placeholder?: string, minCh?: number, maxCh?: number) => React.CSSProperties;
}

export function OtwContainerRow({
  container,
  getSupplierName,
  formatAmount,
  freightStatusMap,
  getEditValue,
  setEditValue,
  hasChanges,
  saveTracking,
  savingIds,
  handleKeyDown,
  autoSizeStyle,
}: OtwContainerRowProps) {
  const shared = { container, getEditValue, setEditValue, handleKeyDown, autoSizeStyle };
  return (
    <TableRow data-testid={`row-otw-${container.id}`}>
      <TableCell className="font-mono font-medium">
        <Link href={`/containers/${container.id}`} className="text-primary hover:underline">
          {container.containerNumber}
        </Link>
      </TableCell>
      <TableCell className="text-sm">{getSupplierName(container.supplierId)}</TableCell>
      <TableCell className="font-mono text-sm">
        {formatAmount(parseFloat(container.grandTotal || "0"))}
      </TableCell>

      <OtwEditableCell {...shared} field="shopName" fieldIndex={0} placeholder="Shop" minCh={6} maxCh={16} testId={`input-shop-${container.id}`} />
      <OtwEditableCell {...shared} field="eta" fieldIndex={1} type="date" placeholder="yyyy-mm-dd" minCh={12} maxCh={12} testId={`input-eta-${container.id}`} />
      <OtwEditableCell {...shared} field="transporter" fieldIndex={2} placeholder="Transporter" minCh={12} maxCh={40} testId={`input-transporter-${container.id}`} />
      <OtwEditableCell {...shared} field="transportFee" fieldIndex={3} type="number" placeholder="0.00" testId={`input-transport-${container.id}`} />
      <OtwEditableCell {...shared} field="numberPlate" fieldIndex={4} placeholder="Plate" minCh={10} maxCh={20} testId={`input-plate-${container.id}`} />
      <OtwEditableCell {...shared} field="trackingLocation" fieldIndex={5} placeholder="Location" minCh={12} maxCh={40} testId={`input-location-${container.id}`} />
      <OtwEditableCell {...shared} field="borderDate" fieldIndex={6} type="date" placeholder="yyyy-mm-dd" minCh={12} maxCh={12} testId={`input-border-${container.id}`} />
      <OtwEditableCell {...shared} field="offloadDate" fieldIndex={7} type="date" placeholder="yyyy-mm-dd" minCh={12} maxCh={12} testId={`input-offload-${container.id}`} />
      <OtwEditableCell {...shared} field="agent" fieldIndex={8} placeholder="Agent" testId={`input-agent-${container.id}`} />
      <OtwEditableCell {...shared} field="dutyFee" fieldIndex={9} type="number" placeholder="0.00" testId={`input-duty-${container.id}`} />

      <TableCell className="text-center">
        <Checkbox
          id={`tracking-${container.id}-docReceived`}
          checked={!!getEditValue(container, "docReceived")}
          onCheckedChange={(checked) => setEditValue(container.id, "docReceived", !!checked)}
          data-testid={`checkbox-doc-${container.id}`}
        />
      </TableCell>

      <OtwFreightCell containerId={container.id} freightStatusMap={freightStatusMap} />

      <OtwEditableCell {...shared} field="trackingDescription" fieldIndex={11} placeholder="Notes..." minCh={10} maxCh={32} testId={`input-desc-${container.id}`} />
      <OtwEditableCell {...shared} field="docsSentDate" fieldIndex={12} type="date" placeholder="yyyy-mm-dd" minCh={12} maxCh={12} testId={`input-docs-sent-${container.id}`} />

      <TableCell>
        <select
          id={`tracking-${container.id}-freightStatus`}
          value={(getEditValue(container, "freightStatus") as string) || ""}
          onChange={(e) => setEditValue(container.id, "freightStatus", e.target.value || null)}
          className="h-8 text-sm rounded-md border border-input bg-background px-2 py-1"
          data-testid={`select-freight-git-${container.id}`}
        >
          <option value="">—</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="Pending">Pending</option>
        </select>
      </TableCell>

      <OtwEditableCell {...shared} field="trackingLink" fieldIndex={13} placeholder="https://..." minCh={12} maxCh={32} testId={`input-link-${container.id}`} />

      <OtwContainerActions
        containerId={container.id}
        hasChanges={hasChanges}
        saveTracking={saveTracking}
        savingIds={savingIds}
      />
    </TableRow>
  );
}
