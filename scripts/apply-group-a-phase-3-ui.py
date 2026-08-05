from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not find {label}")
    return text.replace(old, new, 1)


# Admin revision history: immutable statuses replace the editable optional switch.
path = Path("client/src/pages/vouchers/StockTransferRevisionHistory.tsx")
text = path.read_text()
text = text.replace('import { Switch } from "@/components/ui/switch";\n', '')
helper = '''
type RevisionStatus = "pending" | "approved" | "rejected" | "cancelled" | "superseded";

function revisionStatus(revision: any): RevisionStatus {
  return revision.status ?? (revision.optional ? "pending" : "approved");
}

function revisionStatusLabel(status: RevisionStatus): string {
  return status === "pending"
    ? "Pending Review"
    : status === "approved"
      ? "Approved"
      : status === "rejected"
        ? "Rejected"
        : status === "superseded"
          ? "Superseded"
          : "Cancelled";
}

function revisionStatusVariant(status: RevisionStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "rejected" || status === "cancelled") return "destructive";
  if (status === "pending") return "secondary";
  return "outline";
}
'''
anchor = 'interface StockTransferRevisionHistoryProps {'
if helper not in text:
    text = replace_once(text, anchor, helper + '\n' + anchor, "admin status helpers")
text = text.replace('rev.optional && (', 'revisionStatus(rev) === "pending" && (')
text = replace_once(
    text,
    '<Badge variant={rev.optional ? "secondary" : "default"}>Rev {rev.revisionNumber}</Badge>',
    '<Badge variant={revisionStatusVariant(revisionStatus(rev))}>Rev {rev.revisionNumber}</Badge>',
    "revision number badge",
)
text = replace_once(
    text,
    '''                    {revisionStatus(rev) === "pending" && (
                      <Badge variant="outline" className="text-xs">
                        Reference Only
                      </Badge>
                    )}''',
    '''                    <Badge variant={revisionStatusVariant(revisionStatus(rev))} className="text-xs">
                      {revisionStatusLabel(revisionStatus(rev))}
                    </Badge>''',
    "revision status badge",
)
text = replace_once(
    text,
    '''                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Reference only:</span>
                    <Switch
                      checked={rev.optional}
                      onCheckedChange={async (checked) => {
                        try {
                          await modeApiRequest("PATCH", `/api/stock-transfer-revisions/${rev.id}/optional`, {
                            optional: checked,
                          });
                        } finally {
                          setTransferRevisionsExpanded(true);
                          queryClient.invalidateQueries({
                            queryKey: ["/api/stock-transfers", lastKnownTransferIdRef.current, "revisions"],
                          });
                        }
                      }}
                      data-testid={`switch-transfer-revision-optional-${rev.id}`}
                    />
                  </div>''',
    '''                  <div className="text-xs text-muted-foreground text-right">
                    <div>
                      {rev.sourceLocationName || rev.items?.[0]?.sourceLocationName || "Unknown"}
                      {" → "}
                      {rev.destinationLocationName || "Unknown"}
                    </div>
                    {rev.reviewedAt && <div>Reviewed {format(new Date(rev.reviewedAt), "yyyy-MM-dd")}</div>}
                  </div>''',
    "immutable revision metadata",
)
text = replace_once(
    text,
    '''                {rev.items && rev.items.length > 0 && (''',
    '''                {rev.rejectionReason && (
                  <div className="px-3 py-2 text-xs text-destructive border-t bg-destructive/5">
                    Reason: {rev.rejectionReason}
                  </div>
                )}
                {rev.items && rev.items.length > 0 && (''',
    "rejection reason",
)
path.write_text(text)

# POS eye dialog: render all terminal states accurately and show the revision route.
path = Path("client/src/pages/pos/postransferorders/components/ViewTransferDialog.tsx")
text = path.read_text()
text = replace_once(
    text,
    'import {CheckCircle2, Clock, Lock} from "lucide-react";',
    'import {AlertTriangle, CheckCircle2, Clock, Lock, XCircle} from "lucide-react";',
    "POS revision icons",
)
helper = '''
type RevisionStatus = "pending" | "approved" | "rejected" | "cancelled" | "superseded";

function revisionStatus(revision: { status?: RevisionStatus; optional: boolean }): RevisionStatus {
  return revision.status ?? (revision.optional ? "pending" : "approved");
}

function RevisionStatusBadge({ status }: { status: RevisionStatus }) {
  if (status === "approved") {
    return (
      <Badge variant="default" className="text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Approved
      </Badge>
    );
  }
  if (status === "pending") return <Badge variant="outline" className="text-xs">Pending Admin Review</Badge>;
  if (status === "rejected" || status === "cancelled") {
    return (
      <Badge variant="destructive" className="text-xs">
        <XCircle className="h-3 w-3 mr-1" /> {status === "rejected" ? "Rejected" : "Cancelled"}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs">
      <AlertTriangle className="h-3 w-3 mr-1" /> Superseded
    </Badge>
  );
}
'''
anchor = 'export // ─── View-only dialog'
if helper not in text:
    text = replace_once(text, anchor, helper + '\n' + anchor, "POS status helpers")
text = replace_once(
    text,
    '''                  const revLocName = rev.items[0]?.sourceLocationName ?? null;
                  return (''',
    '''                  const revLocName = rev.sourceLocationName ?? rev.items[0]?.sourceLocationName ?? null;
                  const status = revisionStatus(rev);
                  return (''',
    "POS revision metadata",
)
text = replace_once(
    text,
    '''                            {revLocName && (
                              <span className="text-xs text-muted-foreground">
                                · From: <span className="font-medium text-foreground">{revLocName}</span>
                              </span>
                            )}''',
    '''                            <span className="text-xs text-muted-foreground">
                              · <span className="font-medium text-foreground">{revLocName || "Unknown"}</span>
                              {" → "}
                              <span className="font-medium text-foreground">
                                {rev.destinationLocationName || detail.destinationLocationName}
                              </span>
                            </span>''',
    "POS revision route",
)
text = replace_once(
    text,
    '''                          {rev.optional ? (
                            <Badge variant="outline" className="text-xs">
                              Pending Admin Review
                            </Badge>
                          ) : (
                            <Badge variant="default" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Approved
                            </Badge>
                          )}''',
    '''                          <RevisionStatusBadge status={status} />''',
    "POS revision status badge",
)
text = replace_once(
    text,
    '''                        {rev.note && <p className="text-xs text-muted-foreground italic">{rev.note}</p>}''',
    '''                        {rev.note && <p className="text-xs text-muted-foreground italic">{rev.note}</p>}
                        {rev.rejectionReason && (
                          <p className="text-xs text-destructive">Reason: {rev.rejectionReason}</p>
                        )}''',
    "POS rejection reason",
)
path.write_text(text)

print("Group A Phase 3 revision history UI applied.")
