import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button, Spinner } from "@design-system";
import { getSettings, type Overview } from "../../api/commissions";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatPercent } from "./common";
import { STATUS_META, periodLabel, setupProgress, summarize, useOverview } from "./overview";
import { StatusChip } from "./StatusChip";

/** The three steps to leave commissions ready: what each is for and where to do it (HU-COM-15 / HU-COM-20). */
function SetupGuide({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const p = setupProgress(overview);
  const done = 1 + (p.groupsDone ? 1 : 0) + (p.aguinaldoDone ? 1 : 0);
  const current = !p.groupsDone ? 2 : 3;
  /** `key` is the i18n block of the step (the aguinaldo step keeps its old text block). */
  const step = (n: number, key: number, doneStep: boolean, to: string, optional = false) => {
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
              {t(`femme.commissions.guide.step${key}.title`)}
              {optional && <span className="ml-2 text-xs font-bold text-ink-3">{t("femme.commissions.guide.optional")}</span>}
            </div>
            <div className="text-sm text-ink-3">{t(`femme.commissions.guide.step${key}.${doneStep ? "done" : "todo"}`, { count: overview.groupsWithoutPercent })}</div>
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
              <p className="mt-1">{t(`femme.commissions.guide.step${key}.why`)}</p>
              <p className="mt-1 text-ink-2">{t(`femme.commissions.guide.step${key}.example`)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={to} data-testid={`setup-step-${n}-start`}>
                <Button type="button" className={ACTION_BUTTON}>
                  {t(`femme.commissions.guide.step${key}.start`)}
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
          <div className="flex h-2.5 flex-1 gap-0.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={done}>
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex-1 ${i <= done ? "bg-primary" : ""}`} />
            ))}
          </div>
          <b className="text-sm text-primary" data-testid="setup-progress">
            {t("femme.commissions.guide.progress", { done, total: 3 })}
          </b>
        </div>
      </section>
      {step(1, 1, true, "/app/commissions/configurar")}
      {step(2, 2, p.groupsDone, "/app/commissions/configurar/comisiones")}
      {step(3, 4, p.aguinaldoDone, "/app/commissions/configurar", true)}
      <p className="px-1 text-sm text-ink-3">{t("femme.commissions.guide.footer")}</p>
    </div>
  );
}

/** How each row of «Para revisar» looks: the icon tile and the number say the kind (money lost / to set up / paperwork). */
const REVIEW_TONE = {
  money: { tile: "bg-warning-lt text-warning", count: "text-warning" },
  setup: { tile: "bg-primary-lt text-primary", count: "text-primary" },
  paperwork: { tile: "bg-bg text-ink-2", count: "text-ink-2" },
} as const;

/** The icon of each notice (decorative: the text says everything). */
function ReviewIcon({ kind }: { kind: "lines" | "noPercent" | "drafts" }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (kind === "lines")
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21v-1a6 6 0 0 1 6-6h2" />
        <path d="M16 16l5 5M21 16l-5 5" />
      </svg>
    );
  if (kind === "noPercent")
    return (
      <svg {...common}>
        <path d="M19 5L5 19" />
        <circle cx="7" cy="7" r="2.5" />
        <circle cx="17" cy="17" r="2.5" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

/** Comisiones › Inicio: the period's money split in what is paid and what is left, the 4 steps, and the team (HU-COM-17). */
export default function HomePage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const navigate = useNavigate();
  const { overview: o } = useOverview();
  /** The % a group without its own pays (the general one for services), to say it in the notice. */
  const [generalService, setGeneralService] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(getSettings())
      .then((s) => {
        if (live && typeof s?.defaultPercentService === "number") setGeneralService(s.defaultPercentService);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!o) return <Spinner />;
  if (setupProgress(o).firstTime) return <SetupGuide overview={o} />;

  const sum = summarize(o);
  // From what loses the most money to the least: the first one gets the filled button.
  const review = [
    { key: "lines" as const, n: o.linesWithoutProfessional, to: "/app/commissions/actividad?tab=reports" },
    { key: "noPercent" as const, n: o.groupsWithoutPercent, to: "/app/commissions/configurar/comisiones" },
    { key: "drafts" as const, n: o.drafts, to: "/app/commissions/liquidar?state=DRAFT" },
  ].filter((r) => r.n > 0);
  const STEP_ACTION = { UNSETTLED: "GENERATE", DRAFT: "APPROVE", APPROVED: "PAY", PAID: "VIEW" } as const;
  const STEP_TONE = {
    UNSETTLED: "border-warning/50 bg-warning-lt",
    DRAFT: "border-[#8FC1C5] bg-primary-lt/60",
    APPROVED: "border-[#4FA97A] bg-success-lt/70",
    PAID: "border-line bg-surface",
  } as const;
  const withMoves = sum.steps.flatMap((s) => s.rows);
  const noneNames = sum.none.rows.map((r) => r.professionalName);

  return (
    <div className="flex flex-col gap-5" data-testid="commissions-home">
      <section className="flex flex-col gap-4 rounded-[20px] bg-primary p-5 text-surface sm:p-6" data-testid="home-hero">
        <div className="text-sm font-bold text-primary-lt">{t("femme.commissions.home.heroTitle", { period: periodLabel(t, o.period, dateLocale) })}</div>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="font-heading text-4xl font-extrabold leading-tight sm:text-5xl" data-testid="home-total">
              {formatGuaraniesGs(sum.total)}
            </div>
            <div className="mt-1 text-sm text-primary-lt" data-testid="home-progress-text">
              {sum.withMovements === 0
                ? t("femme.commissions.home.nothingYet")
                : t("femme.commissions.home.totalOf", { count: sum.withMovements })}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-40 rounded-2xl bg-primary-dk/60 px-4 py-3" data-testid="home-paid">
              <div className="text-xs font-extrabold text-primary-lt">{t("femme.commissions.home.paid")}</div>
              <b className="font-heading text-xl tabular-nums" data-testid="home-paid-amount">
                {formatGuaraniesGs(sum.paid)}
              </b>
              <div className="text-xs text-primary-lt">{t("femme.commissions.home.people", { count: sum.paidPeople })}</div>
            </div>
            <div className="min-w-40 rounded-2xl bg-surface px-4 py-3 text-ink" data-testid="home-pending">
              <div className="text-xs font-extrabold text-ink-3">{t("femme.commissions.home.pending")}</div>
              <b className="font-heading text-xl tabular-nums text-primary" data-testid="home-pending-amount">
                {formatGuaraniesGs(sum.pending)}
              </b>
              <div className="text-xs text-ink-2">{t("femme.commissions.home.people", { count: sum.pendingPeople })}</div>
            </div>
          </div>
        </div>
        {/* The width of each part is the money in that state. */}
        <div
          className="flex h-3.5 gap-[3px] overflow-hidden rounded-full bg-primary-dk"
          role="img"
          aria-label={t("femme.commissions.home.barAria")}
          data-testid="home-bar"
        >
          {sum.steps.map((s) => (s.amount > 0 ? <div key={s.status} className={STATUS_META[s.status].dot} style={{ flex: s.amount }} /> : null))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-primary-lt">
          {sum.steps.map((s) => (
            <span key={s.status} className="inline-flex items-center gap-2" data-testid={`home-legend-${s.status}`}>
              <span aria-hidden className={`size-3 rounded ${STATUS_META[s.status].dot}`} />
              {t(`femme.commissions.status.${s.status}`)} <b className="text-surface">{formatGuaraniesGs(s.amount)}</b>
            </span>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" data-testid="home-steps">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-xl font-extrabold text-ink">{t("femme.commissions.home.stepsTitle")}</h2>
          <span className="text-[13px] text-ink-3">{t("femme.commissions.home.stepsHint")}</span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {sum.steps.map((s, i) => (
            <div key={s.status} data-testid={`home-step-${s.status}`} className={`flex flex-col gap-1.5 rounded-[18px] border-2 p-3.5 ${STEP_TONE[s.status]}`}>
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-full bg-ink-2 text-xs font-extrabold text-surface">
                  {i + 1}
                </span>
                <b className="text-[15px] text-ink">{t(`femme.commissions.status.${s.status}`)}</b>
              </div>
              <div className="font-heading text-2xl font-extrabold leading-tight text-ink" data-testid="home-step-people">
                {t("femme.commissions.home.people", { count: s.people })}
              </div>
              <div className="min-h-[18px] text-[13px] text-ink-2" data-testid="home-step-amount">
                {s.people === 0 ? "—" : t(`femme.commissions.home.stepAmount.${s.status}`, { amount: formatGuaraniesGs(s.amount) })}
              </div>
              {s.people > 0 ? (
                <Link
                  to={`/app/commissions/liquidar?state=${s.status}`}
                  data-testid={`home-step-${s.status}-action`}
                  className={`mt-1 inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-sm font-extrabold ${
                    s.status === "PAID" || s.status === "UNSETTLED" ? "border-line bg-surface text-primary" : "border-primary bg-primary text-surface"
                  }`}
                >
                  {t(`femme.commissions.home.stepAction.${STEP_ACTION[s.status]}`)}
                </Link>
              ) : (
                <span className="mt-1 inline-flex min-h-11 items-center text-[13px] text-ink-3">{t("femme.commissions.home.stepNothing")}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" data-testid="home-review">
        <h2 className="font-heading text-xl font-extrabold text-ink">{t("femme.commissions.home.reviewTitle")}</h2>
        {review.length === 0 ? (
          <p className="rounded-card border border-line bg-surface p-4 text-ink-2" data-testid="home-review-empty">
            {t("femme.commissions.home.allGood")}
          </p>
        ) : (
          <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-card border border-line bg-surface p-0">
            {review.map((r, i) => {
              // A group without its % is paid the general %: when that is 0 %, it is paid nothing (and that is what to fix).
              const unpaid = r.key === "noPercent" && generalService === 0;
              const tone = r.key === "lines" || unpaid ? "money" : r.key === "noPercent" ? "setup" : "paperwork";
              const style = REVIEW_TONE[tone];
              const percent = generalService === null ? "" : formatPercent(generalService).replace(/\s/g, "\u00a0");
              const help =
                r.key !== "noPercent" || generalService === null
                  ? t(`femme.commissions.home.review.${r.key}.help`, { count: r.n })
                  : t(`femme.commissions.home.review.noPercent.${unpaid ? "helpZero" : "helpPercent"}`, { percent });
              return (
                <li key={r.key} data-testid={`home-review-${r.key}`} data-tone={tone} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                  <span aria-hidden className={`inline-flex size-12 shrink-0 items-center justify-center rounded-2xl ${style.tile}`}>
                    <ReviewIcon kind={r.key} />
                  </span>
                  <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
                    <div className="leading-snug text-ink" data-testid="home-review-title">
                      <b className={`font-heading text-xl ${style.count}`} data-testid="home-review-count">
                        {r.n}
                      </b>{" "}
                      <span className="font-extrabold">{t(`femme.commissions.home.review.${r.key}.title`, { count: r.n })}</span>
                    </div>
                    <p className={`text-sm ${unpaid ? "font-bold text-warning" : "text-ink-2"}`} data-testid="home-review-help">
                      {help}
                    </p>
                  </div>
                  {/* Only the first row carries the filled button: it is the one to do first. */}
                  <Button
                    type="button"
                    variant={i === 0 ? "primary" : "outline"}
                    className={`${ACTION_BUTTON} shrink-0`}
                    onClick={() => navigate(r.to)}
                    data-testid={`home-review-${r.key}-action`}
                  >
                    {t(`femme.commissions.home.review.${r.key}.action`)}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5" data-testid="home-team">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-xl font-extrabold text-ink">{t("femme.commissions.home.teamTitle")}</h2>
          <span className="text-sm text-ink-2" data-testid="home-team-counts">
            <b>{t("femme.commissions.home.teamActive", { count: sum.active })}</b> ·{" "}
            {t("femme.commissions.home.teamWith", { count: sum.withMovements })} · {t("femme.commissions.home.teamWithout", { count: sum.none.people })}
          </span>
        </div>
        {sum.active > 0 && (
          <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-bg" role="img" aria-label={t("femme.commissions.home.teamBarAria", { with: sum.withMovements, without: sum.none.people })}>
            {sum.withMovements > 0 && <div className="bg-primary" style={{ flex: sum.withMovements }} />}
            {sum.none.people > 0 && <div className="bg-line" style={{ flex: sum.none.people }} />}
          </div>
        )}
        {sum.active === 0 ? (
          <p className="text-ink-3">{t("femme.commissions.home.teamEmpty")}</p>
        ) : (
          <ul>
            {withMoves.slice(0, 7).map((r) => (
              <li key={r.professionalId} data-testid="home-team-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2">
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
        {sum.none.people > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bg px-4 py-3" data-testid="home-team-none">
            <span className="min-w-0 flex-1 basis-64 text-sm text-ink-2">
              <b>{t("femme.commissions.home.noneTitle", { count: sum.none.people })}</b>{" "}
              {noneNames.slice(0, 6).join(", ")}
              {noneNames.length > 6 ? t("femme.commissions.home.noneMore", { count: noneNames.length - 6 }) : ""}
            </span>
            <Link to="/app/commissions/liquidar?state=NONE" data-testid="home-team-none-link" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-extrabold text-primary">
              {t("femme.commissions.home.noneSee", { count: sum.none.people })}
            </Link>
          </div>
        )}
        <Link to="/app/commissions/equipo" data-testid="home-team-all" className="inline-flex min-h-11 items-center self-start text-sm font-extrabold text-primary">
          {t("femme.commissions.home.teamAll")}
        </Link>
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
