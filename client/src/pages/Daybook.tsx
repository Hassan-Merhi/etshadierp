import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Book, Filter, X, Eye, Edit, Trash2 } from "lucide-react";
import { format, parseISO, isToday } from "date-fns";

// Zod schema for editing voucher entries
const entryEditSchema = z.object({
  id: z.number(),
  debitAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
    message: "Must be a valid number",
  }),
  creditAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
    message: "Must be a valid number",
  }),
});

// Zod schema for editing vouchers with entries
const editVoucherSchema = z.object({
  voucherDate: z.string().min(1, "Voucher date is required"),
  voucherType: z.enum(["Payment", "Receipt", "Journal", "Sales", "Purchase", "Contra"], {
    required_error: "Voucher type is required",
  }),
  description: z.string().optional(),
  entries: z.array(entryEditSchema).min(2, "At least 2 entries required"),
}).refine((data) => {
  // Calculate total debits and credits
  const totalDebits = data.entries.reduce((sum, entry) => sum + parseFloat(entry.debitAmount || "0"), 0);
  const totalCredits = data.entries.reduce((sum, entry) => sum + parseFloat(entry.creditAmount || "0"), 0);
  return Math.abs(totalDebits - totalCredits) < 0.01; // Allow for floating point precision
}, {
  message: "Total debits must equal total credits",
  path: ["entries"],
});

type EditVoucherForm = z.infer<typeof editVoucherSchema>;

interface Voucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  createdAt: string;
}

interface VoucherEntry {
  id: number;
  voucherId: number;
  accountType: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
}

