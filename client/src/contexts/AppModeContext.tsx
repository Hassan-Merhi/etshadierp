import { createContext, useContext } from "react";
import type { AppMode } from "@/lib/factoryApi";

const AppModeContext = createContext<AppMode>("erp");

export function AppModeProvider({ mode, children }: { mode: AppMode; children: React.ReactNode }) {
  return <AppModeContext.Provider value={mode}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppMode {
  return useContext(AppModeContext);
}

export function getModePrefix(mode: AppMode): string {
  if (mode === "factory") return "/factory";
  if ((mode as string) === "properties") return "/properties";
  return "";
}

export function useModePrefix(): string {
  return getModePrefix(useContext(AppModeContext));
}
