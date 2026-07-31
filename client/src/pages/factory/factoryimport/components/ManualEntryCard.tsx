/**
 * ManualEntryCard — extracted sub-component.
 *
 * Extracted from FactoryImport.tsx during the Phase 4 god-file split.
 */
import {Plus, Trash2, X, Loader2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";

export function ManualEntryCard<T>({
  title,
  columns,
  rows,
  onAdd,
  onRemove,
  onChange,
  onSubmit,
  isPending,
  onBack,
  renderRow,
}: {
  title: string;
  columns: string[];
  rows: T[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onChange: (i: number, field: string, value: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  onBack: () => void;
  renderRow: (row: T, i: number, onChange: (i: number, field: string, value: string) => void) => JSX.Element;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">{title}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onBack} data-testid="button-back-manual">
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button variant="outline" onClick={onAdd} data-testid="button-add-row">
              <Plus className="h-4 w-4 mr-1" /> Add Row
            </Button>
            <Button onClick={onSubmit} disabled={isPending} data-testid="button-submit-manual">
              {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Import
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col}>{col}</TableHead>
                ))}
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  {renderRow(row, i, onChange)}
                  <TableCell>
                    {rows.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(i)}
                        data-testid={`button-remove-row-${i}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
