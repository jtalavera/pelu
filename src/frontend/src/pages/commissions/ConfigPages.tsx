import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Input, Label } from "@design-system";
import { getGroupServices, getGroups, type GroupServiceRow, type GroupView } from "../../api/commissions";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { GroupsWorkspace } from "./GroupsWorkspace";
import { RulesTab } from "./RulesTab";
import { SettingsTab } from "./SettingsTab";
import { useOverview } from "./overview";

const back = "inline-flex min-h-11 items-center text-sm font-bold text-primary";
const GROUPS = "/app/commissions/configurar/grupos";

/** Comisiones › Configurar: each step shows where it stands, and one search finds a group or a service (HU-COM-16). */
export function ConfigPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { overview } = useOverview();
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [services, setServices] = useState<GroupServiceRow[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
    getGroupServices("SERVICE")
      .then(setServices)
      .catch(() => setServices([]));
  }, []);

  const total = services?.length ?? 0;
  const ungrouped = services?.filter((s) => s.groupId === null).length ?? 0;
  const withoutRules = overview?.professionalsWithoutRules ?? 0;

  const tile = (testId: string, big: string, label: string, tone: "plain" | "warn", to?: string) => {
    const cls = `flex flex-col rounded-2xl px-4 py-3 ${tone === "warn" ? "border border-warning/50 bg-warning-lt text-warning" : "bg-bg text-ink-2"}`;
    const body = (
      <>
        <b className={`font-heading text-2xl ${tone === "warn" ? "text-warning" : "text-ink"}`}>{big}</b>
        <span className="text-[13px]">{label}</span>
      </>
    );
    return to ? (
      <Link to={to} data-testid={testId} className={cls}>
        {body}
      </Link>
    ) : (
      <div data-testid={testId} className={cls}>
        {body}
      </div>
    );
  };

  const step2 = (
    <section className="flex flex-col gap-4 rounded-card border-2 border-primary bg-surface p-5 shadow-sm" data-testid="config-step-2">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-full bg-primary font-extrabold text-surface">
          2
        </span>
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="font-heading text-lg font-extrabold text-ink">2 · {t("femme.commissions.config.step2.title")}</h3>
          <p className="text-sm text-ink-3">{t("femme.commissions.config.step2.help")}</p>
        </div>
        <Link to={GROUPS} data-testid="config-step-2-link">
          <Button type="button" className={ACTION_BUTTON}>
            {t("femme.commissions.config.step2.open")}
          </Button>
        </Link>
      </div>
      {groups && services && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {tile("config-tile-groups", String(groups.length), t("femme.commissions.config.step2.tileGroups", { count: groups.length }), "plain")}
            {tile(
              "config-tile-grouped",
              t("femme.commissions.config.step2.ofTotal", { done: total - ungrouped, total }),
              t("femme.commissions.config.step2.tileGrouped"),
              "plain",
            )}
            {tile(
              "config-tile-ungrouped",
              String(ungrouped),
              t("femme.commissions.config.step2.tileUngrouped", { count: ungrouped }),
              ungrouped > 0 ? "warn" : "plain",
              ungrouped > 0 ? `${GROUPS}?group=none` : undefined,
            )}
          </div>
          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-ink-3">{t("femme.commissions.config.step2.yourGroups")}</span>
              {groups.map((g) => (
                <Link
                  key={g.id}
                  to={`${GROUPS}?group=${g.id}`}
                  data-testid="config-group-chip"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary-lt px-3.5 text-[13px] font-extrabold text-primary"
                >
                  {g.name} <span className="font-bold text-ink-2">{g.serviceCount}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );

  const step3 = (
    <section className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-5 shadow-sm" data-testid="config-step-3">
      <span aria-hidden className={`inline-flex size-8 items-center justify-center rounded-full font-extrabold ${withoutRules > 0 ? "bg-warning-lt text-warning" : "bg-success-lt text-success"}`}>
        {withoutRules > 0 ? "3" : "✓"}
      </span>
      <div className="min-w-0 flex-1 basis-72">
        <h3 className="font-heading text-lg font-extrabold text-ink">3 · {t("femme.commissions.config.step3.title")}</h3>
        <p className="text-sm text-ink-3" data-testid="config-step-3-status">
          {t("femme.commissions.config.step3.help")} ·{" "}
          <b className={withoutRules > 0 ? "text-warning" : "text-success"}>
            {withoutRules > 0 ? t("femme.commissions.config.step3.missing", { count: withoutRules }) : t("femme.commissions.config.step3.allSet")}
          </b>
        </p>
      </div>
      <Link to="/app/commissions/equipo" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-extrabold text-primary" data-testid="config-step-3-link">
        {t("femme.commissions.config.step3.open")}
      </Link>
    </section>
  );

  const after = (
    <section className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-ink-3/40 bg-surface p-5" data-testid="config-exceptions">
      <div className="min-w-0 flex-1 basis-72">
        <h3 className="font-heading text-base font-extrabold text-ink">{t("femme.commissions.config.exceptions.title")}</h3>
        <p className="text-sm text-ink-3">{t("femme.commissions.config.exceptions.help")}</p>
      </div>
      <Link to={`${GROUPS}?tab=exceptions`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-extrabold text-primary" data-testid="config-exceptions-link">
        {t("femme.commissions.config.exceptions.see")}
      </Link>
      <Link to="/app/commissions/configurar/avanzado" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-extrabold text-primary" data-testid="config-advanced-link">
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
      <SettingsTab part="setup" slots={{ step2, step3, after }} />
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
        <ol className="mt-1 list-decimal pl-5 text-sm text-ink-2">
          {[1, 2, 3, 4, 5].map((n) => (
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
