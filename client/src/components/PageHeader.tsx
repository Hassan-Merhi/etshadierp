import { Button } from "@/components/ui/button";
import { ArrowLeft, Home } from "lucide-react";
import { Link } from "wouter";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showBackButton?: boolean;
  showHomeButton?: boolean;
  children?: React.ReactNode;
}

export function PageHeader({ 
  title, 
  subtitle, 
  showBackButton = true, 
  showHomeButton = true,
  children 
}: PageHeaderProps) {
  const handleBack = () => {
    window.history.back();
  };

  return (
    <div className="flex flex-col gap-2 mb-4" data-testid="page-header">
      <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
        {showBackButton && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleBack}
            className="gap-1"
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
              className="gap-1"
              data-testid="button-home"
            >
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
          </Link>
        )}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold truncate" data-testid="text-page-title">{title}</h1>
          {subtitle && (
            <p className="text-muted-foreground text-xs sm:text-sm truncate" data-testid="text-page-subtitle">{subtitle}</p>
          )}
        </div>
        {children && (
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap shrink-0">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
