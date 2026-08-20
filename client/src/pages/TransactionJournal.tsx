/**
 * All Daybook (TransactionJournal) page shell.
 *
 * Keeps its route and default export; the filter state, cross-company query,
 * pagination and detail lookups live in ./transactionjournal —
 * useTransactionJournalModel — and the views under
 * ./transactionjournal/components render it.
 */
import { FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactionJournalModel } from "./transactionjournal/useTransactionJournalModel";
import { TransactionJournalFilterControls } from "./transactionjournal/components/TransactionJournalFilterControls";
import { JournalSummaryCards } from "./transactionjournal/components/JournalOverview";
import { JournalVoucherList } from "./transactionjournal/components/JournalVoucherList";
import { JournalDetailDialog } from "./transactionjournal/components/JournalDetailDialog";

export default function TransactionJournal() {
  const model = useTransactionJournalModel();

  return (
    <div className="flex flex-col gap-4">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            All Daybook
            {model.isFetching && (
              <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin" data-testid="icon-refreshing" />
            )}
          </h1>
        </div>
        <Button
          variant="outline"
          size="default"
          onClick={() => model.refetch()}
          disabled={model.isFetching}
          data-testid="button-refresh-journal"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${model.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <TransactionJournalFilterControls
        filters={model.journalFilters}
        availableCompanies={model.availableCompanies}
        voucherTypes={model.voucherTypes}
        setFilter={model.setFilter}
        resetFilters={model.resetFilters}
        hasActiveFilters={model.hasActiveFilters}
      />
      <JournalSummaryCards model={model} />
      <JournalVoucherList model={model} />
      <JournalDetailDialog model={model} />
    </div>
  );
}
