import "@/styles/mobile-performance.css";
import { useEffect } from "react";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { getBrowserConnection, getBrowserConnectionProfile } from "@/lib/mobilePerformance";

export function useMobilePerformanceLifecycle(): void {
  useEffect(() => {
    const root = document.documentElement;
    const connection = getBrowserConnection();

    const updateVisibility = () => {
      const visible = document.visibilityState !== "hidden";
      root.dataset.appVisibility = visible ? "visible" : "hidden";
      focusManager.setFocused(visible);
      window.dispatchEvent(new CustomEvent(visible ? "erp:app-visible" : "erp:app-hidden"));
    };

    const updateOnline = () => {
      onlineManager.setOnline(navigator.onLine);
      root.dataset.online = navigator.onLine ? "true" : "false";
    };

    const updateConnectionProfile = () => {
      const profile = getBrowserConnectionProfile();
      root.dataset.saveData = profile.saveData ? "true" : "false";
      root.dataset.effectiveConnection = profile.effectiveType;
      root.dataset.slowConnection = profile.slowConnection ? "true" : "false";
      window.dispatchEvent(new CustomEvent("erp:connection-profile", { detail: profile }));
    };

    updateVisibility();
    updateOnline();
    updateConnectionProfile();

    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("pageshow", updateVisibility);
    window.addEventListener("pagehide", updateVisibility);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    connection?.addEventListener?.("change", updateConnectionProfile);

    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("pageshow", updateVisibility);
      window.removeEventListener("pagehide", updateVisibility);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      connection?.removeEventListener?.("change", updateConnectionProfile);
      focusManager.setFocused(undefined);
    };
  }, []);
}
