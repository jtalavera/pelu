import { useTranslation } from "react-i18next";
import { Button, cn } from "@design-system";
import { persistLanguage, type SupportedLanguage } from "../i18n/languagePreference";

const languages: { code: SupportedLanguage; labelKey: string }[] = [
  { code: "en", labelKey: "language.en" },
  { code: "es", labelKey: "language.es" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";

  return (
    <div
      className={className}
      role="group"
      aria-label={t("language.label")}
    >
      <div className="flex flex-wrap gap-1 rounded-[var(--radius-md)] border border-[var(--color-stone-md)] bg-[var(--color-stone)] p-1">
        {languages.map(({ code, labelKey }) => (
          <Button
            key={code}
            type="button"
            variant={current === code ? "primary" : "ghost"}
            size="sm"
            className={cn(
              "min-w-[4.5rem]",
              current === code
                ? "!shadow-none"
                : "text-[var(--color-ink-2)] hover:bg-[var(--color-white)]",
            )}
            style={
              current === code
                ? {
                    background: "var(--color-rose)",
                    color: "var(--color-on-primary)",
                    border: "none",
                  }
                : undefined
            }
            onClick={() => {
              persistLanguage(code);
              void i18n.changeLanguage(code);
            }}
            aria-pressed={current === code}
          >
            {t(labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
