import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** BCP 47 locale used for `Intl` and `toLocale*` when UI language is Spanish. */
export const DATE_LOCALE_ES = "es-PY";

/** BCP 47 locale used for `Intl` and `toLocale*` when UI language is English. */
export const DATE_LOCALE_EN = "en-US";

/**
 * Locale string for date/time formatting aligned with the active i18n language
 * (not the browser default).
 */
export function getDateLocale(i18n: {
  language: string;
  resolvedLanguage?: string;
}): string {
  const raw = (i18n.resolvedLanguage ?? i18n.language ?? "en").toLowerCase();
  return raw.startsWith("es") ? DATE_LOCALE_ES : DATE_LOCALE_EN;
}

/**
 * Memoized date locale for the current UI language — use inside React components.
 */
export function useDateLocale(): string {
  const { i18n } = useTranslation();
  return useMemo(
    () => getDateLocale(i18n),
    [i18n.language, i18n.resolvedLanguage],
  );
}
