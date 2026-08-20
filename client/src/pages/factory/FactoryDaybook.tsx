/**
 * Factory Daybook page shell.
 *
 * The page keeps its original route/import path and default export; everything
 * it used to hold inline now lives under ./daybook — the controller hook
 * (state, queries, mutations, filters, exports), the filter bar, the condensed
 * table and the dialog stack. This file is only composition.
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AuditLog } from "@/pages/settings/AuditLog";
import { PageHeader } from "@/components/PageHeader";
import { ChevronDown, FileDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useFactoryDaybookModel } from "./daybook/useFactoryDaybookModel";
import { FactoryDaybookFilters } from "./daybook/FactoryDaybookFilters";
import { FactoryDaybookTable } from "./daybook/FactoryDaybookTable";
import { FactoryDaybookDialogs } from "./daybook/FactoryDaybookDialogs";

export default function FactoryDaybook() {
  const model = useFactoryDaybookModel();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader title="Factory Daybook" subtitle="All factory transactions in one view" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              disabled={model.filteredEntries.length === 0 || model.isExportingDetailed}
              data-testid="button-export-excel"
              className="gap-2"
            >
              <FileDown className="w-4 h-4" />
              {model.isExportingDetailed ? "Exporting..." : "Export"}
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={model.handleExportToExcel} data-testid="export-simple">
              Summary Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={model.handleExportDetailedToExcel} data-testid="export-detailed">
              Detailed Export (with entries)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tab selector: Transactions / Edits & Activity */}
      <Tabs
        value={model.activeDaybookTab}
        onValueChange={(value) => model.setActiveDaybookTab(value as "transactions" | "activity")}
      >
        <TabsList className="w-fit">
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="activity">Edits &amp; Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="space-y-4 mt-2">
          <FactoryDaybookFilters model={model} />
          <FactoryDaybookTable model={model} />
          <FactoryDaybookDialogs model={model} />
        </TabsContent>

        <TabsContent value="activity" className="mt-2">
          {model.activeDaybookTab === "activity" && <AuditLog context="daybook" defaultActions="all" />}
        </TabsContent>
      </Tabs>

      {model.AdminDialog}
    </div>
  );
}
