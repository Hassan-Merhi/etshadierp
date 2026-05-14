import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronUp, ChevronDown } from "lucide-react";
import { useCursorNav } from "@/contexts/CursorNavContext";

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Optional icon rendered inline next to the title. */
  icon?: React.ReactNode;
  showBackButton?: boolean;
  /** @deprecated — Dashboard button has been removed globally. This prop is kept for backward compatibility but has no effect. */
  showHomeButton?: boolean;
  showCursorNavButtons?: boolean;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  icon,
  showBackButton = true,
  showCursorNavButtons = true,
  children,
}: PageHeaderProps) {
  const { config } = useCursorNav();

  const handleBack = () => {
    window.history.back();
  };

  const hasNav = showBackButton || (showCursorNavButtons && !!config);

  return (
    <div className="flex flex-col gap-3 mb-5 pb-4 border-b border-border" data-testid="page-header">
      {hasNav && (
        <div className="flex items-center gap-1 flex-wrap -ml-2">
          {showBackButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="gap-1 text-muted-foreground hover:text-foreground"
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Button>
          )}

          {showCursorNavButtons && config && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={config.onUp}
                disabled={!config.canNavigateUp}
                data-testid="button-cursor-up"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={config.onDown}
                disabled={!config.canNavigateDown}
                data-testid="button-cursor-down"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1 border-l-[3px] border-primary pl-3">
          <h1
            className="text-xl sm:text-2xl font-bold tracking-tight truncate flex items-center gap-2"
            data-testid="text-page-title"
          >
            {icon && <span className="shrink-0 text-muted-foreground inline-flex">{icon}</span>}
            <span className="truncate">{title}</span>
          </h1>
          {subtitle && (
            <p
              className="mt-1 text-muted-foreground text-sm truncate"
              data-testid="text-page-subtitle"
            >
              {subtitle}
            </p>
          )}
        </div>
        {children && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
