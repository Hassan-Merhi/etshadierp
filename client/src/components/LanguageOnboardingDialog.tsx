import { useEffect, useMemo, useState } from "react";
import { Check, Languages } from "lucide-react";
import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import { cn } from "@/lib/utils";

interface LanguageOnboardingDialogProps {
  userId: number | string;
}

const ONBOARDING_VERSION = "v1";

const languageOptions: Array<{
  value: ApplicationLanguage;
  label: string;
  nativeLabel: string;
}> = [
  { value: "en", label: "English", nativeLabel: "English" },
  { value: "ar", label: "Arabic", nativeLabel: "العربية" },
  { value: "fr", label: "French", nativeLabel: "Français" },
];

function storageKey(userId: number | string) {
  return `application-language-onboarding:${ONBOARDING_VERSION}:${String(userId)}`;
}

export function LanguageOnboardingDialog({ userId }: LanguageOnboardingDialogProps) {
  const { language, setLanguage, isSaving } = useApplicationLanguage();
  const [open, setOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<ApplicationLanguage>(language);
  const key = useMemo(() => storageKey(userId), [userId]);

  useEffect(() => {
    setSelectedLanguage(language);
  }, [language]);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(key) !== "completed");
    } catch {
      setOpen(true);
    }
  }, [key]);

  const chooseLanguage = (next: ApplicationLanguage) => {
    setSelectedLanguage(next);
    setLanguage(next);
  };

  const complete = () => {
    try {
      window.localStorage.setItem(key, "completed");
    } catch {
      // The language selection is still saved by the existing account preference API.
    }
    setOpen(false);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] max-w-xl overflow-y-auto"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        data-testid="language-onboarding-dialog"
      >
        <DialogHeader className="space-y-3 text-left">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Languages className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle className="text-xl">Choose your preferred language</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p dir="ltr">
                Please select your preferred language. You can change it later from your profile menu in the top-right
                corner.
              </p>
              <p dir="rtl" className="text-right">
                يرجى اختيار لغتك المفضلة. يمكنك تغييرها لاحقًا من قائمة الملف الشخصي في الزاوية العلوية اليمنى.
              </p>
              <p dir="ltr">
                Veuillez sélectionner votre langue préférée. Vous pourrez la modifier plus tard depuis le menu de votre
                profil en haut à droite.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Preferred language">
          {languageOptions.map((option) => {
            const selected = selectedLanguage === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                variant={selected ? "default" : "outline"}
                className={cn("h-auto min-h-20 justify-between gap-3 px-4 py-3", selected && "ring-2 ring-primary/30")}
                onClick={() => chooseLanguage(option.value)}
                role="radio"
                aria-checked={selected}
                data-testid={`language-onboarding-${option.value}`}
              >
                <span className="flex flex-col items-start gap-1">
                  <span className="font-semibold">{option.nativeLabel}</span>
                  {option.nativeLabel !== option.label && <span className="text-xs opacity-80">{option.label}</span>}
                </span>
                {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
              </Button>
            );
          })}
        </div>

        <Button
          type="button"
          className="w-full"
          onClick={complete}
          disabled={isSaving}
          data-testid="language-onboarding-continue"
        >
          {isSaving ? "Saving…" : "Continue · متابعة · Continuer"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
