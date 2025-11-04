import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { Plus, Search, ArrowRightLeft, Building2 } from "lucide-react";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { insertInterCompanyTransferSchema, type InterCompanyTransfer, type Company } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { z } from "zod";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const formSchema = insertInterCompanyTransferSchema.extend({
  amount: z.string().min(1, "Amount is required"),
  transferDate: z.date(),
});

export default function InterCompanyTransfers() {
  const { toast } = useToast();
  const { companyId } = useCompany();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: transfers = [], isLoading } = useQuery<InterCompanyTransfer[]>({
    queryKey: ["/api/inter-company-transfers", companyId],
    enabled: !!companyId,
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fromCompanyId: companyId!,
      toCompanyId: 0,
      transferType: "Cash",
      amount: "",
      transferDate: new Date(),
      description: "",
      fromVoucherId: undefined,
      toVoucherId: undefined,
    },
  });

  // Reset form when company changes
  useEffect(() => {
    if (companyId) {
      form.reset({
        fromCompanyId: companyId,
        toCompanyId: 0,
        transferType: "Cash",
        amount: "",
        transferDate: new Date(),
        description: "",
        fromVoucherId: undefined,
        toVoucherId: undefined,
      });
    }
  }, [companyId, form]);

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      return await apiRequest("POST", "/api/inter-company-transfers", data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Inter-company transfer created with vouchers in both companies",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inter-company-transfers", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      setIsCreateOpen(false);
      form.reset({
        fromCompanyId: companyId!,
        toCompanyId: 0,
        transferType: "Cash",
        amount: "",
        transferDate: new Date(),
        description: "",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createMutation.mutate(data);
  };

  // Get company names for display
  const getCompanyName = (id: number) => {
    const company = companies.find(c => c.id === id);
    return company?.name || `Company #${id}`;
  };

  const filteredTransfers = transfers.filter((transfer) => {
    const fromCompany = getCompanyName(transfer.fromCompanyId);
    const toCompany = getCompanyName(transfer.toCompanyId);
    const query = searchQuery.toLowerCase();
    return (
      fromCompany.toLowerCase().includes(query) ||
      toCompany.toLowerCase().includes(query) ||
      transfer.description?.toLowerCase().includes(query) ||
      transfer.transferType.toLowerCase().includes(query)
    );
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const otherCompanies = companies.filter(c => c.id !== companyId);

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Inter-Company Transfers</h1>
          <p className="text-muted-foreground">Transfer money between related companies</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-transfer">
              <Plus className="mr-2 h-4 w-4" />
              New Transfer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Inter-Company Transfer</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="fromCompanyId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>From Company *</FormLabel>
                        <Select
                          value={field.value.toString()}
                          onValueChange={(value) => field.onChange(parseInt(value))}
                          disabled
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-from-company">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {companies.map((company) => (
                              <SelectItem key={company.id} value={company.id.toString()}>
                                {company.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="toCompanyId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>To Company *</FormLabel>
                        <Select
                          value={field.value ? field.value.toString() : ""}
                          onValueChange={(value) => field.onChange(parseInt(value))}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-to-company">
                              <SelectValue placeholder="Select company" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {otherCompanies.map((company) => (
                              <SelectItem key={company.id} value={company.id.toString()}>
                                {company.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="transferType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Transfer Type *</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-transfer-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Cash">Cash - Affects Cash accounts in both companies</SelectItem>
                          <SelectItem value="Loan">Loan - Creates Inter-Company Loan accounts</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {field.value === "Cash" 
                          ? "Cash transfer will debit FROM company's Cash and credit TO company's Cash"
                          : "Loan transfer creates IC loan accounts (FROM: IC Receivable, TO: IC Payable)"
                        }
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount *</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.01" placeholder="1000.00" data-testid="input-amount" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="transferDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Transfer Date *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-transfer-date"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, "PPP") : "Pick a date"}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Transfer for operational expenses..." data-testid="input-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateOpen(false)}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    data-testid="button-submit-transfer"
                  >
                    {createMutation.isPending ? "Creating..." : "Create Transfer"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transfers by company, type, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-transfers"
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>From Company</TableHead>
              <TableHead>To Company</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransfers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {searchQuery ? "No transfers found matching your search" : "No inter-company transfers yet"}
                </TableCell>
              </TableRow>
            ) : (
              filteredTransfers.map((transfer) => (
                <TableRow key={transfer.id} data-testid={`row-transfer-${transfer.id}`}>
                  <TableCell className="font-mono">
                    {format(new Date(transfer.transferDate), "yyyy-MM-dd")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {getCompanyName(transfer.fromCompanyId)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                      {getCompanyName(transfer.toCompanyId)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={transfer.transferType === "Cash" ? "default" : "secondary"}>
                      {transfer.transferType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    ${parseFloat(transfer.amount).toFixed(2)}
                  </TableCell>
                  <TableCell>{transfer.description || "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
