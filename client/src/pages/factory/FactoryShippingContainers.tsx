import { useState, useRef } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, Filter, ChevronDown, ChevronRight, FileText, Circle,
  CheckCircle2, XCircle, MessageCircle, Download, Copy, ExternalLink,
  Upload, Eye, Trash2, RotateCcw, Package, Ship, Check, X, Paperclip,
  Calendar, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockDocument {
  id: string;
  name: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  source: "container" | "invoice";
  url: string;
}

interface ContainerRecord {
  id: string;
  orderDate: string;
  invoiceNumber: string;
  commercialInvoiceId: string;
  clientName: string;
  containerNumber: string;
  destination: string;
  containerArrivedDate: string;
  loadingDate: string;
  finalizedDate: string | null;
  shippingCompany: string;
  documents: MockDocument[];
  note: string;
  isDone: boolean;
  doneAt: string | null;
  doneBy: string | null;
  whatsappSentAt: string | null;
  status: string;
}

interface CommercialInvoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  status: "active" | "finalized" | "pending" | "verified";
  loadingDate: string;
  finalizedDate: string | null;
  whatsappContact?: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_INVOICES: CommercialInvoice[] = [
  {
    id: "inv-001",
    invoiceNumber: "INV-2026-0041",
    clientName: "Nakasero Traders Ltd",
    status: "active",
    loadingDate: "2026-04-28",
    finalizedDate: null,
    whatsappContact: "+256701234567",
  },
  {
    id: "inv-002",
    invoiceNumber: "INV-2026-0038",
    clientName: "Kampala Cotton Co.",
    status: "finalized",
    loadingDate: "2026-04-10",
    finalizedDate: "2026-04-22",
    whatsappContact: "+256789876543",
  },
  {
    id: "inv-003",
    invoiceNumber: "INV-2026-0035",
    clientName: "East Africa Fibers",
    status: "pending",
    loadingDate: "2026-04-05",
    finalizedDate: null,
  },
  {
    id: "inv-004",
    invoiceNumber: "INV-2026-0030",
    clientName: "Lusaka Textiles",
    status: "verified",
    loadingDate: "2026-03-20",
    finalizedDate: "2026-04-01",
    whatsappContact: "+260977123456",
  },
  {
    id: "inv-005",
    invoiceNumber: "INV-2026-0025",
    clientName: "Dar es Salaam Goods",
    status: "finalized",
    loadingDate: "2026-03-10",
    finalizedDate: "2026-03-25",
  },
];

