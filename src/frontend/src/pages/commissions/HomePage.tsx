import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button, Spinner } from "@design-system";
import type { Overview } from "../../api/commissions";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { STATUS_META, periodLabel, setupProgress, useOverview } from "./overview";
import { StatusChip } from "./StatusChip";

/** Avatar with the two first letters. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-bg text-xs font-extrabold text-ink-2"
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** The four steps to leave commissions ready: what each is for and where to do it (HU-COM-15). */
function SetupGuide({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const p = setupProgress(overview);
  const done = 1 + (p.groupsDone ? 1 : 0) + (p.rulesDone ? 1 : 0) + (p.aguinaldoDone ? 1 : 0);
  const current = !p.groupsDone ? 2 : !p.rulesDone ? 3 : 4;
  const step = (n: number, doneStep: boolean, to: string, optional = false) => {
    const isCurrent = n === current && !doneStep;
    return (
      <div
        key={n}
        data-testid={`setup-step-${n}`}
        data-state={doneStep ? "done" : isCurrent ? "current" : "todo"}
        className={`flex flex-col gap-3 rounded-card bg-surface p-4 shadow-sm ${isCurrent ? "border-2 border-primary" : "border border-line"} ${
          !doneStep && !isCurrent ? "opacity-80" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex size-[34px] shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold ${
              doneStep ? "bg-success text-surface" : isCurrent ? "bg-primary text-surface" : "bg-bg text-ink-2"
            }`}
          >
            {doneStep ? "✓" : n}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-heading text-base font-extrabold text-ink">
              {t(`femme.commissions.guide.step${n}.title`)}
              {optional && <span className="ml-2 text-xs font-bold text-ink-3">{t("femme.commissions.guide.optional")}</span>}
            </div>
            <div className="text-sm text-ink-3">{t(`femme.commissions.guide.step${n}.${doneStep ? "done" : "todo"}`, { count: overview.ungroupedServices })}</div>
          </div>
          {(!isCurrent || optional) && (
            <Link to={to} className="inline-flex min-h-11 items-center text-sm font-extrabold text-primary" data-testid={`setup-step-${n}-link`}>
              {t(`femme.commissions.guide.${doneStep ? "change" : "open"}`)}
            </Link>
          )}
        </div>
        {isCurrent && (
          <>
            <div className="rounded-xl bg-primary-lt p-3 text-sm text-ink">
              <div className="text-xs font-extrabold text-primary-dk">{t("femme.commissions.guide.whatFor")}</div>
              <p className="mt-1">{t(`femme.commissions.guide.step${n}.why`)}</p>
              <p className="mt-1 text-ink-2">{t(`femme.commissions.guide.step${n}.example`)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={to} data-testid={`setup-step-${n}-start`}>
                <Button type="button" className={ACTION_BUTTON}>
                  {t(`femme.commissions.guide.step${n}.start`)}
                </Button>
              </Link>
            </div>
          </>
        )}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-3" data-testid="setup-guide">
      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5 shadow-sm">
        <h2 className="font-heading text-2xl font-extrabold text-ink">{t("femme.commissions.guide.title")}</h2>
        <p className="max-w-xl text-ink-2">{t("femme.commissions.guide.intro")}</p>
        <div className="flex items-center gap-3">
          <div className="flex h-2.5 flex-1 gap-0.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={done}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`flex-1 ${i <= done ? "bg-primary" : ""}`} />
            ))}
          </div>
          <b className="text-sm text-primary" data-testid="setup-progress">
            {t("femme.commissions.guide.progress", { done, total: 4 })}
          </b>
        </div>
      </section>
      {step(1, true, "/app/commissions/configurar")}
      {step(2, p.groupsDone, "/app/commissions/configurar/grupos?group=none")}
      {step(3, p.rulesDone, "/app/commissions/equipo")}
      {step(4, p.aguinaldoDone, "/app/commissions/configurar", true)}
      <p className="px-1 text-sm text-ink-3">{t("femme.commissions.guide.footer")}</p>
    </div>
  );
}

