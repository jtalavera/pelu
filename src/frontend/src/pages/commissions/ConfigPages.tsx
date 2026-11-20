import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, Spinner } from "@design-system";
import { getGroups, type GroupView } from "../../api/commissions";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { GroupsWorkspace } from "./GroupsWorkspace";
import { RulesTab } from "./RulesTab";
import { SettingsTab, type StepSlot } from "./SettingsTab";
import { formatPercent } from "./common";
import { setupProgress, useOverview } from "./overview";

const back = "inline-flex min-h-11 items-center text-sm font-bold text-primary";
const GROUPS = "/app/commissions/configurar/grupos";
const RATES = "/app/commissions/configurar/comisiones";

/** Comisiones › Configurar: each step shows where it stands, and one search finds a group or a service (HU-COM-16/20). */
export function ConfigPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { overview } = useOverview();
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  // The overview decides which step opens by itself: wait for it so the screen does not jump.
  if (!overview) return <Spinner />;

  const groupCount = groups?.length ?? overview.groupCount;
  const withPercent = groups ? groups.filter((g) => g.percent !== null).length : groupCount - overview.groupsWithoutPercent;
  const missing = overview.groupsWithoutPercent;
  const progress = setupProgress(overview);

  const linkBtn = "inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-extrabold text-primary";

  const step2: StepSlot = {
    tone: progress.groupsDone ? "done" : "pending",
    summary: groups ? t("femme.commissions.config.step2.summary", { count: groups.length, withPercent }) : t("femme.commissions.config.step2.help"),
    pill: groupCount === 0 ? t("femme.commissions.config.step2.noGroups") : t("femme.commissions.config.step2.missing", { count: missing }),
    body: (primary) => (
      <div className="flex flex-col gap-3.5 px-4 pb-[18px] pt-4 sm:px-5">
        <p className="text-sm text-ink-2">
          {missing > 0 ? t("femme.commissions.config.step2.intro", { count: missing }) : t("femme.commissions.config.step2.help")}
        </p>
        {groups && groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-3">{t("femme.commissions.config.step2.yourGroups")}</span>
            {groups.map((g) => (
              <Link
                key={g.id}
                to={`${RATES}?q=${encodeURIComponent(g.name)}`}
                data-testid="config-group-chip"
                data-missing={g.percent === null}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold ${
                  g.percent === null ? "border-warning/50 bg-warning-lt text-warning" : "border-line text-ink"
                }`}
              >
                {g.name} <span className={g.percent === null ? "" : "text-ink-3"}>{g.percent === null ? t("femme.commissions.workspace.noPercent") : formatPercent(g.percent)}</span>
              </Link>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Link to={RATES} data-testid="config-step-2-link">
            <Button type="button" variant={primary ? "primary" : "secondary"} className={ACTION_BUTTON}>
              {t("femme.commissions.config.step2.open")}
            </Button>
          </Link>
          <Link to={GROUPS} data-testid="config-step-2-order-link" className="inline-flex min-h-11 items-center text-sm font-extrabold text-primary">
            {t("femme.commissions.config.step2.order")}
          </Link>
        </div>
      </div>
    ),
  };

  const after = ({ scheduledCount }: { scheduledCount: number }) => (
    <section className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-ink-3/40 bg-surface px-4 py-3 sm:px-5" data-testid="config-exceptions">
      <div className="min-w-0 flex-1 basis-72">
        <h3 className="font-heading text-base font-extrabold text-ink">{t("femme.commissions.config.exceptions.title")}</h3>
        <p className="text-[13px] text-ink-3" data-testid="config-exceptions-summary">
          {scheduledCount > 0 ? t("femme.commissions.config.exceptions.scheduledCount", { count: scheduledCount }) : t("femme.commissions.config.exceptions.help")}
        </p>
      </div>
      <Link to={`${GROUPS}?tab=exceptions`} className={linkBtn} data-testid="config-exceptions-link">
        {t("femme.commissions.config.exceptions.see")}
      </Link>
      <Link to="/app/commissions/configurar/avanzado" className={linkBtn} data-testid="config-advanced-link">
        {t("femme.commissions.config.exceptions.scheduled")}
      </Link>
    </section>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="commissions-config">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const q = query.trim();
          navigate(q ? `${GROUPS}?q=${encodeURIComponent(q)}` : GROUPS);
        }}
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor="config-search" className="sr-only">
            {t("femme.commissions.config.searchLabel")}
          </Label>
          <Input
            id="config-search"
            type="search"
            value={query}
            placeholder={t("femme.commissions.config.searchPlaceholder")}
            data-testid="config-search"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" className="min-h-11" data-testid="config-search-submit">
          {t("femme.commissions.groups.searchSubmit")}
        </Button>
      </form>
      <SettingsTab part="setup" slots={{ step2, after }} />
    </div>
  );
}

/** «Grupos y servicios»: the groups with their services, and the exceptions by service (HU-COM-16). */
export function GroupsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const exceptions = params.get("tab") === "exceptions";
  const tab = (to: string, active: boolean, testId: string, label: string) => (
    <Link
      to={to}
      data-testid={testId}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-extrabold ${
        active ? "bg-surface text-primary shadow-[0_1px_3px_rgba(10,31,51,0.15)]" : "text-ink-2"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex flex-col gap-3" data-testid="commissions-groups-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/app/commissions/configurar" className={back} data-testid="config-back">
            ← {t("femme.commissions.config.back")}
          </Link>
          <h2 className="font-heading text-2xl font-extrabold text-ink">{t("femme.commissions.workspace.title")}</h2>
        </div>
        <nav aria-label={t("femme.commissions.workspace.title")} className="flex gap-1.5 rounded-2xl bg-primary-lt p-1">
          {tab(GROUPS, !exceptions, "workspace-tab-groups", t("femme.commissions.workspace.tabGroups"))}
          {tab(`${GROUPS}?tab=exceptions`, exceptions, "workspace-tab-exceptions", t("femme.commissions.workspace.tabExceptions"))}
        </nav>
      </div>
      {exceptions ? <ExceptionsPane /> : <GroupsWorkspace />}
    </div>
  );
}

/** Exceptions by service or product, with the order in which the rules apply. */
function ExceptionsPane() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4" data-testid="commissions-exceptions">
      <div className="rounded-card border border-line bg-surface p-4" data-testid="advanced-precedence">
        <h3 className="font-heading font-extrabold text-ink">{t("femme.commissions.advanced.precedenceTitle")}</h3>
        <p className="text-sm text-ink-3">{t("femme.commissions.advanced.precedenceHelp")}</p>
        <ol className="mt-1 list-decimal pl-5 text-sm text-ink-2">
          {[1, 2, 3, 4].map((n) => (
            <li key={n}>{t(`femme.commissions.advanced.precedence${n}`)}</li>
          ))}
        </ol>
      </div>
      <RulesTab />
    </div>
  );
}

/** Scheduled changes and the change history (what used to be most of «Advanced»). */
export function AdvancedPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4" data-testid="commissions-advanced">
      <div>
        <Link to="/app/commissions/configurar" className={back} data-testid="config-back">
          ← {t("femme.commissions.config.back")}
        </Link>
        <h2 className="font-heading text-2xl font-extrabold text-ink">{t("femme.commissions.config.exceptions.scheduled")}</h2>
      </div>
      <SettingsTab part="advanced" />
    </div>
  );
}
