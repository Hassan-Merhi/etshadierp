import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { fmtDate, tableShortName, isItemDiffKey, BUSINESS_FIELD_LABELS, fmtBusinessValue } from "./AuditLogUtils";

function fmtEntryAmount(v: string | number): string {
  const n = parseFloat(String(v));
  return isNaN(n) ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function compareEntries(oldArr: any[], newArr: any[]) {
  const oldMap = new Map<string, any>(oldArr.map((e) => [e.account, e]));
  const newMap = new Map<string, any>(newArr.map((e) => [e.account, e]));
  const added: any[] = [];
  const removed: any[] = [];
  const changed: Array<{ account: string; old: any; new: any }> = [];
  for (const [account, entry] of newMap) {
    if (!oldMap.has(account)) {
      added.push(entry);
    } else {
      const old = oldMap.get(account)!;
      if (
        parseFloat(old.debit || "0") !== parseFloat(entry.debit || "0") ||
        parseFloat(old.credit || "0") !== parseFloat(entry.credit || "0") ||
        (old.narration ?? "") !== (entry.narration ?? "")
      ) {
        changed.push({ account, old, new: entry });
      }
    }
  }
  for (const [account, entry] of oldMap) {
    if (!newMap.has(account)) removed.push(entry);
  }
  return { added, removed, changed };
}

function getHeaderSentence(log: any): string {
  const changes = log.changes || {};
  const user =
    log.username && log.username !== "unknown"
      ? log.username
      : log.userId
        ? `User #${log.userId.slice(0, 8)}`
        : "Unknown user";
  const verb = log.action === "create" ? "created" : log.action === "delete" ? "deleted" : "updated";
  const vType = changes.voucherType?.new ?? changes.voucherType?.old ?? changes.type?.new ?? changes.type?.old ?? "";
  const module = tableShortName(log.tableName).replace(/s$/, "");
  const typePart = vType ? `${vType} ${module.toLowerCase()}` : module.toLowerCase();
  const ref = log.recordIdentifier ?? (log.recordId ? `#${log.recordId}` : "");
  return `${user} ${verb} ${typePart}${ref ? ` ${ref}` : ""} on ${fmtDate(log.createdAt)}.`;
}

function isLikelyTechnical(field: string, vals: any): boolean {
  if (/Id$|_id$|Ids$/.test(field)) return true;
  const v = (vals as any)?.old ?? (vals as any)?.new;
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return true;
  return false;
}

export function AuditLogDialog({ log, onClose }: { log: any; onClose: () => void }) {
  const { data: me } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const changes: Record<string, { old?: any; new?: any }> = log.changes || {};
  const isDelete = log.action === "delete";
  const isCreate = log.action === "create";
  const isUpdate = log.action === "update";

  const { entries: entriesChange, ...scalarChanges } = changes as any;
  const oldEntries: any[] = entriesChange?.old ?? [];
  const newEntries: any[] = entriesChange?.new ?? [];
  const hasEntries = oldEntries.length > 0 || newEntries.length > 0;
  const entryDiff = isUpdate ? compareEntries(oldEntries, newEntries) : { added: [], removed: [], changed: [] };

  const voucherType =
    changes.voucherType?.new ?? changes.voucherType?.old ?? changes.type?.new ?? changes.type?.old ?? "";

  const readableFields = Object.entries(scalarChanges).filter(([k, v]) => !isLikelyTechnical(k, v));

  const renderRow = (field: string, vals: any) => {
    if (isItemDiffKey(field)) {
      const isAdded = field.startsWith("item_added_");
      const isRemoved = field.startsWith("item_removed_");
      const text = (vals as any)?.new ?? (vals as any)?.old ?? "";
      if (!text) return null;
      return (
        <div key={field} className="flex gap-2 text-sm py-1.5 border-b last:border-0 items-start">
          <span
            className={`font-bold shrink-0 select-none ${isAdded ? "text-green-600 dark:text-green-400" : isRemoved ? "text-destructive" : "text-muted-foreground"}`}
          >
            {isAdded ? "+" : isRemoved ? "−" : "~"}
          </span>
          <span className={isAdded ? "text-green-700 dark:text-green-300" : isRemoved ? "text-destructive/90" : ""}>
            {text}
          </span>
        </div>
      );
    }

    const label = BUSINESS_FIELD_LABELS[field] || field;
    const oldFmt = fmtBusinessValue(field, vals?.old);
    const newFmt = fmtBusinessValue(field, vals?.new);
    if (isUpdate && oldFmt === newFmt) return null;

    return (
      <div key={field} className="flex gap-3 text-sm py-1.5 border-b last:border-0 items-start">
        <span className="text-muted-foreground w-40 shrink-0">{label}</span>
        {isCreate && <span className="font-medium">{newFmt}</span>}
        {isDelete && <span className="font-medium">{oldFmt}</span>}
        {isUpdate && (
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-destructive line-through">{oldFmt}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium text-green-600 dark:text-green-400">{newFmt}</span>
          </span>
        )}
      </div>
    );
  };

  const renderedRows = readableFields.map(([field, vals]) => renderRow(field, vals)).filter(Boolean);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-medium leading-snug pr-6">{getHeaderSentence(log)}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm rounded-md border p-3 bg-muted/30">
          <span className="text-muted-foreground">User</span>
          <span className="font-medium">{log.username || "Unknown"}</span>
          <span className="text-muted-foreground">Date & Time</span>
          <span>{fmtDate(log.createdAt)}</span>
          <span className="text-muted-foreground">Action</span>
          <span>
            <Badge
              variant={isDelete ? "destructive" : isCreate ? "default" : "secondary"}
              className="capitalize text-xs"
            >
              {log.action}
            </Badge>
          </span>
          <span className="text-muted-foreground">Module</span>
          <span>{tableShortName(log.tableName)}</span>
          {voucherType && (
            <>
              <span className="text-muted-foreground">Type</span>
              <span>{voucherType}</span>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-semibold">
            {isDelete ? "Deleted record details" : isCreate ? "Created record details" : "What changed"}
          </p>
          {renderedRows.length > 0 ? (
            <div className="rounded-md border px-3 divide-y">{renderedRows}</div>
          ) : (
            <p className="text-sm text-muted-foreground">No meaningful details captured.</p>
          )}
        </div>

        {hasEntries && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Accounting Details</p>
            {/* Minimal entries summary here to keep file small */}
            <div className="text-xs text-muted-foreground">
              {isUpdate
                ? "Accounting entries were modified."
                : isCreate
                  ? "Accounting entries were created."
                  : "Accounting entries were deleted."}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
