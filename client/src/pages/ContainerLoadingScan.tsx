/**
 * ERP container loading scan page shell.
 *
 * Keeps its route and default export. The order lifecycle, scanner and
 * proforma comparison live in ./containerloadingscan/useContainerLoadingScanModel;
 * the bale card, controls panel and dialogs are separate views in the same
 * folder. Scan tones are shared with the factory scanner.
 */
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { ScanOverlays } from "./factory/factorycontainerloadingscan/ScanOverlays";
import { useContainerLoadingScanModel } from "./containerloadingscan/useContainerLoadingScanModel";
import { ScannedBalesCard } from "./containerloadingscan/ScannedBalesCard";
import { LoadingControlsPanel } from "./containerloadingscan/LoadingControlsPanel";
import { LoadingScanDialogs } from "./containerloadingscan/LoadingScanDialogs";

export default function ContainerLoadingScan() {
  const model = useContainerLoadingScanModel();
  const { orderId, isResuming } = model;

  return (
    <div className="flex flex-col h-full p-4 lg:p-6">
      <ScanOverlays model={model} />

      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <PageHeader title="Container Loading" subtitle="Floor loader bale scanning" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isResuming && orderId && (
            <Badge
              variant="outline"
              className="status-warning no-default-hover-elevate no-default-active-elevate"
              data-testid="badge-resuming"
            >
              <Clock className="h-3 w-3 mr-1" />
              Resuming Loading #{orderId}
            </Badge>
          )}
          {!isResuming && orderId && (
            <Badge variant="secondary" data-testid="badge-loading-order">
              Loading #{orderId}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Left: scanned bales */}
        <ScannedBalesCard model={model} />

        {/* Right: controls + proforma panel */}
        <LoadingControlsPanel model={model} />
      </div>

      <LoadingScanDialogs model={model} />
    </div>
  );
}
