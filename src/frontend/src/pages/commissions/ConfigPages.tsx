import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GroupsPanel } from "./GroupsPanel";
import { RulesTab } from "./RulesTab";
import { SettingsTab } from "./SettingsTab";

const back = "inline-flex min-h-11 items-center text-sm font-bold text-primary";

/** Comisiones › Configurar: the four steps of the setup (HU-COM-15). */
export function ConfigPage() {
  return (
    <div data-testid="commissions-config">
      <SettingsTab part="setup" />
    </div>
  );
}

/** Step 2: commission groups (services that commission the same way). */
export function GroupsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" data-testid="commissions-groups-page">
      <Link to="/app/commissions/configurar" className={`${back} self-start`} data-testid="config-back">
        ← {t("femme.commissions.config.back")}
      </Link>
      <GroupsPanel />
    </div>
  );
}

/** Advanced: exceptions by service or product, scheduled changes and the change history. */
export function AdvancedPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4" data-testid="commissions-advanced">
      <Link to="/app/commissions/configurar" className={`${back} self-start`} data-testid="config-back">
        ← {t("femme.commissions.config.back")}
      </Link>
      <div className="rounded-card border border-line bg-surface p-4" data-testid="advanced-precedence">
        <h3 className="font-heading font-extrabold text-ink">{t("femme.commissions.advanced.precedenceTitle")}</h3>
        <ol className="mt-1 list-decimal pl-5 text-sm text-ink-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <li key={n}>{t(`femme.commissions.advanced.precedence${n}`)}</li>
          ))}
        </ol>
      </div>
      <RulesTab />
      <SettingsTab part="advanced" />
    </div>
  );
}
