import { useEffect } from "react";
import type { RemoteControlSessionView } from "@/hooks/use-remote-control-session";
import {
  applyRemoteKeyboardCommand,
  clearRemoteEditableFocus,
  noteTrustedLocalRemoteControlInteraction,
  type RemoteKeyboardCommandView,
  type RemoteKeyboardExecutionResult,
} from "@/hooks/remote-keyboard-control-policy";

const MAX_COMMAND_AGE_MS = 8000;

function parseCommand(value: unknown): RemoteKeyboardCommandView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = value as Partial<RemoteKeyboardCommandView>;
  if (
    !command.id ||
    !command.sessionId ||
    (command.type !== "insert-text" && command.type !== "key") ||
    typeof command.sequence !== "number" ||
    typeof command.shiftKey !== "boolean"
  ) {
    return null;
  }
  return command as RemoteKeyboardCommandView;
}

async function reportResult(
  sessionId: string,
  tabId: string,
  commandId: string,
  result: RemoteKeyboardExecutionResult
): Promise<void> {
  try {
    await fetch(
      `/api/screen-feed/control/sessions/${encodeURIComponent(sessionId)}/keyboard-commands/${encodeURIComponent(commandId)}/result`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabId,
          status: result.status,
          reason: result.reason,
        }),
      }
    );
  } catch {
    // The session heartbeat or next command will reconcile transport state.
  }
}

export function RemoteKeyboardControlTarget({
  session,
  tabId,
}: {
  session: RemoteControlSessionView | null;
  tabId: string;
}) {
  useEffect(() => {
    if (!session || !session.capabilities.keyboard || session.targetTabId !== tabId) {
      clearRemoteEditableFocus();
      return;
    }

    const onTrustedLocalInteraction = (event: Event) => {
      if (event.isTrusted) noteTrustedLocalRemoteControlInteraction();
    };
    document.addEventListener("pointerdown", onTrustedLocalInteraction, true);
    document.addEventListener("keydown", onTrustedLocalInteraction, true);
    document.addEventListener("beforeinput", onTrustedLocalInteraction, true);
    document.addEventListener("input", onTrustedLocalInteraction, true);

    let eventSource: EventSource | null = null;
    try {
      const params = new URLSearchParams({ sessionId: session.id, tabId });
      eventSource = new EventSource(`/api/screen-feed/control/keyboard-commands?${params.toString()}`, {
        withCredentials: true,
      });
      eventSource.addEventListener("command", (event) => {
        let command: RemoteKeyboardCommandView | null = null;
        try {
          command = parseCommand(JSON.parse((event as MessageEvent<string>).data));
        } catch {
          command = null;
        }
        if (!command || command.sessionId !== session.id) return;

        const createdAt = command.createdAt ? new Date(command.createdAt).getTime() : Date.now();
        const result =
          !Number.isFinite(createdAt) || Date.now() - createdAt > MAX_COMMAND_AGE_MS
            ? { status: "ignored" as const, reason: "stale-command" }
            : applyRemoteKeyboardCommand(command);
        void reportResult(session.id, tabId, command.id, result);
      });
    } catch {
      eventSource = null;
    }

    return () => {
      eventSource?.close();
      document.removeEventListener("pointerdown", onTrustedLocalInteraction, true);
      document.removeEventListener("keydown", onTrustedLocalInteraction, true);
      document.removeEventListener("beforeinput", onTrustedLocalInteraction, true);
      document.removeEventListener("input", onTrustedLocalInteraction, true);
      clearRemoteEditableFocus();
    };
  }, [session, tabId]);

  return null;
}