const INITIAL_RECORDS: ContainerRecord[] = [
  {
    id: "cr-001",
    orderDate: "2026-04-29",
    invoiceNumber: "INV-2026-0041",
    commercialInvoiceId: "inv-001",
    clientName: "Nakasero Traders Ltd",
    containerNumber: "MSCU7654321",
    destination: "Kampala, Uganda",
    containerArrivedDate: "",
    loadingDate: "2026-04-28",
    finalizedDate: null,
    shippingCompany: "Maersk Line",
    documents: [],
    note: "Awaiting customs clearance",
    isDone: false,
    doneAt: null,
    doneBy: null,
    whatsappSentAt: null,
    status: "active",
  },
  {
    id: "cr-002",
    orderDate: "2026-04-12",
    invoiceNumber: "INV-2026-0038",
    commercialInvoiceId: "inv-002",
    clientName: "Kampala Cotton Co.",
    containerNumber: "TCKU4321098",
    destination: "Mombasa, Kenya",
    containerArrivedDate: "2026-05-01",
    loadingDate: "2026-04-10",
    finalizedDate: "2026-04-22",
    shippingCompany: "MSC Shipping",
    documents: [
      {
        id: "doc-001",
        name: "Commercial Invoice",
        fileName: "INV-2026-0038.pdf",
        fileType: "PDF",
        fileSize: "245 KB",
        source: "invoice",
        url: "#",
      },
      {
        id: "doc-002",
        name: "Packing List",
        fileName: "packing-list-0038.pdf",
        fileType: "PDF",
        fileSize: "118 KB",
        source: "container",
        url: "#",
      },
      {
        id: "doc-003",
        name: "Certificate of Origin",
        fileName: "cert-origin-0038.pdf",
        fileType: "PDF",
        fileSize: "89 KB",
        source: "container",
        url: "#",
      },
    ],
    note: "",
    isDone: false,
    doneAt: null,
    doneBy: null,
    whatsappSentAt: null,
    status: "finalized",
  },
  {
    id: "cr-003",
    orderDate: "2026-04-06",
    invoiceNumber: "INV-2026-0035",
    commercialInvoiceId: "inv-003",
    clientName: "East Africa Fibers",
    containerNumber: "",
    destination: "Nairobi, Kenya",
    containerArrivedDate: "",
    loadingDate: "2026-04-05",
    finalizedDate: null,
    shippingCompany: "",
    documents: [],
    note: "Container not assigned yet",
    isDone: false,
    doneAt: null,
    doneBy: null,
    whatsappSentAt: null,
    status: "pending",
  },
  {
    id: "cr-004",
    orderDate: "2026-03-22",
    invoiceNumber: "INV-2026-0030",
    commercialInvoiceId: "inv-004",
    clientName: "Lusaka Textiles",
    containerNumber: "HLXU8890012",
    destination: "Lusaka, Zambia",
    containerArrivedDate: "2026-04-15",
    loadingDate: "2026-03-20",
    finalizedDate: "2026-04-01",
    shippingCompany: "Hapag-Lloyd",
    documents: [
      {
        id: "doc-004",
        name: "Commercial Invoice",
        fileName: "INV-2026-0030.pdf",
        fileType: "PDF",
        fileSize: "302 KB",
        source: "invoice",
        url: "#",
      },
    ],
    note: "Client confirmed receipt",
    isDone: true,
    doneAt: "2026-04-20",
    doneBy: "Admin",
    whatsappSentAt: "2026-04-18",
    status: "verified",
  },
];

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  finalized: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  verified: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y?.slice(2)}`;
}

// ─── Document Status Indicator ─────────────────────────────────────────────────

function DocIndicator({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 group"
      data-testid="button-open-docs"
    >
      {count > 0 ? (
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-red-500 shrink-0" />
      )}
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors underline underline-offset-2">
        {count > 0 ? `${count} file${count !== 1 ? "s" : ""}` : "None"}
      </span>
    </button>
  );
}

// ─── Add Record Dialog ─────────────────────────────────────────────────────────

function AddRecordDialog({
  open,
  onClose,
  usedInvoiceIds,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  usedInvoiceIds: Set<string>;
  onAdd: (record: ContainerRecord) => void;
}) {
  const { toast } = useToast();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [containerNumber, setContainerNumber] = useState("");
  const [destination, setDestination] = useState("");
  const [containerArrivedDate, setContainerArrivedDate] = useState("");
  const [shippingCompany, setShippingCompany] = useState("");
  const [note, setNote] = useState("");

  const selectedInvoice = MOCK_INVOICES.find((i) => i.id === selectedInvoiceId);

  function handleAdd() {
    if (!selectedInvoiceId) {
      toast({ title: "Select a commercial invoice", variant: "destructive" });
      return;
    }
    if (!orderDate) {
      toast({ title: "Enter an order date", variant: "destructive" });
      return;
    }
    const inv = MOCK_INVOICES.find((i) => i.id === selectedInvoiceId)!;
    const newRecord: ContainerRecord = {
      id: `cr-${Date.now()}`,
      orderDate,
      invoiceNumber: inv.invoiceNumber,
      commercialInvoiceId: inv.id,
      clientName: inv.clientName,
      containerNumber,
      destination,
      containerArrivedDate,
      loadingDate: inv.loadingDate,
      finalizedDate: inv.finalizedDate,
      shippingCompany,
      documents: [],
      note,
      isDone: false,
      doneAt: null,
      doneBy: null,
      whatsappSentAt: null,
      status: inv.status,
    };
    onAdd(newRecord);
    onClose();
    setSelectedInvoiceId("");
    setContainerNumber("");
    setDestination("");
    setContainerArrivedDate("");
    setShippingCompany("");
    setNote("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Container Record
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Order Date <span className="text-red-500">*</span></Label>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} data-testid="input-order-date" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Commercial Invoice <span className="text-red-500">*</span></Label>
            <Select value={selectedInvoiceId} onValueChange={setSelectedInvoiceId}>
              <SelectTrigger data-testid="select-commercial-invoice">
                <SelectValue placeholder="Select invoice…" />
              </SelectTrigger>
              <SelectContent>
                {MOCK_INVOICES.filter((inv) => ["active", "finalized", "pending", "verified"].includes(inv.status)).map((inv) => {
                  const isUsed = usedInvoiceIds.has(inv.id);
                  return (
                    <SelectItem key={inv.id} value={inv.id} disabled={isUsed}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                        <span className="text-muted-foreground text-xs">— {inv.clientName}</span>
                        <span className={cn("text-xs px-1 rounded", STATUS_COLORS[inv.status])}>{inv.status}</span>
                        {isUsed && <span className="text-xs text-red-500">(already used)</span>}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {selectedInvoice && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-xs">
              <p className="font-semibold text-muted-foreground uppercase tracking-wide">Auto-filled from invoice</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">Client:</span>{" "}
                  <span className="font-medium">{selectedInvoice.clientName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Loading Date:</span>{" "}
                  <span className="font-medium">{fmtDate(selectedInvoice.loadingDate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Finalized:</span>{" "}
                  {selectedInvoice.finalizedDate
                    ? <span className="font-medium text-green-700">{fmtDate(selectedInvoice.finalizedDate)}</span>
                    : <span className="text-amber-600">Not finalized</span>}
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span className={cn("px-1 rounded capitalize", STATUS_COLORS[selectedInvoice.status])}>{selectedInvoice.status}</span>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Container Number</Label>
              <Input placeholder="e.g. MSCU7654321" value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} data-testid="input-container-number" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Destination</Label>
              <Input placeholder="e.g. Kampala, Uganda" value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="input-destination" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Container Arrived Date</Label>
              <Input type="date" value={containerArrivedDate} onChange={(e) => setContainerArrivedDate(e.target.value)} data-testid="input-arrived-date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Shipping Company</Label>
              <Input placeholder="e.g. Maersk Line" value={shippingCompany} onChange={(e) => setShippingCompany(e.target.value)} data-testid="input-shipping-company" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Note</Label>
            <Textarea rows={2} placeholder="Optional note…" value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-note" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd} data-testid="button-confirm-add">Add Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Row Inline (inline editing for selected fields) ─────────────────────

function EditableCellInput({
  value,
  placeholder,
  type,
  onSave,
  testId,
}: {
  value: string;
  placeholder?: string;
  type?: string;
  onSave: (v: string) => void;
  testId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        className="cursor-pointer hover:underline hover:text-foreground text-sm"
        onClick={() => { setDraft(value); setEditing(true); }}
        data-testid={testId}
      >
        {value || <span className="text-muted-foreground italic">{placeholder || "—"}</span>}
      </span>
    );
  }
  return (
    <Input
      autoFocus
      type={type || "text"}
      className="h-7 text-xs w-36"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onSave(draft); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { onSave(draft); setEditing(false); }
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

// ─── Documents Modal ──────────────────────────────────────────────────────────

function DocumentsModal({
  open,
  record,
  onClose,
  onUpdate,
}: {
  open: boolean;
  record: ContainerRecord | null;
  onClose: () => void;
  onUpdate: (id: string, docs: MockDocument[]) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newDocName, setNewDocName] = useState("");
  const [pendingFile, setPendingFile] = useState<{ name: string; fileName: string } | null>(null);

  if (!record) return null;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile({ name: "", fileName: file.name });
    setNewDocName(file.name.replace(/\.[^.]+$/, ""));
    e.target.value = "";
  }

  function handleAddDoc() {
    if (!pendingFile) return;
    const newDoc: MockDocument = {
      id: `doc-${Date.now()}`,
      name: newDocName || pendingFile.fileName,
      fileName: pendingFile.fileName,
      fileType: pendingFile.fileName.split(".").pop()?.toUpperCase() || "FILE",
      fileSize: "~Mock",
      source: "container",
      url: "#",
    };
    onUpdate(record.id, [...record.documents, newDoc]);
    setPendingFile(null);
    setNewDocName("");
    toast({ title: "Document added (mock)", description: newDoc.name });
  }

  function handleRemoveDoc(docId: string) {
    onUpdate(record.id, record.documents.filter((d) => d.id !== docId));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Documents
            <span className="font-mono text-sm text-muted-foreground font-normal">
              {record.invoiceNumber}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
            Documents are linked to both the container record and commercial invoice/customer.
          </div>

          {record.documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <XCircle className="h-8 w-8 mb-2 text-red-400" />
              <p className="text-sm">No documents uploaded yet</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Name</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Size</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {record.documents.map((doc) => (
                    <TableRow key={doc.id} data-testid={`row-doc-${doc.id}`}>
                      <TableCell className="text-sm font-medium">{doc.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{doc.fileType}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{doc.fileSize}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-xs", doc.source === "invoice" ? "border-violet-300 text-violet-700" : "border-blue-300 text-blue-700")}>
                          {doc.source === "invoice" ? "Invoice" : "Container"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" asChild data-testid={`button-view-doc-${doc.id}`}>
                            <a href={doc.url} target="_blank" rel="noreferrer">
                              <Eye className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleRemoveDoc(doc.id)}
                            data-testid={`button-remove-doc-${doc.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upload Document</p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file-upload"
            />
            {pendingFile ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md px-2 py-1.5">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{pendingFile.fileName}</span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Display Name</Label>
                  <Input
                    value={newDocName}
                    onChange={(e) => setNewDocName(e.target.value)}
                    placeholder="e.g. Packing List"
                    className="h-8 text-sm"
                    data-testid="input-doc-name"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddDoc} data-testid="button-confirm-upload">
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Add Document
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingFile(null)}>
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-doc"
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                Choose File
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── WhatsApp Package Modal ───────────────────────────────────────────────────

