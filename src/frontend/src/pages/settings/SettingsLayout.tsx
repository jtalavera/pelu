import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { KebabMenu } from "@design-system";
import { useMe } from "../../hooks/useMe";
import { useFeatureFlag } from "../../hooks/useFeatureFlags";

/**
 * Configuración: Negocio / Timbrado / SIFEN as segmented tabs; Impuestos, Auditoría and Dispositivos
 * compartidos live under the «⋯» menu. The section's primary action (e.g. «Agregar timbrado») goes
 * in the header slot via `SettingsHeaderAction`.
 */
export default function SettingsLayout() {
  const { t } = useTranslation();
  const { me } = useMe();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isTenantAdmin = me?.role === "ADMIN";
  const sifenEnabled = useFeatureFlag("SIFEN_ELECTRONIC_INVOICING");
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);

  const moreItems = [
    { id: "taxes", path: "/app/settings/taxes", label: t("femme.settings.tabTaxes"), visible: true },
    { id: "audit", path: "/app/settings/audit", label: t("femme.settings.tabAudit"), visible: isTenantAdmin },
    {
      id: "devices",
      path: "/app/settings/devices",
      label: t("femme.settings.tabSharedDevices"),
      visible: isTenantAdmin,
    },
  ].filter((i) => i.visible);
  const activeMore = moreItems.find((i) => pathname.startsWith(i.path));

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    [
      "flex min-h-11 min-w-0 flex-1 items-center justify-center truncate rounded-[10px] px-2 text-center font-bold no-underline sm:px-4",
      isActive
        ? "bg-surface text-primary shadow-[0_1px_2px_rgba(10,31,51,0.12)]"
        : "bg-transparent text-ink-2 hover:bg-transparent",
    ].join(" ");

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold text-ink sm:text-3xl">{t("femme.settings.pageTitle")}</h1>
        <div ref={setActionSlot} className="empty:hidden" />
      </div>
      <nav
        className="flex items-center gap-1 rounded-2xl bg-primary-lt p-1"
        aria-label={t("femme.settings.sectionTitle")}
      >
        {isTenantAdmin ? (
          <NavLink to="/app/settings/business" className={tabClass} end>
            {t("femme.settings.tabBusiness")}
          </NavLink>
        ) : null}
        <NavLink to="/app/settings/fiscal-stamp" className={tabClass}>
          {t("femme.settings.tabFiscalStamp")}
        </NavLink>
        {isTenantAdmin && sifenEnabled ? (
          <NavLink to="/app/settings/sifen" className={tabClass}>
            {t("femme.settings.tabSifen")}
          </NavLink>
        ) : null}
        <KebabMenu
          id="settings-more"
          triggerAriaLabel={t("femme.settings.moreMenu")}
          items={moreItems.map((i) => ({
            id: i.id,
            label: i.label,
            onSelect: () => navigate(i.path),
          }))}
        />
      </nav>
      {activeMore ? (
        <h2 className="font-heading text-lg font-extrabold text-ink" data-testid="settings-more-title">
          {activeMore.label}
        </h2>
      ) : null}
      <div className="min-w-0" data-testid="settings-content">
        <Outlet context={{ actionSlot }} />
      </div>
    </div>
  );
}
