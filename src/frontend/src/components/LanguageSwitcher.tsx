import { useTranslation } from "react-i18next";
import { Button } from "@design-system";
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
      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50/80 p-1 dark:border-slate-600 dark:bg-slate-800/50">
        {languages.map(({ code, labelKey }) => (
          <Button
            key={code}
            type="button"
            variant={current === code ? "primary" : "ghost"}
            size="sm"
            className="min-w-[4.5rem]"
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