const DEFAULT_WA_MESSAGE = (r: ContainerRecord) =>
  `Hello,\n\nPlease find attached the documents for:\n\nClient: ${r.clientName}\nInvoice: ${r.invoiceNumber}\nContainer: ${r.containerNumber || "—"}\nDestination: ${r.destination || "—"}\nShipping Company: ${r.shippingCompany || "—"}\n\nDocuments attached:\n${r.documents.map((d) => `- ${d.name}`).join("\n") || "- (no documents)"}\n\nThank you.`;

interface WhatsAppFile {
  id: string;
  name: string;
  fileType: string;
  source: string;
  checked: boolean;
}

function WhatsAppModal({
  open,
  record,
  onClose,
  onMarkDone,
}: {
  open: boolean;
  record: ContainerRecord | null;
  onClose: () => void;
  onMarkDone: (id: string) => void;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<WhatsAppFile[]>([]);

  const invoice = record ? MOCK_INVOICES.find((i) => i.id === record.commercialInvoiceId) : null;

  function initState() {
    if (!record) return;
    setMessage(DEFAULT_WA_MESSAGE(record));
    const allFiles: WhatsAppFile[] = [
      {
        id: "stmt",
        name: "Customer Statement",
        fileType: "PDF",
        source: "Auto-generated",
        checked: true,
      },
      {
        id: "cinv",
        name: `Commercial Invoice — ${record.invoiceNumber}`,
        fileType: "PDF",
        source: "Commercial Invoice",
        checked: true,
      },
      ...record.documents.map((d) => ({
        id: d.id,
        name: d.name,
        fileType: d.fileType,
        source: d.source === "invoice" ? "Commercial Invoice" : "Container",
        checked: true,
      })),
    ];
    setFiles(allFiles);
  }

  function toggleFile(id: string) {
    setFiles((prev) => prev.map((f) => f.id === id ? { ...f, checked: !f.checked } : f));
  }

  function handleCopyMessage() {
    navigator.clipboard.writeText(message).then(() => {
      toast({ title: "Message copied to clipboard" });
    });
  }

  function handleDownloadZip() {
    toast({
      title: "Mock: ZIP package prepared",
      description: `${files.filter((f) => f.checked).length} file(s) would be included. Connect to backend for real download.`,
    });
  }

  function handleOpenWhatsApp() {
    const phone = invoice?.whatsappContact?.replace(/\D/g, "") ?? "";
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : "https://web.whatsapp.com";
    window.open(url, "_blank");
    toast({
      title: "WhatsApp opened",
      description: "Attach the downloaded ZIP/files, paste the message, then send.",
    });
  }

  function handleMarkDone() {
    if (!record) return;
    onMarkDone(record.id);
    onClose();
    toast({ title: "Marked as done", description: `${record.invoiceNumber} moved to Done section.` });
  }

  const checkedFiles = files.filter((f) => f.checked);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-green-600" />
            WhatsApp Package Preview
          </DialogTitle>
        </DialogHeader>

        {record && (
          <div
            className="space-y-4"
            ref={(el) => { if (el && open) initState(); }}
          >
            <div className="grid grid-cols-2 gap-3 text-sm rounded-md border bg-muted/30 p-3">
              <div><span className="text-xs text-muted-foreground">Client</span><p className="font-medium">{record.clientName}</p></div>
              <div><span className="text-xs text-muted-foreground">Invoice</span><p className="font-mono font-medium">{record.invoiceNumber}</p></div>
              <div><span className="text-xs text-muted-foreground">Container</span><p className="font-mono">{record.containerNumber || "—"}</p></div>
              <div><span className="text-xs text-muted-foreground">Destination</span><p>{record.destination || "—"}</p></div>
              <div><span className="text-xs text-muted-foreground">Shipping Company</span><p>{record.shippingCompany || "—"}</p></div>
              <div>
                <span className="text-xs text-muted-foreground">WhatsApp Contact</span>
                <p>{invoice?.whatsappContact ?? <span className="text-muted-foreground italic text-xs">Not set</span>}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Files to Include ({checkedFiles.length} selected)
              </p>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-xs">Send</TableHead>
                      <TableHead className="text-xs">File Name</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((f) => (
                      <TableRow key={f.id} data-testid={`row-wa-file-${f.id}`} className={!f.checked ? "opacity-50" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={f.checked}
                            onCheckedChange={() => toggleFile(f.id)}
                            data-testid={`checkbox-file-${f.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm font-medium">{f.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{f.fileType}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.source}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" asChild>
                            <a href="#" onClick={(e) => e.preventDefault()}>
                              <Eye className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">WhatsApp Message</p>
              <Textarea
                rows={10}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="text-sm font-mono"
                data-testid="textarea-wa-message"
              />
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300">
              <p className="font-semibold mb-1">How to send:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Download the ZIP package below.</li>
                <li>Click "Open WhatsApp" — the message will pre-fill if possible.</li>
                <li>Attach the downloaded ZIP/files manually in WhatsApp.</li>
                <li>Review the message, then click Send.</li>
                <li>Come back here and click "I Sent It — Mark as Done".</li>
              </ol>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleDownloadZip} data-testid="button-download-zip">
                <Download className="h-3.5 w-3.5 mr-1" />
                Download ZIP Package
              </Button>
              <Button variant="outline" onClick={handleCopyMessage} data-testid="button-copy-message">
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copy Message
              </Button>
              <Button variant="outline" onClick={handleOpenWhatsApp} data-testid="button-open-whatsapp">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open WhatsApp
              </Button>
              <Button
                variant="default"
                className="ml-auto"
                onClick={handleMarkDone}
                data-testid="button-mark-done-wa"
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                I Sent It — Mark as Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FactoryShippingContainers() {
  const { toast } = useToast();
  const [records, setRecords] = useState<ContainerRecord[]>(INITIAL_RECORDS);
  const [search, setSearch] = useState("");
  const [filterDocs, setFilterDocs] = useState<"all" | "has" | "missing">("all");
  const [filterFinalized, setFilterFinalized] = useState<"all" | "yes" | "no">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [docsRecord, setDocsRecord] = useState<ContainerRecord | null>(null);
  const [waRecord, setWaRecord] = useState<ContainerRecord | null>(null);
  const [doneExpanded, setDoneExpanded] = useState(false);

  const active = records.filter((r) => !r.isDone);
  const done = records.filter((r) => r.isDone);

  const usedInvoiceIds = new Set(records.map((r) => r.commercialInvoiceId));

  function updateRecord(id: string, patch: Partial<ContainerRecord>) {
    setRecords((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  function updateDocs(id: string, docs: MockDocument[]) {
    updateRecord(id, { documents: docs });
    setDocsRecord((prev) => prev?.id === id ? { ...prev, documents: docs } : prev);
  }

  function markDone(id: string) {
    updateRecord(id, {
      isDone: true,
      doneAt: new Date().toISOString().slice(0, 10),
      doneBy: "You",
      whatsappSentAt: new Date().toISOString().slice(0, 10),
    });
  }

  function restore(id: string) {
    updateRecord(id, { isDone: false, doneAt: null, doneBy: null });
    toast({ title: "Restored to active" });
  }

  const filtered = active.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !r.invoiceNumber.toLowerCase().includes(q) &&
        !r.clientName.toLowerCase().includes(q) &&
        !r.containerNumber.toLowerCase().includes(q) &&
        !r.destination.toLowerCase().includes(q) &&
        !r.shippingCompany.toLowerCase().includes(q)
      ) return false;
    }
    if (filterDocs === "has" && r.documents.length === 0) return false;
    if (filterDocs === "missing" && r.documents.length > 0) return false;
    if (filterFinalized === "yes" && !r.finalizedDate) return false;
    if (filterFinalized === "no" && r.finalizedDate) return false;
    return true;
  });

  function clearFilters() {
    setSearch("");
    setFilterDocs("all");
    setFilterFinalized("all");
  }

  const hasActiveFilters = filterDocs !== "all" || filterFinalized !== "all";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Shipping Containers"
        subtitle="Track commercial invoice shipments and prepare WhatsApp document packages"
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Top Controls ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-record">
            <Plus className="h-4 w-4 mr-1" />
            Add Container Record
          </Button>

          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoice, client, container, destination…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>

          <Button
            variant={showFilters ? "secondary" : "outline"}
            onClick={() => setShowFilters((v) => !v)}
            data-testid="button-toggle-filters"
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
            {hasActiveFilters && <span className="ml-1 h-2 w-2 rounded-full bg-primary inline-block" />}
          </Button>
        </div>

        {/* ── Filter Panel ── */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 items-center p-3 rounded-md border bg-muted/30">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Documents</p>
              <Select value={filterDocs} onValueChange={(v: any) => setFilterDocs(v)}>
                <SelectTrigger className="h-8 text-xs w-36" data-testid="select-filter-docs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="has">Has Documents</SelectItem>
                  <SelectItem value="missing">Missing Documents</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Finalized</p>
              <Select value={filterFinalized} onValueChange={(v: any) => setFilterFinalized(v)}>
                <SelectTrigger className="h-8 text-xs w-36" data-testid="select-filter-finalized">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="yes">Finalized</SelectItem>
                  <SelectItem value="no">Not Finalized</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters} data-testid="button-clear-filters">
                Clear All
              </Button>
            </div>
          </div>
        )}

        {/* ── Status Legend ── */}
        <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Has documents</span>
          <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-red-500" /> No documents</span>
          <span>Click any editable cell (Container #, Destination, Shipping Co., Note) to edit inline.</span>
        </div>

        {/* ── Main Table ── */}
        <div className="rounded-md border overflow-x-auto">
          <Table className="text-xs whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Order Date</TableHead>
                <TableHead className="text-xs">Invoice #</TableHead>
                <TableHead className="text-xs">Client</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Container #</TableHead>
                <TableHead className="text-xs">Destination</TableHead>
                <TableHead className="text-xs">Arrived</TableHead>
                <TableHead className="text-xs">Loading Date</TableHead>
                <TableHead className="text-xs">Finalized</TableHead>
                <TableHead className="text-xs">Shipping Co.</TableHead>
                <TableHead className="text-xs">Documents</TableHead>
                <TableHead className="text-xs">Note</TableHead>
                <TableHead className="text-xs">WhatsApp</TableHead>
                <TableHead className="text-xs">Done</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center py-10 text-muted-foreground">
                    {active.length === 0 ? "No active records. Add one above." : "No records match the current filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id} data-testid={`row-record-${r.id}`}>
                    {/* Order Date */}
                    <TableCell>{fmtDate(r.orderDate)}</TableCell>

                    {/* Invoice # */}
                    <TableCell className="font-mono font-medium">{r.invoiceNumber}</TableCell>

                    {/* Client */}
                    <TableCell className="font-medium max-w-36 truncate">{r.clientName}</TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge className={cn("text-xs capitalize no-default-active-elevate", STATUS_COLORS[r.status])}>
                        {r.status}
                      </Badge>
                    </TableCell>

                    {/* Container # (editable) */}
                    <TableCell>
                      <EditableCellInput
                        value={r.containerNumber}
                        placeholder="Enter #"
                        onSave={(v) => {
                          updateRecord(r.id, { containerNumber: v });
                          toast({ title: "Container number updated", description: "Also synced to loading record in final implementation." });
                        }}
                        testId={`cell-container-${r.id}`}
                      />
                    </TableCell>

                    {/* Destination (editable) */}
                    <TableCell>
                      <EditableCellInput
                        value={r.destination}
                        placeholder="Enter destination"
                        onSave={(v) => {
                          updateRecord(r.id, { destination: v });
                          toast({ title: "Destination updated" });
                        }}
                        testId={`cell-destination-${r.id}`}
                      />
                    </TableCell>

                    {/* Arrived */}
                    <TableCell>
                      <EditableCellInput
                        value={fmtDate(r.containerArrivedDate)}
                        placeholder="Not arrived"
                        onSave={(v) => updateRecord(r.id, { containerArrivedDate: v })}
                        testId={`cell-arrived-${r.id}`}
                      />
                    </TableCell>

                    {/* Loading Date (auto-filled, read-only) */}
                    <TableCell>
                      <span className="text-muted-foreground">{fmtDate(r.loadingDate)}</span>
                    </TableCell>

                    {/* Finalized (auto-filled, read-only) */}
                    <TableCell>
                      {r.finalizedDate ? (
                        <span className="text-green-700 dark:text-green-400 font-medium">{fmtDate(r.finalizedDate)}</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 italic text-xs">Not finalized</span>
                      )}
                    </TableCell>

                    {/* Shipping Company (editable) */}
                    <TableCell>
                      <EditableCellInput
                        value={r.shippingCompany}
                        placeholder="Enter company"
                        onSave={(v) => {
                          updateRecord(r.id, { shippingCompany: v });
                          toast({ title: "Shipping company updated" });
                        }}
                        testId={`cell-shipping-${r.id}`}
                      />
                    </TableCell>

                    {/* Documents */}
                    <TableCell>
                      <DocIndicator
                        count={r.documents.length}
                        onClick={() => setDocsRecord(r)}
                      />
                    </TableCell>

                    {/* Note (editable) */}
                    <TableCell className="max-w-32">
                      <EditableCellInput
                        value={r.note}
                        placeholder="Add note"
                        onSave={(v) => updateRecord(r.id, { note: v })}
                        testId={`cell-note-${r.id}`}
                      />
                    </TableCell>

                    {/* WhatsApp */}
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                        onClick={() => setWaRecord(r)}
                        data-testid={`button-prepare-wa-${r.id}`}
                      >
                        <MessageCircle className="h-3.5 w-3.5 mr-1" />
                        Prepare
                      </Button>
                    </TableCell>

                    {/* Done */}
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          markDone(r.id);
                          toast({ title: "Marked as done", description: `${r.invoiceNumber} moved to Done section.` });
                        }}
                        data-testid={`button-mark-done-${r.id}`}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Done
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* ── Done / Hidden Containers ── */}
        <div className="rounded-md border overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover-elevate bg-muted/20"
            onClick={() => setDoneExpanded((v) => !v)}
            data-testid="button-toggle-done"
          >
            <span className="flex items-center gap-2">
              {doneExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Done / Hidden Containers
              <Badge variant="outline" className="text-xs">{done.length}</Badge>
            </span>
            <span className="text-xs">Collapse to keep workspace clean</span>
          </button>

          {doneExpanded && (
            done.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No done containers yet.
              </div>
            ) : (
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Invoice #</TableHead>
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs">Container #</TableHead>
                    <TableHead className="text-xs">Destination</TableHead>
                    <TableHead className="text-xs">Done Date</TableHead>
                    <TableHead className="text-xs">Done By</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {done.map((r) => (
                    <TableRow key={r.id} className="opacity-70" data-testid={`row-done-${r.id}`}>
                      <TableCell className="font-mono">{r.invoiceNumber}</TableCell>
                      <TableCell>{r.clientName}</TableCell>
                      <TableCell className="font-mono">{r.containerNumber || "—"}</TableCell>
                      <TableCell>{r.destination || "—"}</TableCell>
                      <TableCell>{fmtDate(r.doneAt)}</TableCell>
                      <TableCell>{r.doneBy || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDocsRecord(r)}
                            data-testid={`button-view-done-${r.id}`}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => restore(r.id)}
                            data-testid={`button-restore-${r.id}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Restore
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          )}
        </div>

        {/* ── Mockup notice ── */}
        <div className="flex items-start gap-2 p-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>
            <strong>Mockup mode.</strong> Data is stored in memory only — changes will reset on refresh.
            Document uploads, ZIP downloads, and WhatsApp sending are simulated.
            After approval, this page will be connected to the real backend.
          </p>
        </div>

      </div>

      {/* ── Dialogs ── */}
      <AddRecordDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        usedInvoiceIds={usedInvoiceIds}
        onAdd={(r) => {
          setRecords((prev) => [r, ...prev]);
          toast({ title: "Record added", description: r.invoiceNumber });
        }}
      />

      <DocumentsModal
        open={!!docsRecord}
        record={docsRecord}
        onClose={() => setDocsRecord(null)}
        onUpdate={updateDocs}
      />

      <WhatsAppModal
        open={!!waRecord}
        record={waRecord}
        onClose={() => setWaRecord(null)}
        onMarkDone={markDone}
      />
    </div>
  );
}
