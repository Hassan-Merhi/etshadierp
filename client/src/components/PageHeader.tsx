import { Button } from "@/components/ui/button";
import { ArrowLeft, Home, ChevronUp, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { useCursorNav } from "@/contexts/CursorNavContext";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showBackButton?: boolean;
  showHomeButton?: boolean;
  showCursorNavButtons?: boolean;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  showBackButton = true,
  showHomeButton = true,
  showCursorNavButtons = true,
  children,
}: PageHeaderProps) {
  const { config } = useCursorNav();

  const handleBack = () => {
    window.history.back();
  };

  const hasNav = showBackButton || showHomeButton || (showCursorNavButtons && !!config);

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
          {showHomeButton && (
            <Link href="/">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground hover:text-foreground"
                data-testid="button-home"
              >
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Button>
            </Link>
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
        <div className="min-w-0 flex-1">
          <h1
            className="text-xl sm:text-2xl font-semibold tracking-tight truncate"
            data-testid="text-page-title"
          >
            {title}
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
