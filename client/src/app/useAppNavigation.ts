import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { getParentRoute } from "@/lib/parent-routes";
import { useGlobalScrollKeys } from "./useGlobalScrollKeys";

declare global {
  interface Window {
    __escBackGuard?: () => boolean;
    __escBackConfirm?: () => void;
  }
}

function getSupplierPartnerParent(pathname: string): string | null {
  const cleanPath = pathname.split("?")[0].split("#")[0];

  if (cleanPath === "/sp/reports") return "/sp";
  if (cleanPath === "/sp/opening-stock") return "/sp";
  if (cleanPath === "/sp/aliases") return "/sp";
  if (cleanPath === "/sp/setup") return "/sp";
  if (cleanPath === "/sp/migration" || cleanPath === "/sp/gc-migration") {
    return "/sp/setup?tab=migration";
  }

  return null;
}

/**
 * Manages app-level navigation state:
 *   - Leave-confirmation dialog (triggered when __escBackGuard is active)
 *   - navigateToParent / handleGoBack / handleConfirmLeave callbacks
 *   - Global arrow / PageUp / PageDown / Home / End / Escape key handling
 *     via useGlobalScrollKeys
 */
export function useAppNavigation() {
  const [, setLocation] = useLocation();
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const navigateToParent = useCallback(() => {
    const pathname = window.location.pathname;
    const parent = getSupplierPartnerParent(pathname) ?? getParentRoute(pathname);
    if (parent) {
      setLocation(parent);
    } else if (window.history.length > 1) {
      window.history.back();
    }
  }, [setLocation]);

  const handleGoBack = useCallback(() => {
    if (window.__escBackGuard && window.__escBackGuard()) {
      setShowLeaveConfirm(true);
      return;
    }
    navigateToParent();
  }, [navigateToParent]);

  const handleConfirmLeave = useCallback(() => {
    setShowLeaveConfirm(false);
    if (window.__escBackConfirm) {
      window.__escBackConfirm();
    }
    navigateToParent();
  }, [navigateToParent]);

  useGlobalScrollKeys(handleGoBack);

  return { showLeaveConfirm, setShowLeaveConfirm, handleGoBack, handleConfirmLeave };
}
