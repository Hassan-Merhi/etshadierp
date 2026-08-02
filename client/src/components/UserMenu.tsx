import { ChevronDown, Languages, LogOut } from "lucide-react";
import {
  parseApplicationLanguage,
  type ApplicationLanguage,
} from "@shared/applicationLanguageContract";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";

const languageOptions: Array<{
  value: ApplicationLanguage;
  labelKey: "language.english" | "language.arabic" | "language.french";
}> = [
  { value: "en", labelKey: "language.english" },
  { value: "ar", labelKey: "language.arabic" },
  { value: "fr", labelKey: "language.french" },
];

function getInitials(username: string) {
  const words = username.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return username.substring(0, 2).toUpperCase();
}

interface UserMenuProps {
  accentColor: string;
  user: { username: string; role: string };
  onLogout: () => void;
}

export function UserMenu({ accentColor, user, onLogout }: UserMenuProps) {
  const { language, setLanguage, isSaving, t } = useApplicationLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="button-user-menu"
          aria-label={t("user.menu")}
          className="h-8 max-w-[15rem] gap-2 rounded-full border border-border/40 bg-muted/30 px-1.5 md:px-2.5"
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ backgroundColor: accentColor }}
            aria-hidden="true"
          >
            {getInitials(user.username)}
          </span>
          <span className="hidden min-w-0 items-center gap-2 md:flex">
            <span
              className="max-w-[8rem] truncate text-sm font-medium leading-none"
              data-business-value="true"
            >
              {user.username}
            </span>
            <span
              className="hidden border-l border-border/50 pl-2 text-xs leading-none text-muted-foreground lg:inline"
              data-business-value="true"
            >
              {user.role}
            </span>
          </span>
          <ChevronDown className="hidden h-3 w-3 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64" dir="ltr" data-testid="user-menu-content">
        <DropdownMenuLabel className="font-normal">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-medium" data-business-value="true">
              {user.username}
            </span>
            <span className="truncate text-xs text-muted-foreground" data-business-value="true">
              {user.role}
            </span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
          {t("language.label")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(value) => setLanguage(parseApplicationLanguage(value))}
        >
          {languageOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={isSaving}
              aria-label={t(option.labelKey)}
              data-testid={`application-language-${option.value}`}
            >
              {t(option.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {isSaving && (
          <div className="px-2 py-1 text-xs text-muted-foreground" role="status">
            {t("language.saving")}
          </div>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => onLogout()}
          data-testid="button-logout"
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t("common.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
