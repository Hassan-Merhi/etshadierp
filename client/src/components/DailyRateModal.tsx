import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RefreshCw, TrendingUp } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { format } from "date-fns";

const rateFormSchema = z.object({
  rate: z
    .string()
    .min(1, "Rate is required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Rate must be a positive number",
    }),
});

type RateFormData = z.infer<typeof rateFormSchema>;

interface DailyRateModalProps {
  companyId: number;
}

export function DailyRateModal({ companyId }: DailyRateModalProps) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const [isOpen, setIsOpen] = useState(false);
  const [checkedCompanyId, setCheckedCompanyId] = useState<number | null>(null);

  const form = useForm<RateFormData>({
    resolver: zodResolver(rateFormSchema),
    defaultValues: {
      rate: "",
    },
  });

  const { data: company } = useQuery<any>({
    queryKey: [`/api/companies/${companyId}`],
    enabled: !!companyId,
  });

  const { data: todayRateCheck, isLoading: isCheckingRate } = useQuery<{ hasRate: boolean; latestRate?: any }>({
    queryKey: ["/api/exchange-rates/check-today", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/exchange-rates/check-today?companyId=${companyId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to check rate");
      return res.json();
    },
    enabled: !!companyId && !!company?.displayCurrency && company.displayCurrency !== "none",
  });

  useEffect(() => {
    if (!isCheckingRate && todayRateCheck && checkedCompanyId !== companyId) {
      setCheckedCompanyId(companyId);
      if (!todayRateCheck.hasRate && company?.displayCurrency && company.displayCurrency !== "none") {
        setIsOpen(true);
      }
    }
  }, [todayRateCheck, isCheckingRate, checkedCompanyId, companyId, company]);

  const createRateMutation = useMutation({
    mutationFn: async (data: RateFormData) => {
      return apiRequest("POST", "/api/exchange-rates", {
        fromCurrency: company?.baseCurrency,
        toCurrency: company?.displayCurrency,
        rate: data.rate,
        effectiveDate: format(new Date(), "yyyy-MM-dd"),
      });
    },
    onSuccess: async () => {
      toast({ title: "Today's exchange rate has been set" });
      queryClient.invalidateQueries({ queryKey: ["/api/exchange-rates"] });
      await queryClient.refetchQueries({ queryKey: ["/api/exchange-rates/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exchange-rates/check-today", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/balance-sheet"] });
      setIsOpen(false);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: RateFormData) => {
    createRateMutation.mutate(data);
  };

  const handleSkip = () => {
    setIsOpen(false);
  };

  if (!company?.displayCurrency || company.displayCurrency === "none") {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Set Today's Exchange Rate
          </DialogTitle>
          <DialogDescription>
            No exchange rate has been set for today. Please enter the current rate for {company?.baseCurrency} to{" "}
            {company?.displayCurrency}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {formatAmount(1)} {company?.baseCurrency} = X {company?.displayCurrency}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.01"
                      placeholder="e.g., 600"
                      autoFocus
                      data-testid="input-daily-rate"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={handleSkip} data-testid="button-skip-rate">
                Skip for Now
              </Button>
              <Button type="submit" disabled={createRateMutation.isPending} data-testid="button-save-daily-rate">
                {createRateMutation.isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                Set Rate
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
