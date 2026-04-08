import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium min-h-11 flex items-center ${
    isActive
      ? "bg-[rgb(var(--color-muted))] text-[rgb(var(--color-fg))]"
      : "text-[rgb(var(--color-muted-foreground))] hover:bg-[rgb(var(--color-muted))]"
  }`;

export default function SettingsLayout() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-[rgb(var(--color-muted-foreground))]">
          {t("femme.settings.sectionTitle")}
        </p>
        <nav
          className="mt-3 flex flex-wrap gap-2 border-b border-[rgb(var(--color-border))] pb-3"
          aria-label={t("femme.settings.sectionTitle")}
        >
          <NavLink to="/app/settings/business" className={tabClass} end>
            {t("femme.settings.tabBusiness")}
          </NavLink>
          <NavLink to="/app/settings/fiscal-stamp" className={tabClass}>
            {t("femme.settings.tabFiscalStamp")}
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
