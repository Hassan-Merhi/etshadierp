import { Plus, Building2, Search, Edit, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ParentCreditAccountSelect } from "./ParentCreditAccountSelect";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { UseFormReturn } from "react-hook-form";
import { UseMutationResult } from "@tanstack/react-query";

interface CompaniesTabProps {
  companies: any[];
  isLoadingCompanies: boolean;
  isCompanyDialogOpen: boolean;
  setIsCompanyDialogOpen: (open: boolean) => void;
  editingCompany: any;
  setEditingCompany: (company: any) => void;
  companyForm: UseFormReturn<any>;
  handleSubmitCompany: (data: any) => void;
  createCompanyMutation: UseMutationResult<any, any, any>;
  companySearch: string;
  setCompanySearch: (q: string) => void;
  companyToDelete: any;
  setCompanyToDelete: (company: any) => void;
  deleteCompanyMutation: UseMutationResult<any, any, any>;
  handleEditCompany: (company: any) => void;
}

export function CompaniesTab({
  companies,
  isLoadingCompanies,
  isCompanyDialogOpen,
  setIsCompanyDialogOpen,
  editingCompany,
  setEditingCompany,
  companyForm,
  handleSubmitCompany,
  createCompanyMutation,
  companySearch,
  setCompanySearch,
  companyToDelete,
  setCompanyToDelete,
  deleteCompanyMutation,
  handleEditCompany,
}: CompaniesTabProps) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Company Management
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {companies.length} {companies.length === 1 ? "company" : "companies"} configured
          </p>
        </div>
        <Dialog open={isCompanyDialogOpen} onOpenChange={setIsCompanyDialogOpen}>
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setEditingCompany(null);
                companyForm.reset({ name: "", code: "", companyType: "erp", active: true });
              }}
              data-testid="button-add-company"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Company
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingCompany ? "Edit Company" : "Create New Company"}</DialogTitle>
            </DialogHeader>
            <Form {...companyForm}>
              <form onSubmit={companyForm.handleSubmit(handleSubmitCompany)} className="space-y-4" noValidate>
                <FormField
                  control={companyForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="ABC Textiles Inc." data-testid="input-company-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={companyForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Code *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="ABC" data-testid="input-company-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={companyForm.control}
                  name="companyType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "erp"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-company-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="erp">Normal ERP</SelectItem>
                          <SelectItem value="factory">Factory Production</SelectItem>
                          <SelectItem value="properties">Properties</SelectItem>
                          <SelectItem value="supplier_partner">Supplier Partner</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={companyForm.control}
                    name="baseCurrency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Base Currency</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "USD"}>
                          <FormControl>
                            <SelectTrigger data-testid="select-base-currency">
                              <SelectValue placeholder="Select currency" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={companyForm.control}
                    name="displayCurrency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Display Currency</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "none"}>
                          <FormControl>
                            <SelectTrigger data-testid="select-display-currency">
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="CFA">CFA</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={companyForm.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-company-active" />
                      </FormControl>
                      <FormLabel className="!mt-0">Active</FormLabel>
                    </FormItem>
                  )}
                />
                {editingCompany && (
                  <div className="border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Parent Credit Account</p>
                    <ParentCreditAccountSelect company={editingCompany} />
                  </div>
                )}
                <div className="flex gap-2 justify-end border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setIsCompanyDialogOpen(false); setEditingCompany(null); }}
                    disabled={createCompanyMutation.isPending}
                    data-testid="button-cancel-company"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createCompanyMutation.isPending} data-testid="button-save-company">
                    {createCompanyMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      {companies.length > 3 && (
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search companies…"
            value={companySearch}
            onChange={e => setCompanySearch(e.target.value)}
            className="pl-9"
            data-testid="input-company-search"
          />
        </div>
      )}

      {/* Cards */}
      {isLoadingCompanies ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="h-36 rounded-md border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/30" />
          <div>
            <p className="font-medium text-muted-foreground">No companies yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Click "Add Company" above to create your first one.</p>
          </div>
        </div>
      ) : (() => {
        const q = companySearch.toLowerCase();
        const filtered = companies.filter((c: any) =>
          !q || c.name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q)
        );

        if (filtered.length === 0) {
          return (
            <p className="text-sm text-muted-foreground text-center py-10">
              No companies match "<span className="font-medium">{companySearch}</span>"
            </p>
          );
        }

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((company: any) => {
              const isFactory = company.companyType === "factory" || company.companyType === "factory_v2";
              const isProperties = company.companyType === "properties";
              const typeLabel = isFactory ? "Factory" : isProperties ? "Properties" : "ERP";

              const accentClass = isFactory
                ? "bg-orange-500"
                : isProperties
                ? "bg-green-500"
                : "bg-indigo-500";

              const typeBadgeClass = isFactory
                ? "border-orange-200 text-orange-700 bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:bg-orange-950"
                : isProperties
                ? "border-green-200 text-green-700 bg-green-50 dark:border-green-800 dark:text-green-300 dark:bg-green-950"
                : "border-indigo-200 text-indigo-700 bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:bg-indigo-950";

              return (
                <div
                  key={company.id}
                  className="rounded-md border bg-card flex flex-col overflow-hidden"
                  data-testid={`card-company-${company.id}`}
                >
                  {/* Colored top accent bar */}
                  <div className={`h-1.5 w-full ${accentClass}`} />

                  <div className="flex flex-col gap-3 p-4 flex-1">
                    {/* Name + badges */}
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className="font-semibold text-base leading-tight"
                        data-testid={`text-company-name-${company.id}`}
                      >
                        {company.name}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${typeBadgeClass}`}
                          data-testid={`text-company-type-${company.id}`}>
                          {typeLabel}
                        </span>
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                          company.active
                            ? "border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950"
                            : "border-border text-muted-foreground bg-muted"
                        }`}
                          data-testid={`text-company-status-${company.id}`}>
                          {company.active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>

                    {/* Currency row */}
                    <p className="text-xs text-muted-foreground">
                      {company.baseCurrency || "USD"}
                      {company.displayCurrency && company.displayCurrency !== "none"
                        ? ` · ${company.displayCurrency}`
                        : ""}
                    </p>
                  </div>

                  {/* Action footer */}
                  <div className="border-t px-4 py-2 flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleEditCompany(company)}
                      data-testid={`button-edit-company-${company.id}`}
                      title="Edit company"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setCompanyToDelete(company)}
                      data-testid={`button-delete-company-${company.id}`}
                      title="Delete company"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Delete confirmation */}
      <AlertDialog open={!!companyToDelete} onOpenChange={(open) => !open && setCompanyToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Company</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Are you sure you want to delete <strong>{companyToDelete?.name}</strong>?</p>
                <p className="text-destructive font-medium">This will permanently delete ALL data associated with this company, including:</p>
                <ul className="list-disc list-inside text-sm space-y-1 ml-2">
                  <li>All locations and inventory</li>
                  <li>All ledger accounts and bank accounts</li>
                  <li>All vouchers and transactions</li>
                  <li>All purchase orders and containers</li>
                  <li>All employees and customers</li>
                  <li>All user role assignments for this company</li>
                </ul>
                <p className="font-bold text-destructive mt-2">This action cannot be undone!</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-company">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => companyToDelete && deleteCompanyMutation.mutate(companyToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteCompanyMutation.isPending}
              data-testid="button-confirm-delete-company"
            >
              {deleteCompanyMutation.isPending ? "Deleting..." : "Delete Company"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
