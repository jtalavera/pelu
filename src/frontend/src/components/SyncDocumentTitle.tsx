import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * Keeps the browser tab title in sync with the app language.
 */
export function SyncDocumentTitle() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.title = t("femme.appTitle");
  }, [t, i18n.language, i18n.resolvedLanguage]);
  return null;
}
