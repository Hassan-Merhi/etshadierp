import { LoadingState } from "@/components/ui/page-state";

interface AppLoadingStateProps {
  message?: string;
}

export function AppLoadingState({ message = "Loading application" }: AppLoadingStateProps) {
  return (
    <LoadingState
      className="h-full min-h-64 border-0 bg-transparent"
      title={message}
      description="Preparing your workspace and latest company information."
    />
  );
}
