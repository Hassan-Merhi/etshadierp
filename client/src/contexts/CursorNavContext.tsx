import { createContext, useContext, useState, useCallback } from "react";

interface CursorNavConfig {
  canNavigateUp: boolean;
  canNavigateDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onEnter?: () => void;
}

interface CursorNavContextValue {
  config: CursorNavConfig | null;
  registerCursorNav: (config: CursorNavConfig) => void;
  clearCursorNav: () => void;
}

const CursorNavContext = createContext<CursorNavContextValue>({
  config: null,
  registerCursorNav: () => {},
  clearCursorNav: () => {},
});

export function CursorNavProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<CursorNavConfig | null>(null);

  const registerCursorNav = useCallback((cfg: CursorNavConfig) => {
    setConfig(cfg);
  }, []);

  const clearCursorNav = useCallback(() => {
    setConfig(null);
  }, []);

  return (
    <CursorNavContext.Provider value={{ config, registerCursorNav, clearCursorNav }}>
      {children}
    </CursorNavContext.Provider>
  );
}

export function useCursorNav() {
  return useContext(CursorNavContext);
}
