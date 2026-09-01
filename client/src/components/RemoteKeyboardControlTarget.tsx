import { useEffect, useRef } from "react";
import type { RemoteControlSessionView } from "@/hooks/use-remote-control-session";
import {
  applyRemoteKeyboardCommand,
  clearRemoteEditableFocus,
  noteTrustedLocalRemoteControlInteraction,
  type RemoteKeyboardCommandView,
  type RemoteKeyboardExecutionResult,
} from "@/hooks/remote-keyboard-control-policy";

const MAX_COMMAND_AGE_MS = 8000;
const MAX_SEEN_COMMANDS = 256;

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
  const seenCommandIdsRef = useRef(new Set<string>());
  const lastSequenceRef = useRef(0);
  const sessionId = session?.id ?? null;
  const targetTabId = session?.targetTabId ?? null;
  const keyboardEnabled = !!session?.capabilities.keyboard;

  useEffect(() => {
    seenCommandIdsRef.current.clear();
    lastSequenceRef.current = 0;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !keyboardEnabled || targetTabId !== tabId) {
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

    let closed = false;
    const params = new URLSearchParams({ sessionId, tabId });
    const eventSource = new EventSource(`/api/screen-feed/control/keyboard-commands?${params.toString()}`, {
      withCredentials: true,
    });

    eventSource.addEventListener("command", (event) => {
      if (closed) return;
      let command: RemoteKeyboardCommandView | null;
      try {
        command = parseCommand(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        command = null;
      }
      if (!command || command.sessionId !== sessionId) return;

      if (seenCommandIdsRef.current.has(command.id) || command.sequence <= lastSequenceRef.current) {
        void reportResult(sessionId, tabId, command.id, {
          status: "ignored",
          reason: "duplicate-command",
        });
        return;
      }

      seenCommandIdsRef.current.add(command.id);
      lastSequenceRef.current = Math.max(lastSequenceRef.current, command.sequence);
      if (seenCommandIdsRef.current.size > MAX_SEEN_COMMANDS) {
        const first = seenCommandIdsRef.current.values().next().value;
        if (first) seenCommandIdsRef.current.delete(first);
      }

      const createdAt = command.createdAt ? new Date(command.createdAt).getTime() : Date.now();
      const result =
        !Number.isFinite(createdAt) || Date.now() - createdAt > MAX_COMMAND_AGE_MS
          ? { status: "ignored" as const, reason: "stale-command" }
          : applyRemoteKeyboardCommand(command);
      void reportResult(sessionId, tabId, command.id, result);
    });

    return () => {
      closed = true;
      eventSource.close();
      document.removeEventListener("pointerdown", onTrustedLocalInteraction, true);
      document.removeEventListener("keydown", onTrustedLocalInteraction, true);
      document.removeEventListener("beforeinput", onTrustedLocalInteraction, true);
      document.removeEventListener("input", onTrustedLocalInteraction, true);
      clearRemoteEditableFocus();
    };
  }, [keyboardEnabled, sessionId, tabId, targetTabId]);

  return null;
}
