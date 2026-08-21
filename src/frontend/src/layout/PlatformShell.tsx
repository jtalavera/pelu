import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";
import { useSessionRefresh } from "../auth/useSessionRefresh";
import { useIdleLogout } from "../auth/useIdleLogout";
import { useThemeContext } from "../context/ThemeContext";
import { persistLanguage, type SupportedLanguage } from "../i18n/languagePreference";
import { useMe } from "../hooks/useMe";

/**
 * HU-35: dedicated shell for the `/platform/**` area (Platform Admin). Deliberately does NOT
 * reuse `AppShell` — that shell mounts `FeatureFlagProvider`, which calls the tenant-scoped
 * `/api/feature-flags` endpoint; a Platform Admin's tenant-less token would always be rejected
 * there. This shell only wires session refresh + idle logout (HU-35 AC-5: same inactivity
 * expiration mechanism as the rest of the app).
 */
export function PlatformShell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { me } = useMe();
  const { theme, toggle } = useThemeContext();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  useSessionRefresh(true, () => logout("expired"));
  useIdleLogout(true, () => logout("idle"));

  const currentLang: SupportedLanguage = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";

  function logout(reason?: "idle" | "expired") {
    sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    navigate("/login", { replace: true, state: reason ? { reason } : undefined });
  }

  function switchLang(lang: SupportedLanguage) {
    persistLanguage(lang);
    void i18n.changeLanguage(lang);
    setLangMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-[var(--color-stone)] text-[var(--color-ink)]">
      <header
        className="fixed inset-x-0 top-0 z-[100] flex h-12 items-center gap-3 px-4 sm:px-5"
        style={{ background: "var(--color-white)", borderBottom: "var(--border-default)" }}
      >
        <span
          className="text-[15px] font-medium"
          style={{ color: "var(--color-rose)", letterSpacing: "-0.01em" }}
        >
          {t("femme.appName")} · {t("femme.platform.brandSuffix")}
        </span>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={toggle}
            aria-label={
              theme === "dark"
                ? t("designSystem.theme.switchToLight")
                : t("designSystem.theme.switchToDark")
            }
            title={
              theme === "dark"
                ? t("designSystem.theme.switchToLight")
                : t("designSystem.theme.switchToDark")
            }
            className="flex h-8 w-8 min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-md)] sm:min-h-8 sm:min-w-8"
            style={{ background: "var(--color-stone)", border: "var(--border-default)" }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={langMenuOpen}
              aria-label={t("language.label")}
              onClick={() => setLangMenuOpen((v) => !v)}
              className="flex h-8 min-h-11 items-center rounded-[var(--radius-md)] px-2 text-[11px] font-medium sm:min-h-8"
              style={{ background: "var(--color-stone)", border: "var(--border-default)" }}
            >
              {currentLang.toUpperCase()}
            </button>
            {langMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+4px)] z-[200] min-w-[100px] overflow-hidden rounded-[var(--radius-lg)]"
                style={{
                  background: "var(--color-white)",
                  border: "var(--border-default)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
                }}
              >
                {(["en", "es"] as SupportedLanguage[]).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    role="menuitem"
                    onClick={() => switchLang(lang)}
                    className="block w-full px-3 py-2 text-left text-[12px]"
                    style={{
                      color:
                        currentLang === lang ? "var(--color-rose-dk)" : "var(--color-ink)",
                      background:
                        currentLang === lang ? "var(--color-rose-lt)" : "transparent",
                    }}
                  >
                    {t(`language.${lang}`)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span
            className="hidden max-w-[160px] truncate text-[11px] sm:inline"
            style={{ color: "var(--color-ink-3)" }}
          >
            {me?.email}
          </span>

          <button
            type="button"
            onClick={() => logout()}
            aria-label={t("femme.nav.logout")}
            className="min-h-11 rounded-[var(--radius-md)] px-3 text-[12px] font-medium sm:min-h-8"
            style={{
              background: "var(--color-stone)",
              border: "var(--border-default)",
              color: "var(--color-ink-2)",
            }}
          >
            {t("femme.nav.logout")}
          </button>
        </div>
      </header>

      <aside
        aria-label={t("femme.platform.navLabel")}
        className="fixed bottom-0 left-0 top-12 flex w-[200px] flex-col gap-1 overflow-y-auto p-3"
        style={{ background: "var(--color-white)", borderRight: "var(--border-default)" }}
      >
        <NavLink
          to="/platform"
          end
          className="block rounded-[var(--radius-md)] px-2.5 py-2 text-[12px]"
          style={({ isActive }) => ({
            color: isActive ? "var(--color-rose-dk)" : "var(--color-ink-2)",
            fontWeight: isActive ? 500 : 400,
            background: isActive ? "var(--color-rose-lt)" : "transparent",
          })}
        >
          {t("femme.platform.nav.dashboard")}
        </NavLink>
        <NavLink
          to="/platform/tenants"
          className="block rounded-[var(--radius-md)] px-2.5 py-2 text-[12px]"
          style={({ isActive }) => ({
            color: isActive ? "var(--color-rose-dk)" : "var(--color-ink-2)",
            fontWeight: isActive ? 500 : 400,
            background: isActive ? "var(--color-rose-lt)" : "transparent",
          })}
        >
          {t("femme.platform.nav.tenants")}
        </NavLink>
        <NavLink
          to="/platform/tiers"
          className="block rounded-[var(--radius-md)] px-2.5 py-2 text-[12px]"
          style={({ isActive }) => ({
            color: isActive ? "var(--color-rose-dk)" : "var(--color-ink-2)",
            fontWeight: isActive ? 500 : 400,
            background: isActive ? "var(--color-rose-lt)" : "transparent",
          })}
        >
          {t("femme.platform.nav.tiers")}
        </NavLink>
        <NavLink
          to="/platform/feature-flags"
          className="block rounded-[var(--radius-md)] px-2.5 py-2 text-[12px]"
          style={({ isActive }) => ({
            color: isActive ? "var(--color-rose-dk)" : "var(--color-ink-2)",
            fontWeight: isActive ? 500 : 400,
            background: isActive ? "var(--color-rose-lt)" : "transparent",
          })}
        >
          {t("femme.platform.nav.featureFlags")}
        </NavLink>
      </aside>

      <main className="ml-[200px] mt-12 min-h-[calc(100vh-3rem)] p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
