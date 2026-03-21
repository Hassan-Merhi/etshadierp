import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  lastResetKey?: string;
  isChunkError: boolean;
}

function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const msg =
    (error as any)?.message ||
    (error as any)?.toString?.() ||
    String(error);
  return (
    msg.includes("dynamically imported module") ||
    msg.includes("Failed to fetch") ||
    msg.includes("Loading chunk") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("Unable to preload CSS") ||
    (error as any)?.name === "ChunkLoadError" ||
    // Vite chunk URL pattern: ends with a hashed .js filename
    /\/assets\/[^/]+-[A-Za-z0-9_-]+\.js/.test(msg)
  );
}

// Hard navigation — forces the browser to re-fetch the HTML + new chunk URLs.
function hardNavigate(path: string) {
  window.location.href = path + (path.includes("?") ? "&" : "?") + "_r=" + Date.now();
}

// Per-page reload guard: allow one auto-reload per pathname.
function hasAutoReloaded(path: string): boolean {
  try {
    return sessionStorage.getItem("chunkReload:" + path) === "1";
  } catch {
    return false;
  }
}

function markAutoReloaded(path: string) {
  try {
    sessionStorage.setItem("chunkReload:" + path, "1");
  } catch { /* ignore */ }
}

function clearAutoReloaded(path: string) {
  try {
    sessionStorage.removeItem("chunkReload:" + path);
  } catch { /* ignore */ }
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      lastResetKey: props.resetKey,
      isChunkError: false,
    };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return {
      hasError: true,
      error: error instanceof Error ? error : new Error(String(error)),
      isChunkError: isChunkLoadError(error),
    };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) {
      return {
        hasError: false,
        error: null,
        lastResetKey: props.resetKey,
        isChunkError: false,
      };
    }
    return null;
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);

    if (isChunkLoadError(error)) {
      const path = window.location.pathname;
      if (!hasAutoReloaded(path)) {
        markAutoReloaded(path);
        hardNavigate(path);
      }
    }
  }

  handleReload = () => {
    clearAutoReloaded(window.location.pathname);
    hardNavigate(window.location.pathname);
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, isChunkError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.state.isChunkError) {
        return (
          <div className="flex flex-col items-center justify-center h-full min-h-[40vh] gap-4 p-6 text-center">
            <RefreshCw className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-semibold text-lg">New version available</p>
              <p className="text-sm text-muted-foreground mt-1">
                The app was updated. Please reload to get the latest version.
              </p>
            </div>
            <Button onClick={this.handleReload}>
              Reload page
            </Button>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[40vh] gap-4 p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-semibold text-lg">Something went wrong on this page</p>
            <p className="text-sm text-muted-foreground mt-1">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.handleReset}>
              Try again
            </Button>
            <Button variant="ghost" onClick={() => window.history.back()}>
              Go back
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
