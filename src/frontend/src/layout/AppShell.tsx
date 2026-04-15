import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";
import { useSessionRefresh } from "../auth/useSessionRefresh";
import { useThemeContext } from "../context/ThemeContext";
import { persistLanguage, type SupportedLanguage } from "../i18n/languagePreference";
import { useMe } from "../hooks/useMe";

function getInitials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function SectionLabel({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "block",
        fontSize: 9,
        fontWeight: 500,
        letterSpacing: "0.08em",
        color: "var(--color-ink-3)",
        textTransform: "uppercase",
        padding: "8px 10px 4px",
        marginTop: 4,
      }}
    >
      {label}
    </span>
  );
}

function SideNavItem({
  to,
  end,
  label,
  icon,
}: {
  to: string;
  end?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        padding: "8px 10px",
        borderRadius: "var(--radius-md)",
        fontSize: 12,
        color: isActive ? "var(--color-rose-dk)" : "var(--color-ink-2)",
        fontWeight: isActive ? 500 : 400,
        background: isActive ? "var(--color-rose-lt)" : "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 9,
        textDecoration: "none",
      })}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        if (!el.dataset.active) el.style.background = "var(--color-stone)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        if (!el.dataset.active) el.style.background = "";
      }}
    >
      {icon}
      {label}
    </NavLink>
  );
}

const DashboardIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const ServicesIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const ProfessionalsIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ClientsIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

const BillingIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const BellIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);

interface MenuItemProps {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  color: string;
  hoverBg: string;
}

