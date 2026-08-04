import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  noun?: string;
}

export function PaginationBar({ page, totalPages, total, pageSize, onPageChange, noun }: PaginationBarProps) {
  if (total <= pageSize && totalPages <= 1) return null;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm text-muted-foreground">
      <span>
        {first.toLocaleString()}–{last.toLocaleString()} / {total.toLocaleString()}
        {noun ? ` ${noun}` : ""}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page <= 1}
          aria-label={String(previousPage)}
          onClick={() => onPageChange(previousPage)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-20 text-center">
          {page} / {Math.max(1, totalPages)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page >= totalPages}
          aria-label={String(nextPage)}
          onClick={() => onPageChange(nextPage)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
