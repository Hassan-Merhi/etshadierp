import type { RemoteControlSessionView } from "@/hooks/use-remote-control-session";

export function shouldShowRemoteSupportIndicator(session: RemoteControlSessionView | null): boolean {
  return (
    !!session &&
    session.status === "active" &&
    (session.capabilities.mouse || session.capabilities.keyboard)
  );
}
