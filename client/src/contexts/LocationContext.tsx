import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useCompany } from "@/contexts/CompanyContext";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
}

interface LocationContextType {
  selectedLocation: Location | null;
  setSelectedLocation: (location: Location | null) => void;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

function LocationProviderInner({ children }: { children: ReactNode }) {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const { selectedCompany } = useCompany();

  useEffect(() => {
    setSelectedLocation(null);
  }, [selectedCompany?.id]);

  return (
    <LocationContext.Provider value={{ selectedLocation, setSelectedLocation }}>{children}</LocationContext.Provider>
  );
}

export function LocationProvider({ children }: { children: ReactNode }) {
  return <LocationProviderInner>{children}</LocationProviderInner>;
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return context;
}
