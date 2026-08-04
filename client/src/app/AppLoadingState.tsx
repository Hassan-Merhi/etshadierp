import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/page-state";

interface AppLoadingStateProps {
  message?: string;
}

const STARTUP_TIMEOUT_MS = 12_000;

function reloadWithFreshAssets() {
  const url = new URL(window.location.href);
  url.searchParams.set("_startup_recovery", Date.now().toString());
  window.location.replace(url.toString());
}

export function AppLoadingState({ message = "Loading application" }: AppLoadingStateProps) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), STARTUP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (timedOut) {
    return (
      <ErrorState
        className="h-full min-h-64 border-0 bg-transparent"
        title="Application loading took too long"
        description="The browser may be using outdated company or application data. Reload with fresh files to continue."
        actionLabel="Reload application"
        onAction={reloadWithFreshAssets}
        secondaryActionLabel="Go to sign in"
        onSecondaryAction={() => window.location.assign("/login")}
      />
    );
  }

  return (
    <LoadingState
      className="h-full min-h-64 border-0 bg-transparent"
      title={message}
      description="Preparing your workspace and latest company information."
    />
  );
}
