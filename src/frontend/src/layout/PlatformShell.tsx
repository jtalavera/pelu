import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";
import { useSessionRefresh } from "../auth/useSessionRefresh";
import { useIdleLogout } from "../auth/useIdleLogout";
import { useThemeContext } from "../context/ThemeContext";
import { persistLanguage, type SupportedLanguage } from "../i18n/languagePreference";
import { useMe } from "../hooks/useMe";
import { FlowbitLogo } from "@design-system";

const NAV_ITEMS: { to: string; end?: boolean; labelKey: string }[] = [
  { to: "/platform", end: true, labelKey: "femme.platform.nav.dashboard" },
  { to: "/platform/tenants", labelKey: "femme.platform.nav.tenants" },
  { to: "/platform/tiers", labelKey: "femme.platform.nav.tiers" },
  { to: "/platform/global-feature-flags", labelKey: "femme.platform.nav.globalFeatureFlags" },
  { to: "/platform/feature-flags", labelKey: "femme.platform.nav.featureFlags" },
  { to: "/platform/import", labelKey: "femme.platform.nav.import" },
  { to: "/platform/stock", labelKey: "femme.platform.nav.stock" },
  { to: "/platform/audit", labelKey: "femme.platform.nav.audit" },
];

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
        className="fixed inset-x-0 top-0 z-[100] flex h-14 items-center gap-3 px-4 sm:px-5"
        style={{
          background: "var(--topbar-bg)",
          color: "var(--topbar-fg)",
          borderBottom: "var(--topbar-border)",
        }}
      >
        {/* The platform area is not tenant-scoped, so it always wears the default (durazno) skin. */}
        <FlowbitLogo tone="dark" className="h-6 w-auto shrink-0" />
        <span className="text-[12px] font-bold opacity-85">
          {t("femme.platform.brandSuffix")}
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
            className="flex h-8 w-8 min-h-11 min-w-11 items-center justify-center rounded-full sm:min-h-8 sm:min-w-8"
            style={{ background: "var(--topbar-ctl)", color: "var(--topbar-fg)" }}
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
              className="flex h-8 min-h-11 items-center rounded-full px-3 text-[11px] font-bold sm:min-h-8"
              style={{ background: "var(--topbar-ctl)", color: "var(--topbar-fg)" }}
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
                  boxShadow: "0 4px 20px rgba(10,31,51,0.12)",
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
            className="hidden max-w-[160px] truncate text-[11px] opacity-85 sm:inline"
            style={{ color: "var(--topbar-fg)" }}
          >
            {me?.email}
          </span>

          <button
            type="button"
            onClick={() => logout()}
            aria-label={t("femme.nav.logout")}
            className="min-h-11 rounded-full px-4 text-[12px] font-bold sm:min-h-8"
            style={{ background: "var(--topbar-ctl)", color: "var(--topbar-fg)" }}
          >
            {t("femme.nav.logout")}
          </button>
        </div>
      </header>

      <aside
        aria-label={t("femme.platform.navLabel")}
        className="fixed bottom-0 left-0 top-14 flex w-[200px] flex-col gap-1 overflow-y-auto p-3"
        style={{ background: "var(--color-white)", borderRight: "var(--border-default)" }}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className="block rounded-full px-3.5 py-2 text-[13px]"
            style={({ isActive }) => ({
              color: isActive ? "var(--color-on-primary)" : "var(--color-ink-2)",
              fontWeight: isActive ? 700 : 600,
              background: isActive ? "var(--color-rose)" : "transparent",
            })}
          >
            {t(item.labelKey)}
          </NavLink>
        ))}
      </aside>

      <main className="ml-[200px] mt-14 min-h-[calc(100vh-3.5rem)] p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
