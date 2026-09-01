/**
 * ImportModeChooser — extracted sub-component.
 *
 * Extracted from FactoryImport.tsx during the Phase 4 god-file split.
 */
import {Upload, Plus, Download} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {downloadTemplate} from "../utils";

export function ImportModeChooser({
  title,
  description,
  templateType,
  onFileUpload,
  onManual,
}: {
  title: string;
  description: string;
  templateType: string;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onManual: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover-elevate cursor-pointer" data-testid={`card-upload-${templateType}`}>
          <CardContent className="pt-6">
            <label className="flex flex-col items-center gap-3 cursor-pointer">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-medium">Upload CSV / Excel</p>
                <p className="text-sm text-muted-foreground mt-1">Upload a .csv or .xlsx file with your data</p>
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.txt"
                className="hidden"
                onChange={onFileUpload}
                data-testid={`input-file-${templateType}`}
              />
            </label>
          </CardContent>
        </Card>

        <Card className="hover-elevate cursor-pointer" onClick={onManual} data-testid={`card-manual-${templateType}`}>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-3">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-medium">Enter Manually</p>
                <p className="text-sm text-muted-foreground mt-1">Add records one by one using a form</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button
        variant="outline"
        onClick={() => downloadTemplate(templateType)}
        data-testid={`button-template-${templateType}`}
      >
        <Download className="h-4 w-4 mr-2" /> Download CSV Template
      </Button>
    </div>
  );
}
