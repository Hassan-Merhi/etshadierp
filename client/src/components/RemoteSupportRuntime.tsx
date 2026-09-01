import { Suspense, lazy, useEffect, useState } from "react";
import { usePresence } from "@/hooks/use-presence";
import { useScreenFeed } from "@/hooks/use-screen-feed";
import { isRemoteSupportAuthLost, subscribeRemoteSupportAuthLost } from "@/components/remote-support-auth-lifecycle";

const RemoteSupportIndicator = lazy(() =>
  import("@/components/RemoteSupportIndicator").then((module) => ({ default: module.RemoteSupportIndicator }))
);

function ScreenFeedCaptureRuntime() {
  usePresence(true);
  useScreenFeed();
  return null;
}

/**
 * Owns all authenticated remote-support browser work. A confirmed 401 tears
 * this subtree down, which closes presence and screen-feed timers, EventSource
 * connections, controller polling and command listeners together.
 *
 * Do not reset the process-wide auth-lost latch here. This component can remount
 * during route/company transitions while an expired session is redirecting to
 * login; resetting on remount would restart heartbeat loops against a session
 * that has already failed closed. A successful login performs a full navigation,
 * which naturally starts a fresh browser runtime/latch.
 */
export function RemoteSupportRuntime() {
  const [authAvailable, setAuthAvailable] = useState(() => !isRemoteSupportAuthLost());

  useEffect(() => subscribeRemoteSupportAuthLost(() => setAuthAvailable(false)), []);

  if (!authAvailable) return null;

  return (
    <>
      <ScreenFeedCaptureRuntime />
      <Suspense fallback={null}>
        <RemoteSupportIndicator />
      </Suspense>
    </>
  );
}