export default function Daybook({ user }: { user?: any } = {}) {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    voucherType: "all",
    searchQuery: "",
  });
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [voucherToEdit, setVoucherToEdit] = useState<Voucher | null>(null);
  const [editFormInitialized, setEditFormInitialized] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [voucherToDelete, setVoucherToDelete] = useState<Voucher | null>(null);

  // Fetch voucher entries when editing
  const { data: voucherEntries = [], isLoading: entriesLoading } = useQuery<VoucherEntry[]>({
    queryKey: voucherToEdit ? [`/api/vouchers/${voucherToEdit.id}/entries`] : [],
    enabled: !!voucherToEdit && editDialogOpen,
  });
  
  // Edit form with react-hook-form and zod
  const editForm = useForm<EditVoucherForm>({
    resolver: zodResolver(editVoucherSchema),
    defaultValues: {
      voucherDate: "",
      voucherType: "Journal",
      description: "",
      entries: [],
    },
  });

  // Populate form with entries when they're loaded (only once per voucher)
  useEffect(() => {
    if (voucherToEdit && voucherEntries.length > 0 && !entriesLoading && !editFormInitialized) {
      editForm.reset({
        voucherDate: voucherToEdit.voucherDate,
        voucherType: voucherToEdit.voucherType as any,
        description: voucherToEdit.description || "",
        entries: voucherEntries.map(entry => ({
          id: entry.id,
          debitAmount: entry.debitAmount || "0",
          creditAmount: entry.creditAmount || "0",
        })),
      });
      setEditFormInitialized(true);
    }
  }, [voucherToEdit, voucherEntries, entriesLoading, editFormInitialized, editForm]);

  // Fetch all vouchers
  const { data: vouchers = [], isLoading } = useQuery<Voucher[]>({
    queryKey: ["/api/vouchers"],
  });

  // Apply filters
  const filteredVouchers = useMemo(() => {
    return vouchers.filter((voucher) => {
      // Date range filter
      if (filters.startDate && voucher.voucherDate < filters.startDate) {
        return false;
      }
      if (filters.endDate && voucher.voucherDate > filters.endDate) {
        return false;
      }

      // Voucher type filter
      if (filters.voucherType !== "all" && voucher.voucherType !== filters.voucherType) {
        return false;
      }

      // Search query filter
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        return (
          voucher.voucherNumber.toLowerCase().includes(query) ||
          voucher.description?.toLowerCase().includes(query) ||
          voucher.voucherType.toLowerCase().includes(query)
        );
      }

      return true;
    }).sort((a, b) => {
      // Sort by date (newest first), then by voucher number
      const dateCompare = b.voucherDate.localeCompare(a.voucherDate);
      if (dateCompare !== 0) return dateCompare;
      return b.voucherNumber.localeCompare(a.voucherNumber);
    });
  }, [vouchers, filters]);

  // Check if user can edit a voucher based on role and date
  const canEdit = (voucher: Voucher): boolean => {
    if (!user) return false;
    
    // Admin and Owner can edit all transactions
    if (user.role === "Admin" || user.role === "Owner") {
      return true;
    }

    // Manager can edit only today's transactions
    if (user.role === "Manager") {
      return isToday(parseISO(voucher.voucherDate));
    }

    return false;
  };

  // Check if user can delete a voucher (only Admin)
  const canDelete = (): boolean => {
    return user?.role === "Admin";
  };

  // Edit voucher mutation
  const editMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: EditVoucherForm }) => {
      // Update voucher metadata
      await apiRequest("PATCH", `/api/vouchers/${id}`, {
        voucherDate: updates.voucherDate,
        voucherType: updates.voucherType,
        description: updates.description,
      });

      // Update each entry
      for (const entry of updates.entries) {
        await apiRequest("PATCH", `/api/voucher-entries/${entry.id}`, {
          debitAmount: entry.debitAmount,
          creditAmount: entry.creditAmount,
        });
      }

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      toast({
        title: "Success",
        description: "Voucher and entries updated successfully",
      });
      setEditDialogOpen(false);
      setVoucherToEdit(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update voucher",
        variant: "destructive",
      });
    },
  });

  // Delete voucher mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/vouchers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      toast({
        title: "Success",
        description: "Voucher deleted successfully",
      });
      setDeleteDialogOpen(false);
      setVoucherToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete voucher",
        variant: "destructive",
      });
    },
  });

  // Handler functions
  const handleView = (voucher: Voucher) => {
    setSelectedVoucher(voucher);
    setViewDialogOpen(true);
  };

  const handleEdit = (voucher: Voucher) => {
    setVoucherToEdit(voucher);
    setEditFormInitialized(false); // Reset initialization flag for new voucher
    setEditDialogOpen(true);
  };

  const handleSaveEdit = (data: EditVoucherForm) => {
    if (!voucherToEdit) return;
    
    editMutation.mutate({
      id: voucherToEdit.id,
      updates: data,
    });
  };

  const handleDelete = (voucher: Voucher) => {
    setVoucherToDelete(voucher);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (voucherToDelete) {
      deleteMutation.mutate(voucherToDelete.id);
    }
  };

  const clearFilters = () => {
    setFilters({
      startDate: "",
      endDate: "",
      voucherType: "all",
      searchQuery: "",
    });
  };

  const hasActiveFilters = filters.startDate || filters.endDate || filters.voucherType !== "all" || filters.searchQuery;

  const getVoucherTypeBadgeVariant = (type: string) => {
    switch (type) {
      case "Sales":
        return "default";
      case "Purchase":
        return "secondary";
      case "Payment":
        return "destructive";
      case "Receipt":
        return "default";
      case "Journal":
        return "outline";
      case "Contra":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Book className="w-8 h-8" />
            Daybook
          </h1>
          <p className="text-muted-foreground mt-1">
            View all accounting transactions chronologically
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              <CardTitle>Filters</CardTitle>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
                className="gap-1"
              >
                <X className="w-4 h-4" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                data-testid="input-end-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voucher-type">Voucher Type</Label>
              <Select
                value={filters.voucherType}
                onValueChange={(value) => setFilters({ ...filters, voucherType: value })}
              >
                <SelectTrigger id="voucher-type" data-testid="select-voucher-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Sales">Sales</SelectItem>
                  <SelectItem value="Purchase">Purchase</SelectItem>
                  <SelectItem value="Payment">Payment</SelectItem>
                  <SelectItem value="Receipt">Receipt</SelectItem>
                  <SelectItem value="Journal">Journal</SelectItem>
                  <SelectItem value="Contra">Contra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Voucher # or description..."
                value={filters.searchQuery}
                onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
                data-testid="input-search"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vouchers Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Transactions
            {filteredVouchers.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filteredVouchers.length} {filteredVouchers.length === 1 ? "entry" : "entries"})
              </span>
            )}
          </CardTitle>
          <CardDescription>
            All accounting vouchers and transactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredVouchers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {hasActiveFilters ? (
                <div>
                  <p className="mb-2">No transactions found matching your filters.</p>
                  <Button
                    variant="outline"
                    onClick={clearFilters}
                    data-testid="button-clear-filters-empty"
                  >
                    Clear Filters
                  </Button>
                </div>
              ) : (
                <p>No transactions found. Create your first voucher to get started.</p>
              )}
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVouchers.map((voucher) => (
                    <TableRow
                      key={voucher.id}
                      data-testid={`row-voucher-${voucher.id}`}
                    >
                      <TableCell className="font-medium">
                        {format(parseISO(voucher.voucherDate), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {voucher.voucherNumber}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getVoucherTypeBadgeVariant(voucher.voucherType)}
                          data-testid={`badge-type-${voucher.id}`}
                        >
                          {voucher.voucherType}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        {voucher.description || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${parseFloat(voucher.totalAmount).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleView(voucher)}
                            data-testid={`button-view-${voucher.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canEdit(voucher) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(voucher)}
                              data-testid={`button-edit-${voucher.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          {canDelete() && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(voucher)}
                              data-testid={`button-delete-${voucher.id}`}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Voucher Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voucher Details</DialogTitle>
            <DialogDescription>
              View voucher information
            </DialogDescription>
          </DialogHeader>
          {selectedVoucher && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Voucher Number</p>
                  <p className="font-mono font-medium">{selectedVoucher.voucherNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {format(parseISO(selectedVoucher.voucherDate), "MMM dd, yyyy")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Type</p>
                  <Badge variant={getVoucherTypeBadgeVariant(selectedVoucher.voucherType)}>
                    {selectedVoucher.voucherType}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p className="font-mono font-bold text-lg">
                    ${parseFloat(selectedVoucher.totalAmount).toFixed(2)}
                  </p>
                </div>
              </div>
              {selectedVoucher.description && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{selectedVoucher.description}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Voucher Dialog */}
      <Dialog 
        open={editDialogOpen} 
        onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            // Reset initialization flag when dialog closes
            setEditFormInitialized(false);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Voucher</DialogTitle>
            <DialogDescription>
              Update voucher metadata and entry amounts. Debits must equal credits.
            </DialogDescription>
          </DialogHeader>
          {voucherToEdit && (
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(handleSaveEdit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Voucher Number</p>
                    <p className="font-mono font-medium">{voucherToEdit.voucherNumber}</p>
                  </div>
                  
                  <FormField
                    control={editForm.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            data-testid="input-edit-voucher-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="voucherType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-voucher-type">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Sales">Sales</SelectItem>
                            <SelectItem value="Purchase">Purchase</SelectItem>
                            <SelectItem value="Payment">Payment</SelectItem>
                            <SelectItem value="Receipt">Receipt</SelectItem>
                            <SelectItem value="Journal">Journal</SelectItem>
                            <SelectItem value="Contra">Contra</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={editForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Optional"
                            data-testid="input-edit-voucher-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Entries Section */}
                <div className="border rounded-md p-4 space-y-2">
                  <h3 className="font-semibold text-sm mb-3">Voucher Entries</h3>
                  
                  {entriesLoading ? (
                    <div className="space-y-2">
                      {[1, 2].map((i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {voucherEntries.map((entry, index) => (
                          <div key={entry.id} className="grid grid-cols-12 gap-2 items-start border rounded p-3">
                            <div className="col-span-6">
                              <p className="text-sm font-medium">{entry.accountName}</p>
                              <p className="text-xs text-muted-foreground">
                                {entry.accountCode} • {entry.accountType}
                              </p>
                            </div>
                            
                            <div className="col-span-3">
                              <FormField
                                control={editForm.control}
                                name={`entries.${index}.debitAmount`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Debit</FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        className="font-mono text-sm"
                                        data-testid={`input-debit-${index}`}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            
                            <div className="col-span-3">
                              <FormField
                                control={editForm.control}
                                name={`entries.${index}.creditAmount`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Credit</FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        className="font-mono text-sm"
                                        data-testid={`input-credit-${index}`}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {/* Totals and Balance Check */}
                      {editForm.watch("entries") && editForm.watch("entries").length > 0 && (
                        <div className="mt-4 pt-3 border-t">
                          <div className="grid grid-cols-2 gap-4 text-sm font-mono">
                            <div className="text-right">
                              <span className="text-muted-foreground mr-2">Total Debits:</span>
                              <span className="font-bold">
                                ${editForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.debitAmount || "0"), 0).toFixed(2)}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-muted-foreground mr-2">Total Credits:</span>
                              <span className="font-bold">
                                ${editForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.creditAmount || "0"), 0).toFixed(2)}
                              </span>
                            </div>
                          </div>
                          {editForm.formState.errors.entries && (
                            <p className="text-sm text-destructive mt-2 text-center">
                              {editForm.formState.errors.entries.message}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditDialogOpen(false)}
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={editMutation.isPending || entriesLoading}
                    data-testid="button-save-edit"
                  >
                    {editMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete voucher{" "}
              <span className="font-mono font-semibold">{voucherToDelete?.voucherNumber}</span>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
