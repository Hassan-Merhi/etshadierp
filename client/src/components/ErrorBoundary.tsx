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

function isChunkLoadError(error: Error): boolean {
  return (
    error.message.includes("dynamically imported module") ||
    error.message.includes("Failed to fetch") ||
    error.name === "ChunkLoadError" ||
    error.message.includes("Loading chunk") ||
    error.message.includes("Importing a module script failed")
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, lastResetKey: props.resetKey, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) {
      return { hasError: false, error: null, lastResetKey: props.resetKey, isChunkError: false };
    }
    return null;
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);

    if (isChunkLoadError(error)) {
      const RELOAD_KEY = "chunkErrorAutoReload";
      const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY);
      if (!alreadyReloaded) {
        sessionStorage.setItem(RELOAD_KEY, "1");
        window.location.reload();
      }
    }
  }

  handleReload = () => {
    sessionStorage.removeItem("chunkErrorAutoReload");
    window.location.reload();
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
                The app was updated. Please reload the page to get the latest version.
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
