import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

export default function SettingsLayout() {
  const { t } = useTranslation();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    [
      "block rounded-[var(--radius-md)] px-2.5 py-2 text-xs mb-0.5 no-underline cursor-pointer transition-colors",
      isActive
        ? "font-medium bg-[var(--color-rose-lt)] text-[var(--color-rose-dk)]"
        : "text-[var(--color-ink-2)] hover:bg-[var(--color-stone)]",
    ].join(" ");

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-ink)" }}>
            {t("femme.settings.pageTitle")}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
            {t("femme.settings.pageSubtitle")}
          </div>
        </div>
      </div>

      <div
        className="grid min-w-0 grid-cols-1 overflow-hidden md:grid-cols-[200px_1fr]"
        style={{
          background: "var(--color-white)",
          borderRadius: "var(--radius-xl)",
          border: "var(--border-default)",
        }}
      >
        <nav
          style={{
            borderRight: "var(--border-default)",
            padding: "12px 8px",
          }}
          className="max-md:border-r-0 max-md:border-b max-md:border-[var(--color-stone-md)]"
          aria-label={t("femme.settings.sectionTitle")}
        >
          <NavLink to="/app/settings/business" className={navClass} end>
            {t("femme.settings.tabBusiness")}
          </NavLink>
          <NavLink to="/app/settings/fiscal-stamp" className={navClass}>
            {t("femme.settings.tabFiscalStamp")}
          </NavLink>
        </nav>
        <div style={{ padding: 20, minWidth: 0 }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
