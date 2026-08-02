import { Languages } from "lucide-react";
import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import { Button } from "@/components/ui/button";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";

const languageOptions: Array<{
  value: ApplicationLanguage;
  labelKey: "language.english" | "language.arabic" | "language.french";
  shortLabel: string;
}> = [
  { value: "en", labelKey: "language.english", shortLabel: "EN" },
  { value: "ar", labelKey: "language.arabic", shortLabel: "AR" },
  { value: "fr", labelKey: "language.french", shortLabel: "FR" },
];

export function GlobalLanguageSwitch({ embedded = false }: { embedded?: boolean }) {
  const { language, setLanguage, isSaving, t } = useApplicationLanguage();

  return (
    <div
      className={
        embedded
          ? "flex items-center justify-end gap-1"
          : "fixed right-3 top-3 z-[70] flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur"
      }
      dir="ltr"
      role="group"
      aria-label={t("language.label")}
      data-testid="global-language-switch"
    >
      <span className="hidden items-center gap-1 px-1 text-xs text-muted-foreground md:flex">
        <Languages className="h-3.5 w-3.5" aria-hidden="true" />
        {t("language.label")}
      </span>
      {languageOptions.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={language === option.value ? "default" : "ghost"}
          onClick={() => setLanguage(option.value)}
          disabled={isSaving && language === option.value}
          aria-pressed={language === option.value}
          aria-label={t(option.labelKey)}
          title={t(option.labelKey)}
          data-testid={`application-language-${option.value}`}
          className="h-7 min-w-9 px-2"
        >
          {option.shortLabel}
        </Button>
      ))}
    </div>
  );
}
