interface AppLoadingStateProps {
  message?: string;
}

export function AppLoadingState({ message = "Loading..." }: AppLoadingStateProps) {
  return (
    <div
      className="flex items-center justify-center h-full"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
