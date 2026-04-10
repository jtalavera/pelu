import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "../i18n/dateLocale";

/**
 * Keeps `<html lang>` in sync with the app language so native controls
 * (e.g. `input type="date"`) follow the same language where the browser supports it.
 */
export function SyncHtmlLang() {
  const { i18n } = useTranslation();
  useEffect(() => {
    const dateLocale = getDateLocale(i18n);
    document.documentElement.lang = dateLocale.startsWith("es") ? "es" : "en";
  }, [i18n.language, i18n.resolvedLanguage]);
  return null;
}
