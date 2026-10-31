import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, KebabMenu, Spinner } from "@design-system";
import { useFeatureFlag, useFeatureFlagsState } from "../../hooks/useFeatureFlags";
import { useMe } from "../../hooks/useMe";
import { MovementsTab } from "./MovementsTab";
import { PreviewTab } from "./PreviewTab";
import { ReportsTab } from "./ReportsTab";
import { RulesTab } from "./RulesTab";
import { SettingsTab } from "./SettingsTab";
import { SettlementsTab } from "./SettlementsTab";

const MAIN_TABS = ["settlements", "movements", "rules"] as const;
const MORE_TABS = ["preview", "reports", "settings"] as const;
type Tab = (typeof MAIN_TABS)[number] | (typeof MORE_TABS)[number];

/**
 * Módulo de comisiones (ADMIN): HU-COM-01/02/03/06/08/09. The three day-to-day screens are tabs; the
 * rest (preview, reports, settings) live under the «⋯» menu so they don't compete for attention.
 */
export default function CommissionsPage() {
  const { t } = useTranslation();
  const enabled = useFeatureFlag("COMMISSIONS");
  const { loading } = useFeatureFlagsState();
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>("settlements");
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);

  if (loading) return <Spinner />;

  if (!enabled || (me && me.role !== "ADMIN")) {
    return <Alert variant="warning">{t("femme.commissions.notEnabled")}</Alert>;
  }

  const moreActive = (MORE_TABS as readonly string[]).includes(tab);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold text-ink sm:text-3xl">{t("femme.commissions.pageTitle")}</h1>
        <div ref={setActionSlot} className="empty:hidden" />
      </div>
      <div
        className="flex items-center gap-1 rounded-2xl bg-primary-lt p-1"
        role="tablist"
        aria-label={t("femme.commissions.pageTitle")}
      >
        {MAIN_TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={`commissions-tab-${key}`}
            onClick={() => setTab(key)}
            className="min-h-11 min-w-0 flex-1 truncate rounded-[10px] bg-transparent px-2 font-bold text-ink-2 aria-selected:bg-surface aria-selected:text-primary aria-selected:shadow-[0_1px_2px_rgba(10,31,51,0.12)] sm:px-4"
          >
            {t(`femme.commissions.tabs.${key}`)}
          </button>
        ))}
        <KebabMenu
          id="commissions-more"
          triggerAriaLabel={t("femme.commissions.moreMenu")}
          items={MORE_TABS.map((key) => ({
            id: key,
            label: t(`femme.commissions.tabs.${key}`),
            onSelect: () => setTab(key),
          }))}
        />
      </div>
      {moreActive && (
        <h2 className="font-heading text-lg font-extrabold text-ink" data-testid="commissions-more-title">
          {t(`femme.commissions.tabs.${tab}`)}
        </h2>
      )}
      {tab === "settlements" && <SettlementsTab actionSlot={actionSlot} />}
      {tab === "movements" && <MovementsTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "preview" && <PreviewTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
