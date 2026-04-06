export const I18N_LANGUAGE_STORAGE_KEY = "cursor_poc.i18n.language";

export type SupportedLanguage = "en" | "es";

/**
 * Preferred language for first paint: stored choice (if any), otherwise browser locale.
 */
export function getInitialLanguage(): SupportedLanguage {
  if (typeof window === "undefined") {
    return "en";
  }
  try {
    const stored = window.localStorage.getItem(I18N_LANGUAGE_STORAGE_KEY);
    if (stored === "es" || stored === "en") {
      return stored;
    }
  } catch {
    /* private mode or no localStorage */
  }
  const nav =
    typeof navigator !== "undefined" ? (navigator.language?.toLowerCase() ?? "en") : "en";
  if (nav.startsWith("es")) {
    return "es";
  }
  return "en";
}

export function persistLanguage(lang: SupportedLanguage): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(I18N_LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}
