import { Input } from "@/components/ui/input";
import { TableCell } from "@/components/ui/table";
import type { Container } from "@shared/schema";

interface OtwEditableCellProps {
  container: Container;
  field: keyof Container;
  fieldIndex: number;
  placeholder?: string;
  type?: "text" | "date" | "number";
  minCh?: number;
  maxCh?: number;
  testId: string;
  getEditValue: (container: Container, field: keyof Container) => any;
  setEditValue: (id: number, field: keyof Container, value: any) => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent, id: number, fieldIdx: number) => void;
  autoSizeStyle: (value: unknown, placeholder?: string, minCh?: number, maxCh?: number) => React.CSSProperties;
}

export function OtwEditableCell({
  container,
  field,
  fieldIndex,
  placeholder,
  type = "text",
  minCh,
  maxCh,
  testId,
  getEditValue,
  setEditValue,
  handleKeyDown,
  autoSizeStyle,
}: OtwEditableCellProps) {
  const value = (getEditValue(container, field) as string) || "";
  return (
    <TableCell>
      <Input
        id={`tracking-${container.id}-${field}`}
        type={type}
        value={value}
        onChange={(e) => setEditValue(container.id, field, e.target.value)}
        onKeyDown={(e) => handleKeyDown(e, container.id, fieldIndex)}
        style={autoSizeStyle(getEditValue(container, field), placeholder, minCh, maxCh)}
        className="h-8 text-sm w-auto"
        placeholder={placeholder}
        data-testid={testId}
      />
    </TableCell>
  );
}
