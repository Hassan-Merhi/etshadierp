import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Upload, Download } from "lucide-react";
import { FileStorageTab } from "./FileStorageTab";
import { ExportAccountsSection } from "./ExportAccountsSection";

export function FileStorageAndExport() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="files">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="files" className="flex items-center gap-1.5" data-testid="tab-file-storage">
            <Upload className="h-3.5 w-3.5" />
            File Storage
          </TabsTrigger>
          <TabsTrigger value="export-accounts" className="flex items-center gap-1.5" data-testid="tab-export-accounts">
            <Download className="h-3.5 w-3.5" />
            Export Accounts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="mt-4">
          <FileStorageTab />
        </TabsContent>

        <TabsContent value="export-accounts" className="mt-4">
          <ExportAccountsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
