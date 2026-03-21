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

// Check every possible place the chunk error text might live
function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const candidates: string[] = [];
  if (typeof error === "string") {
    candidates.push(error);
  } else if (error && typeof error === "object") {
    const e = error as any;
    if (e.message)     candidates.push(String(e.message));
    if (e.stack)       candidates.push(String(e.stack));
    if (e.name)        candidates.push(String(e.name));
    // toString fallback
    try { candidates.push(e.toString()); } catch { /* ignore */ }
  }
  const combined = candidates.join(" ");
  return (
    combined.includes("dynamically imported module") ||
    combined.includes("Loading chunk") ||
    combined.includes("Importing a module script failed") ||
    combined.includes("Unable to preload CSS") ||
    combined.includes("ChunkLoadError") ||
    (error as any)?.name === "ChunkLoadError" ||
    // Vite chunk URL pattern inside any field
    /\/assets\/[^/]+-[A-Za-z0-9_-]+\.js/.test(combined)
  );
  // NOTE: we intentionally do NOT match bare "Failed to fetch" because that
  // also fires for failed API requests and would cause false positives.
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
    const isChunk = isChunkLoadError(error);
    // Normalise to Error so we can display the message
    let normalized: Error;
    if (error instanceof Error) {
      normalized = error;
    } else {
      // Build a useful message from whatever we received
      const msg =
        (error as any)?.message ||
        (error as any)?.stack?.split?.("\n")?.[0] ||
        String(error);
      normalized = new Error(msg || "Unknown error");
    }
    return { hasError: true, error: normalized, isChunkError: isChunk };
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
      // Double-check in render: the stored error message might have survived even
      // if getDerivedStateFromError couldn't classify it correctly.
      const isChunk =
        this.state.isChunkError ||
        isChunkLoadError(this.state.error) ||
        // Fallback: inspect the displayed message directly
        (this.state.error?.message ?? "").includes("dynamically imported module") ||
        (this.state.error?.message ?? "").includes("Loading chunk") ||
        /\/assets\/[^/]+-[A-Za-z0-9_-]+\.js/.test(this.state.error?.message ?? "");

      if (isChunk) {
        return (
          <div className="flex flex-col items-center justify-center h-full min-h-[40vh] gap-4 p-6 text-center">
            <RefreshCw className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-semibold text-lg">New version available</p>
              <p className="text-sm text-muted-foreground mt-1">
                The app was updated. Click below to reload and get the latest version.
              </p>
            </div>
            <Button onClick={this.handleReload} data-testid="button-reload-chunk">
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
            <Button variant="outline" onClick={this.handleReset} data-testid="button-try-again">
              Try again
            </Button>
            <Button variant="ghost" onClick={() => window.history.back()} data-testid="button-go-back">
              Go back
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
