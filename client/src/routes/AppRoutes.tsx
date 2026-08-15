import { useEffect } from "react";
import { useLocation } from "wouter";
import { PosRoutes } from "./PosRoutes";
import { ErpRoutes } from "./ErpRoutes";

interface RouterProps {
  user: any;
  posImportEnabled?: boolean;
}

/**
 * Top-level route dispatcher.
 *
 * - Handles the legacy /pos → / redirect for POS users.
 * - Delegates to PosRoutes for user.role === "POS".
 * - Delegates to ErpRoutes for all other authenticated users.
 *
 * Named "Router" so App.tsx callers require no JSX changes after the import
 * path moves from an inline definition to this module.
 */
export function Router({ user, posImportEnabled }: RouterProps) {
  const isPOS = user?.role === "POS";
  const [_location, navigate] = useLocation();

  // Redirect legacy /pos URL to / for POS users
  useEffect(() => {
    if (isPOS && window.location.pathname === "/pos") {
      navigate("/");
    }
  }, [isPOS, navigate]);

  if (isPOS) {
    return <PosRoutes user={user} posImportEnabled={posImportEnabled} />;
  }

  return <ErpRoutes user={user} />;
}
