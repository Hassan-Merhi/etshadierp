import { Suspense, lazy, useEffect, useState } from "react";
import { useScreenFeed } from "@/hooks/use-screen-feed";
import {
  resetRemoteSupportAuthLifecycle,
  subscribeRemoteSupportAuthLost,
} from "@/components/remote-support-auth-lifecycle";

const RemoteSupportIndicator = lazy(() =>
  import("@/components/RemoteSupportIndicator").then((module) => ({ default: module.RemoteSupportIndicator }))
);

function ScreenFeedCaptureRuntime() {
  useScreenFeed();
  return null;
}

/**
 * Owns all authenticated remote-support browser work. A confirmed 401 from the
 * control heartbeat tears this subtree down, which closes screen-feed timers,
 * EventSource connections, controller polling and command listeners together.
 */
export function RemoteSupportRuntime() {
  const [authAvailable, setAuthAvailable] = useState(true);

  useEffect(() => {
    resetRemoteSupportAuthLifecycle();
    setAuthAvailable(true);
    return subscribeRemoteSupportAuthLost(() => setAuthAvailable(false));
  }, []);

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