/** Comisiones › Inicio: how much is owed, who is where, and what is worth reviewing (HU-COM-15). */
export default function HomePage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const navigate = useNavigate();
  const { overview: o } = useOverview();
  const [showHow, setShowHow] = useState(false);
  if (!o) return <Spinner />;
  if (setupProgress(o).firstTime) return <SetupGuide overview={o} />;

  const active = o.rows.filter((r) => r.status !== "NONE");
  const liquidated = o.drafts + o.approved + o.paid;
  const review = [
    { key: "lines", n: o.linesWithoutProfessional, to: "/app/commissions/actividad?tab=reports" },
    { key: "ungrouped", n: o.ungroupedServices, to: "/app/commissions/configurar/grupos?group=none" },
    { key: "noRules", n: o.professionalsWithoutRules, to: "/app/commissions/equipo?filter=norules" },
    { key: "drafts", n: o.drafts, to: "/app/commissions/liquidar?state=DRAFT" },
  ].filter((r) => r.n > 0);
  const segments = [
    { n: o.unsettled, cls: STATUS_META.UNSETTLED.dot },
    { n: o.drafts, cls: STATUS_META.DRAFT.dot },
    { n: o.approved, cls: STATUS_META.APPROVED.dot },
    { n: o.paid, cls: STATUS_META.PAID.dot },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="commissions-home">
      <section className="flex flex-col gap-3 rounded-[20px] bg-primary p-5 text-surface sm:p-6" data-testid="home-hero">
        <div className="text-sm font-bold text-primary-lt">{t("femme.commissions.home.toPay", { period: periodLabel(t, o.period, dateLocale) })}</div>
        <div className="font-heading text-4xl font-extrabold leading-tight sm:text-5xl" data-testid="home-total">
          {formatGuaraniesGs(o.total)}
        </div>
        <div className="text-primary-lt" data-testid="home-progress-text">
          {active.length === 0
            ? t("femme.commissions.home.nothingYet")
            : t("femme.commissions.home.progress", { people: active.length, liquidated, missing: Math.max(0, active.length - liquidated) })}
        </div>
        <div className="flex h-3.5 gap-[3px] overflow-hidden rounded-full bg-primary-dk" aria-hidden>
          {segments.map((s, i) => (s.n > 0 ? <div key={i} className={s.cls} style={{ flex: s.n }} /> : null))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-primary-lt">
          <span>{t("femme.commissions.home.legend.UNSETTLED", { count: o.unsettled })}</span>
          <span>{t("femme.commissions.home.legend.DRAFT", { count: o.drafts })}</span>
          <span>{t("femme.commissions.home.legend.APPROVED", { count: o.approved })}</span>
          <span>{t("femme.commissions.home.legend.PAID", { count: o.paid })}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-2.5">
          <Link
            to="/app/commissions/liquidar"
            data-testid="home-continue"
            className="inline-flex min-h-12 items-center rounded-full bg-surface px-6 text-base font-extrabold text-primary"
          >
            {t("femme.commissions.home.continue")}
          </Link>
          <button
            type="button"
            aria-expanded={showHow}
            data-testid="home-how-toggle"
            onClick={() => setShowHow((v) => !v)}
            className="inline-flex min-h-12 items-center rounded-full border border-primary-lt px-5 text-[15px] font-extrabold text-surface"
          >
            {t("femme.commissions.home.how")}
          </button>
        </div>
      </section>

      {showHow && (
        <section className="rounded-card border border-line bg-surface p-4 shadow-sm" data-testid="home-how">
          <h2 className="font-heading text-base font-extrabold text-ink">{t("femme.commissions.home.howTitle")}</h2>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-2">
            <li>{t("femme.commissions.home.how1")}</li>
            <li>{t("femme.commissions.home.how2")}</li>
            <li>{t("femme.commissions.home.how3")}</li>
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-2.5" data-testid="home-review">
        <h2 className="font-heading text-xl font-extrabold text-ink">{t("femme.commissions.home.reviewTitle")}</h2>
        {review.length === 0 ? (
          <p className="rounded-card border border-line bg-surface p-4 text-ink-2" data-testid="home-review-empty">
            {t("femme.commissions.home.allGood")}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {review.map((r) => (
              <div key={r.key} data-testid={`home-review-${r.key}`} className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4">
                <div className="flex items-baseline gap-2.5">
                  <b className="font-heading text-3xl text-warning" data-testid="home-review-count">
                    {r.n}
                  </b>
                  <span className="font-extrabold text-ink">{t(`femme.commissions.home.review.${r.key}.title`, { count: r.n })}</span>
                </div>
                <p className="min-h-9 text-[13px] text-ink-3">{t(`femme.commissions.home.review.${r.key}.help`)}</p>
                <Button type="button" variant="secondary" className={`${ACTION_BUTTON} self-start`} onClick={() => navigate(r.to)} data-testid={`home-review-${r.key}-action`}>
                  {t(`femme.commissions.home.review.${r.key}.action`)}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5" data-testid="home-team">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-xl font-extrabold text-ink">{t("femme.commissions.home.teamTitle")}</h2>
          <Link to="/app/commissions/equipo" className="inline-flex min-h-11 items-center text-sm font-extrabold text-primary">
            {t("femme.commissions.home.teamAll")}
          </Link>
        </div>
        {active.length === 0 ? (
          <p className="mt-2 text-ink-3">{t("femme.commissions.home.teamEmpty")}</p>
        ) : (
          <ul className="mt-2">
            {active.slice(0, 6).map((r) => (
              <li key={r.professionalId} data-testid="home-team-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2">
                <Avatar name={r.professionalName} />
                <Link to={`/app/commissions/equipo/${r.professionalId}`} className="min-w-0 flex-1 basis-28 truncate font-extrabold text-ink">
                  {r.professionalName}
                </Link>
                <b className="tabular-nums text-ink" data-testid="home-team-amount">
                  {formatGuaraniesGs(r.amount)}
                </b>
                <StatusChip status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {o.aguinaldoEnabled && (
        <section className="flex flex-col gap-1 rounded-card border border-warning/35 bg-warning-lt p-4" data-testid="home-aguinaldo">
          <div className="text-sm font-extrabold text-warning">{t("femme.commissions.home.aguinaldoTitle")}</div>
          <b className="font-heading text-2xl tabular-nums text-warning" data-testid="home-aguinaldo-balance">
            {formatGuaraniesGs(o.aguinaldoBalance)}
          </b>
          <p className="text-[13px] text-warning">{t("femme.commissions.home.aguinaldoHelp")}</p>
          <Link to="/app/commissions/equipo/aguinaldo" className="inline-flex min-h-11 items-center text-sm font-extrabold text-warning">
            {t("femme.commissions.home.aguinaldoLink")}
          </Link>
        </section>
      )}
    </div>
  );
}
