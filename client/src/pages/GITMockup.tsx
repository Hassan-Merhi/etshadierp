/**
 * GIT — Goods In Transit Workbook
 * Spreadsheet-style replacement for the daily GIT Excel sheet.
 *
 * Tabs:
 *   1. GIT Detail        — Workbook View (grouped by company) + Flat Table toggle
 *   2. Truck / Location  — grouped by transporter (with truck) + no-truck section
 *   3. Agent / Duty      — FIFO duty allocation per agent
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { TabDetail } from "./git-mockup/TabDetail";
import { TabTruckLocation } from "./git-mockup/TabTruckLocation";
import { TabAgentDuty } from "./git-mockup/TabAgentDuty";

export default function GITMockup({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!embedded && <PageHeader title="GIT" subtitle="Daily goods-in-transit workbook — spreadsheet replacement" />}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Tabs defaultValue="detail">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="detail" data-testid="tab-git-detail">
              Detail
            </TabsTrigger>
            <TabsTrigger value="trucks" data-testid="tab-git-trucks">
              Truck / Location
            </TabsTrigger>
            <TabsTrigger value="agents" data-testid="tab-git-agents">
              Agent / Duty
            </TabsTrigger>
          </TabsList>

          <TabsContent value="detail" className="mt-4">
            <TabDetail />
          </TabsContent>

          <TabsContent value="trucks" className="mt-4">
            <TabTruckLocation />
          </TabsContent>

          <TabsContent value="agents" className="mt-4">
            <TabAgentDuty />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
