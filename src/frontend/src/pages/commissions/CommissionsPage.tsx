import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Spinner } from "@design-system";
import { useFeatureFlag, useFeatureFlagsState } from "../../hooks/useFeatureFlags";
import { useMe } from "../../hooks/useMe";
import { MovementsTab } from "./MovementsTab";
import { PreviewTab } from "./PreviewTab";
import { ReportsTab } from "./ReportsTab";
import { RulesTab } from "./RulesTab";
import { SettingsTab } from "./SettingsTab";
import { SettlementsTab } from "./SettlementsTab";

const TABS = ["settlements", "movements", "rules", "preview", "reports", "settings"] as const;
type Tab = (typeof TABS)[number];

/** Módulo de comisiones (ADMIN): HU-COM-01/02/03/06/08/09. */
export default function CommissionsPage() {
  const { t } = useTranslation();
  const enabled = useFeatureFlag("COMMISSIONS");
  const { loading } = useFeatureFlagsState();
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>("settlements");

  if (loading) return <Spinner />;

  if (!enabled || (me && me.role !== "ADMIN")) {
    return <Alert variant="warning">{t("femme.commissions.notEnabled")}</Alert>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <div className="text-[15px] font-medium text-[var(--color-ink)]">{t("femme.commissions.pageTitle")}</div>
        <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">{t("femme.commissions.pageSubtitle")}</div>
      </div>
      <div className="flex flex-wrap gap-1 overflow-x-auto" role="tablist" aria-label={t("femme.commissions.pageTitle")}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={
              "rounded-[var(--radius-md)] border px-3.5 py-1.5 text-xs leading-normal " +
              (tab === key
                ? "border-[var(--color-rose-md)] bg-[var(--color-rose-lt)] font-medium text-[var(--color-rose-dk)]"
                : "bg-[var(--color-white)] text-[var(--color-ink-2)]")
            }
          >
            {t(`femme.commissions.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "settlements" && <SettlementsTab />}
      {tab === "movements" && <MovementsTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "preview" && <PreviewTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
