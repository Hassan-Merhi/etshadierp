import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import GITContainers from "@/pages/GITContainers";
import GITMockup from "@/pages/GITMockup";

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
          </TabsList>

          <TabsContent value="containers-otw" className="flex-1 overflow-hidden m-0 p-0">
            <GITContainers embedded />
          </TabsContent>

          <TabsContent value="git-tracking" className="flex-1 overflow-hidden m-0 p-0">
            <GITMockup embedded />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
