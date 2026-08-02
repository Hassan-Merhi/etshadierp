import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, DrawerForm, EnrichedContainerRow } from "./gitContainerTypes";
import { useErpText } from "@/i18n/modules/erp";

interface ContainerDrawerFormProps {
  form: DrawerForm;
  set: (field: keyof DrawerForm, val: any) => void;
  container: EnrichedContainerRow;
  canEdit: boolean;
  maxOffload: string | null;
  daysDelayed: number | null;
}

export function ContainerDrawerForm({
  form,
  set,
  container,
  canEdit,
  maxOffload,
  daysDelayed,
}: ContainerDrawerFormProps) {
  const tUi = useErpText();
  const transUpper = form.transporter.toUpperCase();
  const transLabel =
    transUpper.includes("FARHAT") || transUpper.includes("CONTINENTAL")
      ? "(+11d)"
      : transUpper.includes("KDOUH")
        ? "(+12d)"
        : form.transporter
          ? "(+14d)"
          : "";

  return (
    <div className="space-y-4 pt-2">
      {!canEdit && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            This container belongs to <strong>{container.companyName}</strong>. Switch to that company to edit it.
          </span>
        </div>
      )}

      {/* ── Calculated read-only preview ── */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {tUi("calculated.read.only")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{tUi("max.offload.date")}</p>
            <p
              className={cn(
                "text-sm font-medium",
                maxOffload && new Date(maxOffload) < new Date() ? "text-red-600" : ""
              )}
            >
              {fmtDate(maxOffload)}
              {maxOffload && form.transporter && (
                <span className="text-xs text-muted-foreground ml-1">{transLabel}</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{tUi("days.delayed")}</p>
            <p className={cn("text-sm font-medium", daysDelayed ? "text-red-600" : "text-muted-foreground")}>
              {daysDelayed ? `-${daysDelayed}d` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{tUi("offload.overdue")}</p>
            <p className="text-sm font-medium">
              {container.isOverdue ? (
                <span className="text-red-600">Yes</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* ── Shop Name ── */}
      <div className="space-y-1">
        <Label className="text-xs">{tUi("shop.name")}</Label>
        <Input
          placeholder="e.g. ABC SHOP"
          value={form.shopName}
          onChange={(e) => set("shopName", e.target.value)}
          disabled={!canEdit}
          data-testid="input-drawer-shop-name"
        />
      </div>

      {/* ── ETA DAS ── */}
      <div className="space-y-1">
        <Label className="text-xs">{tUi("eta.das")}</Label>
        <Input
          type="date"
          value={form.eta}
          onChange={(e) => set("eta", e.target.value)}
          disabled={!canEdit}
          data-testid="input-drawer-eta"
        />
      </div>

      {/* ── Transporter + Transport Fee ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{tUi("transporter")}</Label>
          <Select
            value={form.transporter || "__none"}
            onValueChange={(v) => set("transporter", v === "__none" ? "" : v)}
            disabled={!canEdit}
          >
            <SelectTrigger data-testid="select-drawer-transporter">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">—</SelectItem>
              <SelectItem value="FARHAT">{tUi("farhat.11d")}</SelectItem>
              <SelectItem value="CONTINENTAL">{tUi("continental.11d")}</SelectItem>
              <SelectItem value="KDOUH">{tUi("kdouh.12d")}</SelectItem>
              <SelectItem value="TRH">{tUi("trh.14d")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{tUi("transport.fee")}</Label>
          <Input
            type="number"
            placeholder="0"
            value={form.transportFee}
            onChange={(e) => set("transportFee", e.target.value)}
            disabled={!canEdit}
            data-testid="input-drawer-transport-fee"
          />
        </div>
      </div>

      {/* ── Truck + Location ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{tUi("truck.number.plate")}</Label>
          <Input
            placeholder={tUi("t123abc")}
            value={form.numberPlate}
            onChange={(e) => set("numberPlate", e.target.value)}
            disabled={!canEdit}
            data-testid="input-drawer-plate"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{tUi("location")}</Label>
          <Input
            placeholder="e.g. Kasumbalesa"
            value={form.trackingLocation}
            onChange={(e) => set("trackingLocation", e.target.value)}
            disabled={!canEdit}
            data-testid="input-drawer-location"
          />
        </div>
      </div>

      {/* ── Border Date ── */}
      <div className="space-y-1">
        <Label className="text-xs">{tUi("border.date")}</Label>
        <Input
          type="date"
          value={form.borderDate}
          onChange={(e) => set("borderDate", e.target.value)}
          disabled={!canEdit}
          data-testid="input-drawer-border-date"
        />
        <p className="text-xs text-muted-foreground">{tUi("used.to.calculate.max.offload.date.based.on.tran")}</p>
      </div>

      {/* ── Declarant + Duty Fee ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{tUi("declarant.agent")}</Label>
          <Input
            placeholder="e.g. ATLAS"
            value={form.agent}
            onChange={(e) => set("agent", e.target.value)}
            disabled={!canEdit}
            data-testid="input-drawer-agent"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{tUi("duty.fee")}</Label>
          <Input
            type="number"
            placeholder="0"
            value={form.dutyFee}
            onChange={(e) => set("dutyFee", e.target.value)}
            disabled={!canEdit}
            data-testid="input-drawer-duty-fee"
          />
        </div>
      </div>

      {/* ── Docs ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{tUi("docs.received")}</Label>
          <div className="flex items-center gap-2 pt-1">
            <Switch
              checked={form.docReceived}
              onCheckedChange={(v) => set("docReceived", v)}
              disabled={!canEdit}
              data-testid="switch-drawer-docs-received"
            />
            <span className="text-sm">{form.docReceived ? "Yes" : "No"}</span>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{tUi("docs.sent.to.transporter")}</Label>
          <Input
            type="date"
            value={form.docsSentDate}
            onChange={(e) => set("docsSentDate", e.target.value)}
            disabled={!canEdit}
            data-testid="input-drawer-docs-sent"
          />
        </div>
      </div>

      {/* ── Tracking Link ── */}
      <div className="space-y-1">
        <Label className="text-xs">{tUi("tracking.link")}</Label>
        <Input
          placeholder="https://…"
          value={form.trackingLink}
          onChange={(e) => set("trackingLink", e.target.value)}
          disabled={!canEdit}
          data-testid="input-drawer-tracking"
        />
      </div>

      {/* ── Notes ── */}
      <div className="space-y-1">
        <Label className="text-xs">{tUi("notes")}</Label>
        <Textarea
          rows={3}
          placeholder={tUi("additional.notes")}
          value={form.trackingDescription}
          onChange={(e) => set("trackingDescription", e.target.value)}
          disabled={!canEdit}
          data-testid="input-drawer-notes"
        />
      </div>

      {/* ── BL Docs ── */}
      <div className="space-y-1">
        <Label className="text-xs">{tUi("bl.docs")}</Label>
        <Textarea
          rows={3}
          placeholder={tUi("bl.document.notes")}
          value={form.blDocs}
          onChange={(e) => set("blDocs", e.target.value)}
          disabled={!canEdit}
          data-testid="input-drawer-bl-docs"
        />
      </div>
    </div>
  );
}
