import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  APPLICATION_LANGUAGE_COOKIE,
  APPLICATION_LANGUAGE_EVENT,
  APPLICATION_LANGUAGE_STORAGE_KEY,
  DEFAULT_APPLICATION_LANGUAGE,
  isRtlApplicationLanguage,
  parseApplicationLanguage,
  type ApplicationLanguage,
} from "@shared/applicationLanguageContract";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  translateApplicationText,
  type ApplicationTranslationKey,
} from "@/i18n/applicationTranslations";

interface LanguagePreferenceResponse {
  preferredLanguage?: ApplicationLanguage;
}

interface ApplicationLanguageContextValue {
  language: ApplicationLanguage;
  direction: "ltr" | "rtl";
  isSaving: boolean;
  setLanguage: (language: ApplicationLanguage) => void;
  t: (key: ApplicationTranslationKey) => string;
}

const ApplicationLanguageContext = createContext<ApplicationLanguageContextValue | null>(null);

function readLocalPreference(): ApplicationLanguage {
  if (typeof window === "undefined") return DEFAULT_APPLICATION_LANGUAGE;
  return parseApplicationLanguage(window.localStorage.getItem(APPLICATION_LANGUAGE_STORAGE_KEY));
}

function persistBrowserPreference(language: ApplicationLanguage) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APPLICATION_LANGUAGE_STORAGE_KEY, language);
  document.cookie = `${APPLICATION_LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function ApplicationLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<ApplicationLanguage>(readLocalPreference);

  const preferenceQuery = useQuery<LanguagePreferenceResponse>({
    queryKey: ["/api/language-preference"],
    retry: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const serverLanguage = preferenceQuery.data?.preferredLanguage;
    if (!serverLanguage) return;
    const normalized = parseApplicationLanguage(serverLanguage);
    setLanguageState(normalized);
    persistBrowserPreference(normalized);
  }, [preferenceQuery.data?.preferredLanguage]);

  const preferenceMutation = useMutation({
    mutationFn: async (next: ApplicationLanguage) => {
      await apiRequest("PUT", "/api/language-preference", { preferredLanguage: next });
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["/api/language-preference"], { preferredLanguage: next });
    },
  });

  const setLanguage = useCallback(
    (next: ApplicationLanguage) => {
      const normalized = parseApplicationLanguage(next);
      persistBrowserPreference(normalized);
      setLanguageState(normalized);
      document.documentElement.lang = normalized;
      document.documentElement.dir = isRtlApplicationLanguage(normalized) ? "rtl" : "ltr";
      window.dispatchEvent(new CustomEvent<ApplicationLanguage>(APPLICATION_LANGUAGE_EVENT, { detail: normalized }));
      preferenceMutation.mutate(normalized);
      void queryClient.invalidateQueries({ refetchType: "active" });
    },
    [preferenceMutation.mutate],
  );

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = isRtlApplicationLanguage(language) ? "rtl" : "ltr";
    persistBrowserPreference(language);
  }, [language]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APPLICATION_LANGUAGE_STORAGE_KEY) return;
      setLanguageState(parseApplicationLanguage(event.newValue));
    };
    const handleLanguageEvent = (event: Event) => {
      setLanguageState(parseApplicationLanguage((event as CustomEvent<ApplicationLanguage>).detail));
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(APPLICATION_LANGUAGE_EVENT, handleLanguageEvent);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(APPLICATION_LANGUAGE_EVENT, handleLanguageEvent);
    };
  }, []);

  const value = useMemo<ApplicationLanguageContextValue>(
    () => ({
      language,
      direction: isRtlApplicationLanguage(language) ? "rtl" : "ltr",
      isSaving: preferenceMutation.isPending,
      setLanguage,
      t: (key) => translateApplicationText(key, language),
    }),
    [language, preferenceMutation.isPending, setLanguage],
  );

  return <ApplicationLanguageContext.Provider value={value}>{children}</ApplicationLanguageContext.Provider>;
}

export function useApplicationLanguage() {
  const value = useContext(ApplicationLanguageContext);
  if (!value) throw new Error("useApplicationLanguage must be used inside ApplicationLanguageProvider");
  return value;
}
