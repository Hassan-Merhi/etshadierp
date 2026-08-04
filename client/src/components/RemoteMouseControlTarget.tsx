import { useEffect, useState } from "react";
import type { RemoteControlSessionView } from "@/hooks/use-remote-control-session";
import {
  applyRemoteMouseCommand,
  type RemoteMouseCommandView,
  type RemoteMouseExecutionResult,
} from "@/hooks/remote-mouse-control-policy";

interface RemotePointerState {
  x: number;
  y: number;
  visible: boolean;
  clickPulse: number;
}

const MAX_COMMAND_AGE_MS = 8000;

function parseCommand(value: unknown): RemoteMouseCommandView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = value as Partial<RemoteMouseCommandView>;
  if (
    !command.id ||
    !command.sessionId ||
    (command.type !== "pointer-move" && command.type !== "click" && command.type !== "scroll") ||
    typeof command.x !== "number" ||
    typeof command.y !== "number" ||
    typeof command.sequence !== "number"
  ) {
    return null;
  }
  return command as RemoteMouseCommandView;
}

async function reportCommandResult(
  sessionId: string,
  tabId: string,
  commandId: string,
  result: RemoteMouseExecutionResult
): Promise<void> {
  try {
    await fetch(
      `/api/screen-feed/control/sessions/${encodeURIComponent(sessionId)}/commands/${encodeURIComponent(commandId)}/result`,
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
    // A later command or the session heartbeat will reconcile connection state.
  }
}

export function RemoteMouseControlTarget({
  session,
  tabId,
}: {
  session: RemoteControlSessionView | null;
  tabId: string;
}) {
  const [pointer, setPointer] = useState<RemotePointerState>({
    x: 0.5,
    y: 0.5,
    visible: false,
    clickPulse: 0,
  });

  useEffect(() => {
    if (!session || !session.capabilities.mouse || session.targetTabId !== tabId) {
      setPointer((current) => ({ ...current, visible: false }));
      return;
    }

    let eventSource: EventSource | null = null;
    try {
      const params = new URLSearchParams({ sessionId: session.id, tabId });
      eventSource = new EventSource(`/api/screen-feed/control/commands?${params.toString()}`, {
        withCredentials: true,
      });
      eventSource.addEventListener("command", (event) => {
        let command: RemoteMouseCommandView | null = null;
        try {
          command = parseCommand(JSON.parse((event as MessageEvent<string>).data));
        } catch {
          command = null;
        }
        if (!command || command.sessionId !== session.id) return;

        const createdAt = command.createdAt ? new Date(command.createdAt).getTime() : Date.now();
        if (!Number.isFinite(createdAt) || Date.now() - createdAt > MAX_COMMAND_AGE_MS) {
          void reportCommandResult(session.id, tabId, command.id, {
            status: "ignored",
            reason: "stale-command",
            clientX: 0,
            clientY: 0,
          });
          return;
        }

        const result = applyRemoteMouseCommand(command);
        setPointer((current) => ({
          x: result.clientX,
          y: result.clientY,
          visible: true,
          clickPulse: command.type === "click" ? current.clickPulse + 1 : current.clickPulse,
        }));
        void reportCommandResult(session.id, tabId, command.id, result);
      });
      eventSource.onerror = () => {
        setPointer((current) => ({ ...current, visible: false }));
      };
    } catch {
      eventSource = null;
    }

    return () => {
      eventSource?.close();
      setPointer((current) => ({ ...current, visible: false }));
    };
  }, [session, tabId]);

  if (!session || !session.capabilities.mouse || !pointer.visible) return null;

  return (
    <div
      className="pointer-events-none fixed z-[2147483646]"
      style={{ left: pointer.x, top: pointer.y, transform: "translate(-2px, -2px)" }}
      aria-hidden="true"
      data-screenfeed-ignore="true"
      data-testid="remote-support-mouse-pointer"
    >
      <div className="relative h-5 w-5">
        <svg viewBox="0 0 24 24" className="h-5 w-5 drop-shadow" fill="none" aria-hidden="true">
          <path
            d="M4 3.5v14.8l4.2-4.1 2.8 6.3 3-1.4-2.8-6.1h5.9L4 3.5Z"
            fill="white"
            stroke="black"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        {pointer.clickPulse > 0 && (
          <span
            key={pointer.clickPulse}
            className="absolute -left-2 -top-2 h-7 w-7 animate-ping rounded-full border-2 border-primary/80"
          />
        )}
      </div>
    </div>
  );
}