function MenuItem({ onClick, icon, label, color, hoverBg }: MenuItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "10px 14px",
        cursor: "pointer",
        fontSize: 13,
        color,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: hovered ? hoverBg : "transparent",
        transition: "background 0.12s",
      }}
    >
      <span style={{ color, display: "flex", alignItems: "center" }}>{icon}</span>
      {label}
    </div>
  );
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { me } = useMe();
  const { theme, toggle } = useThemeContext();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useSessionRefresh(true);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [userMenuOpen]);

  const currentLang: SupportedLanguage = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";

  function logout() {
    sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    navigate("/login", { replace: true });
  }

  function switchLang(lang: SupportedLanguage) {
    persistLanguage(lang);
    void i18n.changeLanguage(lang);
  }

  const email = me?.email ?? "";
  const initials = email ? getInitials(email) : "?";
  const displayName = email.split("@")[0];

  return (
    <div>
      {/* ── TOPBAR ── */}
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 100,
          background: "var(--color-white)",
          borderBottom: "var(--border-default)",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 12,
        }}
      >
        {/* Logo */}
        <span
          style={{
            width: 220,
            flexShrink: 0,
            fontSize: 15,
            fontWeight: 500,
            color: "var(--color-rose)",
            letterSpacing: "-0.01em",
          }}
        >
          {t("femme.appName")}
        </span>

        {/* Search */}
        <div style={{ flex: 1, maxWidth: 340, position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
              color: "var(--color-ink-3)",
              display: "flex",
            }}
          >
            <SearchIcon />
          </span>
          <input
            type="search"
            placeholder={t("femme.topbar.searchPlaceholder")}
            aria-label={t("femme.topbar.searchPlaceholder")}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "7px 10px 7px 32px",
              border: "var(--border-default)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
              background: "var(--color-stone)",
              color: "var(--color-ink)",
              outline: "none",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--color-rose)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "";
            }}
          />
        </div>

        {/* Right zone */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center" }}>
          <button
            type="button"
            onClick={toggle}
            title={
              theme === "dark"
                ? t("designSystem.theme.switchToLight")
                : t("designSystem.theme.switchToDark")
            }
            aria-label={
              theme === "dark"
                ? t("designSystem.theme.switchToLight")
                : t("designSystem.theme.switchToDark")
            }
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-md)",
              border: "var(--border-default)",
              background: "var(--color-stone)",
              color: "var(--color-ink-2)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              flexShrink: 0,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-stone-md)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--color-stone)";
            }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          {/* Language switcher */}
          <div role="group" aria-label={t("language.label")} style={{ display: "flex", gap: 4 }}>
            {(["en", "es"] as SupportedLanguage[]).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => switchLang(lang)}
                aria-pressed={currentLang === lang}
                style={{
                  padding: "2px 8px",
                  borderRadius: "var(--radius-pill)",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  border:
                    currentLang === lang
                      ? "1px solid var(--color-rose-md)"
                      : "var(--border-default)",
                  background:
                    currentLang === lang ? "var(--color-rose-lt)" : "transparent",
                  color:
                    currentLang === lang ? "var(--color-rose-dk)" : "var(--color-ink-3)",
                }}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Notifications */}
          <button
            type="button"
            aria-label={t("femme.topbar.notifications")}
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-md)",
              background: "var(--color-stone)",
              border: "var(--border-default)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              position: "relative",
              flexShrink: 0,
            }}
          >
            <BellIcon />
          </button>

          {/* User profile */}
          <div ref={userMenuRef} style={{ position: "relative" }}>
            {/* ── Trigger ── */}
            <div
              role="button"
              tabIndex={0}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label={t("femme.topbar.userMenuTriggerAria")}
              onClick={() => setUserMenuOpen((prev) => !prev)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setUserMenuOpen((prev) => !prev);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                background: userMenuOpen ? "var(--color-stone)" : "transparent",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!userMenuOpen) e.currentTarget.style.background = "var(--color-stone)";
              }}
              onMouseLeave={(e) => {
                if (!userMenuOpen) e.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "var(--radius-pill)",
                  background: "var(--color-rose-md)",
                  color: "var(--color-rose-dk)",
                  fontSize: 10,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {initials}
              </div>
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-ink)" }}>
                  {displayName}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-ink-3)" }}>
                  {t("femme.nav.adminRole")}
                </span>
              </div>
              <svg
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                aria-hidden
                style={{
                  marginLeft: 2,
                  flexShrink: 0,
                  transition: "transform 0.15s",
                  transform: userMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                <path
                  d="M1 1L5 5L9 1"
                  stroke="var(--color-ink-3)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* ── Menú desplegable ── */}
            {userMenuOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  minWidth: 200,
                  background: "var(--color-white)",
                  border: "var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
                  overflow: "hidden",
                  zIndex: 200,
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    borderBottom: "var(--border-default)",
                    background: "var(--color-stone)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--color-ink)",
                    }}
                  >
                    {displayName}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-ink-3)",
                      marginTop: 2,
                    }}
                  >
                    {email}
                  </div>
                </div>

                <MenuItem
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate("/app/settings/business");
                  }}
                  color="var(--color-ink)"
                  hoverBg="var(--color-stone)"
                  icon={
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                      <path
                        d="M2 12c0-2.2 2.2-4 5-4s5 1.8 5 4"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  }
                  label={t("femme.topbar.userMenuUserSettings")}
                />

                <div
                  style={{
                    height: "0.5px",
                    background: "var(--color-stone-md)",
                    margin: "0 14px",
                  }}
                />

                <MenuItem
                  onClick={() => {
                    setUserMenuOpen(false);
                    logout();
                  }}
                  color="var(--color-danger)"
                  hoverBg="var(--color-danger-lt)"
                  icon={
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path
                        d="M5 2H2.5A.5.5 0 002 2.5v9a.5.5 0 00.5.5H5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M9 4.5L12 7l-3 2.5M12 7H5.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  }
                  label={t("femme.nav.logout")}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── SIDEBAR ── */}
      <aside
        style={{
          position: "fixed",
          top: 48,
          left: 0,
          bottom: 0,
          width: 220,
          background: "var(--color-white)",
          borderRight: "var(--border-default)",
          padding: "16px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
        }}
        aria-label={t("femme.nav.mainLabel")}
      >
        <SectionLabel label={t("femme.nav.sectionMain")} />
        <SideNavItem to="/app" end label={t("femme.nav.dashboard")} icon={<DashboardIcon />} />
        <SideNavItem to="/app/calendar" label={t("femme.nav.calendar")} icon={<CalendarIcon />} />

        <SectionLabel label={t("femme.nav.sectionManagement")} />
        <SideNavItem to="/app/services" label={t("femme.nav.services")} icon={<ServicesIcon />} />
        <SideNavItem
          to="/app/professionals"
          label={t("femme.nav.professionals")}
          icon={<ProfessionalsIcon />}
        />
        <SideNavItem to="/app/clients" label={t("femme.nav.clients")} icon={<ClientsIcon />} />

        <SectionLabel label={t("femme.nav.sectionFinance")} />
        <SideNavItem to="/app/billing" label={t("femme.nav.billing")} icon={<BillingIcon />} />

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        <SideNavItem
          to="/app/settings"
          label={t("femme.nav.businessSettings")}
          icon={<SettingsIcon />}
        />

        {/* User block */}
        <button
          type="button"
          onClick={logout}
          aria-label={t("femme.nav.logout")}
          style={{
            paddingTop: 10,
            borderTop: "var(--border-default)",
            borderLeft: "none",
            borderRight: "none",
            borderBottom: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            background: "transparent",
            textAlign: "left",
            width: "100%",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "var(--radius-pill)",
              background: "var(--color-rose-md)",
              color: "var(--color-rose-dk)",
              fontSize: 10,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-ink)" }}>
              {displayName}
            </span>
            <span style={{ fontSize: 10, color: "var(--color-ink-3)" }}>
              {t("femme.nav.logout")}
            </span>
          </div>
        </button>
      </aside>

      {/* ── MAIN ── */}
      <main
        style={{
          marginLeft: 220,
          marginTop: 48,
          padding: 24,
          minHeight: "calc(100vh - 48px)",
          background: "var(--color-stone)",
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
