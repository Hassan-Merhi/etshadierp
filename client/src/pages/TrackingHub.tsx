import { lazy, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

const GITContainers = lazy(() => import("@/pages/GITContainers"));
const GITMockup = lazy(() => import("@/pages/GITMockup"));
const TransporterStatement = lazy(() => import("@/pages/TransporterStatement"));

function TabFallback() {
  return (
    <div className="p-4 space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function TrackingHub() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Tracking" subtitle="Container tracking and GIT workbook" />

      <div className="flex-1 overflow-hidden flex flex-col px-4 pb-4">
        <Tabs defaultValue="containers-otw" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="w-fit mt-3 mb-2 shrink-0">
            <TabsTrigger value="containers-otw" data-testid="tab-tracking-containers-otw">
              Containers OTW
            </TabsTrigger>
            <TabsTrigger value="git-tracking" data-testid="tab-tracking-git">
              GIT Tracking
            </TabsTrigger>
            <TabsTrigger value="transporter-statement" data-testid="tab-tracking-transporter-statement">
              Transporter Statement
            </TabsTrigger>
          </TabsList>

          <TabsContent value="containers-otw" className="flex-1 overflow-hidden m-0 p-0">
            <Suspense fallback={<TabFallback />}>
              <GITContainers embedded />
            </Suspense>
          </TabsContent>

          <TabsContent value="git-tracking" className="flex-1 overflow-hidden m-0 p-0">
            <Suspense fallback={<TabFallback />}>
              <GITMockup embedded />
            </Suspense>
          </TabsContent>

          <TabsContent value="transporter-statement" className="flex-1 overflow-hidden m-0 p-0 pt-3">
            <Suspense fallback={<TabFallback />}>
              <TransporterStatement embedded />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
