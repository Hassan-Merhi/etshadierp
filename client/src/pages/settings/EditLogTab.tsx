import { History, Clock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AuditLog } from "./AuditLog";

interface EditLogTabProps {
  selectedCompany: any;
}

export function EditLogTab({ selectedCompany }: EditLogTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">Edit Log</h2>
      </div>
      <p className="text-muted-foreground">
        Track all changes made to records across the system with before/after values.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Recent Changes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLog />
        </CardContent>
      </Card>
    </div>
  );
}
