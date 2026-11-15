import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Input, Label, Modal, Select, Spinner } from "@design-system";
import {
  approveSettlement,
  downloadCommissionFile,
  generateSettlements,
  getOverview,
  paySettlement,
  settlementsCsvPath,
  voidSettlement,
  type Overview,
  type OverviewRow,
  type OverviewStatus,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate } from "../../lib/paraguayDateTime";
import { Avatar } from "./HomePage";
import { StatusChip } from "./StatusChip";
import { STATUS_META, periodLabel, useOverview } from "./overview";
import { todayYmd } from "./common";

type Dialog =
  | { kind: "GENERATE"; rows: OverviewRow[] }
  | { kind: "APPROVE"; rows: OverviewRow[] }
  | { kind: "PAY"; rows: OverviewRow[] }
  /** HU-COM-19: quick void of drafts; `skipped` = selected rows that are not drafts and stay as they are. */
  | { kind: "VOID"; rows: OverviewRow[]; skipped: number };

/** Reasons offered with one touch when voiding (the field is optional). */
const VOID_REASONS = ["mistake", "rule", "sale"] as const;

const FILTERS: (OverviewStatus | "ALL")[] = ["ALL", "UNSETTLED", "DRAFT", "APPROVED", "PAID", "NONE"];
/** What is left to do first, and the ones with nothing to settle last. */
const GROUP_ORDER: OverviewStatus[] = ["UNSETTLED", "DRAFT", "APPROVED", "PAID", "NONE"];
const GROUP_TONE: Record<OverviewStatus, string> = {
  UNSETTLED: "bg-warning-lt text-warning",
  DRAFT: "bg-primary-lt text-primary-dk",
  APPROVED: "bg-success-lt text-success",
  PAID: "bg-bg text-ink-2",
  NONE: "bg-bg text-ink-3",
};
const ACTION_STATUS = { GENERATE: "UNSETTLED", APPROVE: "DRAFT", PAY: "APPROVED" } as const;

/**
 * Comisiones › Liquidar (HU-COM-15): the period in three steps — generate, approve, pay — with the
 * state of each professional, bulk actions and the same buttons on every row.
 */
export default function LiquidarPage() {
  const { t, i18n } = useTranslation();
  const dateLocale = useDateLocale();
  const { refresh } = useOverview();
  const [params] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Overview | null>(null);
  const [filter, setFilter] = useState<OverviewStatus | "ALL">(() => {
    const s = params.get("state");
    return FILTERS.includes(s as OverviewStatus) ? (s as OverviewStatus) : "ALL";
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [method, setMethod] = useState("CASH");
  const [paidOn, setPaidOn] = useState(todayYmd());
  const [reference, setReference] = useState("");
  const [voidReason, setVoidReason] = useState("");
  /** Professionals whose draft was just voided: the notice offers to generate them again. */
  const [regen, setRegen] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getOverview(offset));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [offset, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every active professional is listed (also the ones with nothing to settle: «Sin movimientos»).
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const visible = rows.filter((r) => filter === "ALL" || r.status === filter);
  const byStatus = (s: OverviewStatus) => rows.filter((r) => r.status === s);
  const count = (s: OverviewStatus | "ALL") => (s === "ALL" ? rows.length : byStatus(s).length);
  const amountOf = (s: OverviewStatus) => byStatus(s).reduce((a, r) => a + r.amount, 0);

  function open(kind: "GENERATE" | "APPROVE" | "PAY", list: OverviewRow[]) {
    setDialogError(null);
    setNotice(null);
    setRegen(null);
    setMethod("CASH");
    setPaidOn(todayYmd());
    setReference("");
    setDialog({ kind, rows: list });
  }

  /** Voids only the drafts among `list`; anything else that was selected is left alone and said so. */
  function openVoid(list: OverviewRow[]) {
    const drafts = list.filter((r) => r.status === "DRAFT" && r.settlementId !== null);
    if (drafts.length === 0) return;
    setDialogError(null);
    setNotice(null);
    setRegen(null);
    setVoidReason("");
    setDialog({ kind: "VOID", rows: drafts, skipped: list.length - drafts.length });
  }

  /** Rows of the given state among the selected ones, or all of that state when none is selected. */
  const targets = (status: OverviewStatus) => {
    const chosen = rows.filter((r) => selected.has(r.professionalId) && r.status === status);
    return chosen.length > 0 ? chosen : byStatus(status);
  };

  async function confirm() {
    if (!dialog || !data) return;
    setBusy(true);
    setDialogError(null);
    try {
      if (dialog.kind === "GENERATE") {
        await generateSettlements({
          periodFrom: data.period.from!,
          periodTo: data.period.to!,
          professionalIds: dialog.rows.map((r) => r.professionalId),
          skipOverlapping: true,
        });
      } else if (dialog.kind === "APPROVE") {
        for (const r of dialog.rows) await approveSettlement(r.settlementId!);
      } else if (dialog.kind === "VOID") {
        for (const r of dialog.rows) await voidSettlement(r.settlementId!, voidReason.trim());
        setRegen(dialog.rows.map((r) => r.professionalId));
      } else {
        for (const r of dialog.rows) await paySettlement(r.settlementId!, method, paidOn || null, reference.trim());
      }
      const n = dialog.rows.length;
      setDialog(null);
      setSelected(new Set());
      setNotice(t(`femme.commissions.liquidar.done.${dialog.kind}`, { count: n }));
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setDialogError(translateApiError(err, t));
      await Promise.all([load(), refresh()]);
    } finally {
      setBusy(false);
    }
  }

  /** One line under the name: what is behind the amount (movements, settlement, payment day) or why there is none. */
  function rowNote(r: OverviewRow): string {
    if (r.status === "NONE") {
      return r.ruleCount === 0 ? t("femme.commissions.liquidar.note.noneNoRules") : t("femme.commissions.liquidar.note.none");
    }
    if (r.status === "UNSETTLED") return t("femme.commissions.liquidar.note.lines", { count: r.lineCount });
    if (r.status === "PAID" && r.paidOn) {
      return t("femme.commissions.liquidar.note.paidOn", { date: formatParaguayDate(`${r.paidOn}T12:00:00`, dateLocale) });
    }
    return r.settlementId ? t("femme.commissions.liquidar.note.settlement", { id: r.settlementId }) : "";
  }

  function rowAction(r: OverviewRow) {
    const a = STATUS_META[r.status].action;
    if (!a) return null;
    const testId = `liquidar-row-${a.toLowerCase()}`;
    const voidButton =
      r.status === "DRAFT" && r.settlementId ? (
        <Button
          type="button"
          variant="outline"
          className={`${ACTION_BUTTON} min-w-20 !border-danger/40 !text-danger`}
          data-testid="liquidar-row-void"
          aria-label={t("femme.commissions.liquidar.voidRowAria", { name: r.professionalName })}
          onClick={() => openVoid([r])}
        >
          {t("femme.commissions.liquidar.action.VOID")}
        </Button>
      ) : null;
    if (a === "VIEW") {
      return r.settlementId ? (
        <Link
          to={`/app/commissions/settlements/${r.settlementId}`}
          data-testid={testId}
          className="inline-flex min-h-11 min-w-24 items-center justify-center rounded-full bg-surface text-[13px] font-extrabold text-primary"
        >
          {t("femme.commissions.liquidar.action.VIEW")}
        </Link>
      ) : null;
    }
    return (
      <>
        <Button type="button" className={`${ACTION_BUTTON} min-w-24`} variant={a === "GENERATE" ? "secondary" : "primary"} data-testid={testId} onClick={() => open(a, [r])}>
          {t(`femme.commissions.liquidar.action.${a}`)}
        </Button>
        {voidButton}
      </>
    );
  }

  if (!data) return error ? <Alert variant="destructive">{error}</Alert> : <Spinner />;

  const currentStep = data.unsettled > 0 ? 1 : data.drafts > 0 ? 2 : data.approved > 0 ? 3 : 0;
  const steps = [
    { n: 1, kind: "GENERATE" as const, status: "UNSETTLED" as const, pending: data.unsettled },
    { n: 2, kind: "APPROVE" as const, status: "DRAFT" as const, pending: data.drafts },
    { n: 3, kind: "PAY" as const, status: "APPROVED" as const, pending: data.approved },
  ];
  const dialogTotal = dialog ? dialog.rows.reduce((a, r) => a + r.amount, 0) : 0;
  const dialogRetention = dialog ? dialog.rows.reduce((a, r) => a + r.retention, 0) : 0;
  const regenRows = regen ? rows.filter((r) => regen.includes(r.professionalId) && r.status === "UNSETTLED") : [];
  const selectedRows = rows.filter((r) => selected.has(r.professionalId));
  const names = (list: OverviewRow[]) => list.map((r) => r.professionalName).join(", ");

  return (
    <div className="flex flex-col gap-4" data-testid="liquidar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t("femme.commissions.liquidar.prevPeriod")}
            data-testid="liquidar-prev"
            onClick={() => setOffset((o) => o - 1)}
            className="min-h-11 min-w-11 rounded-xl border border-line bg-surface text-lg font-extrabold text-primary hover:bg-bg"
          >
            ‹
          </button>
          <span
            data-testid="liquidar-period"
            className="inline-flex min-h-12 items-center rounded-2xl border-2 border-primary bg-primary-lt px-4 font-heading text-base font-extrabold text-ink sm:text-lg"
          >
            {periodLabel(t, data.period, dateLocale)}
          </span>
          <button
            type="button"
            aria-label={t("femme.commissions.liquidar.nextPeriod")}
            data-testid="liquidar-next"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            className="min-h-11 min-w-11 rounded-xl border border-line bg-surface text-lg font-extrabold text-primary hover:bg-bg disabled:opacity-40"
          >
            ›
          </button>
        </div>
        <span className="text-[13px] text-ink-3">{t("femme.commissions.liquidar.periodicityNote")}</span>
      </div>

      <p className="rounded-2xl bg-primary-lt px-4 py-2.5 text-sm text-ink" data-testid="liquidar-scope">
        <b>{t("femme.commissions.liquidar.scopeAll", { count: data.rows.length })}</b>{" "}
        <span className="text-ink-2">
          {byStatus("NONE").length === 0
            ? t("femme.commissions.liquidar.scopeAllWith")
            : t("femme.commissions.liquidar.scopeSome", { count: byStatus("NONE").length, with: data.rows.length - byStatus("NONE").length, without: byStatus("NONE").length })}
        </span>
      </p>

      {notice && (
        <Alert variant="success" role="status" data-testid="liquidar-notice">
          <span className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 basis-60">{notice}</span>
            {regenRows.length > 0 && (
              <Button type="button" className={ACTION_BUTTON} data-testid="liquidar-regenerate" onClick={() => open("GENERATE", regenRows)}>
                {t("femme.commissions.liquidar.regenerate")}
              </Button>
            )}
          </span>
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <section className="grid gap-3 sm:grid-cols-3" data-testid="liquidar-steps">
        {steps.map((s) => (
          <div
            key={s.n}
            data-testid={`liquidar-step-${s.n}`}
            data-current={currentStep === s.n}
            className={`flex flex-col gap-1.5 rounded-[18px] bg-surface p-4 ${currentStep === s.n ? "border-2 border-primary" : "border-2 border-line"}`}
          >
            <div className="flex items-center gap-2.5">
              <span className={`inline-flex size-[30px] items-center justify-center rounded-full text-sm font-extrabold ${currentStep === s.n ? "bg-primary text-surface" : "bg-bg text-ink-2"}`}>
                {s.n}
              </span>
              <b className="text-[17px] text-ink">{t(`femme.commissions.liquidar.step${s.n}.title`)}</b>
            </div>
            <p className="min-h-9 text-[13px] text-ink-2">{t(`femme.commissions.liquidar.step${s.n}.help`)}</p>
            <div className="text-sm font-extrabold text-ink" data-testid={`liquidar-step-${s.n}-count`}>
              {t(`femme.commissions.liquidar.step${s.n}.count`, { count: s.pending, paid: data.paid })}
            </div>
            <div className="text-[13px] text-ink-2" data-testid={`liquidar-step-${s.n}-amount`}>
              {formatGuaraniesGs(amountOf(s.status))}
            </div>
            <Button
              type="button"
              className={ACTION_BUTTON}
              variant={currentStep === s.n ? "primary" : "secondary"}
              disabled={s.pending === 0}
              data-testid={`liquidar-step-${s.n}-action`}
              onClick={() => open(s.kind, targets(s.status))}
            >
              {t(`femme.commissions.liquidar.step${s.n}.button`, { count: s.pending })}
            </Button>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5" data-testid="liquidar-table">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-xl font-extrabold text-ink">{t("femme.commissions.liquidar.tableTitle")}</h2>
          <span className="text-[13px] text-ink-3">
            {t("femme.commissions.liquidar.total")}: <b className="text-ink" data-testid="liquidar-total">{formatGuaraniesGs(data.total)}</b>
            {" · "}
            {t("femme.commissions.liquidar.alreadyPaid")} <b className="text-ink" data-testid="liquidar-paid-total">{formatGuaraniesGs(amountOf("PAID"))}</b>
          </span>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("femme.commissions.liquidar.filterAria")}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              data-testid={`liquidar-filter-${f}`}
              onClick={() => setFilter(f)}
              className={`min-h-[38px] rounded-full border px-3.5 text-[13px] font-extrabold ${
                filter === f ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink hover:bg-bg"
              }`}
            >
              {t(f === "ALL" ? "femme.commissions.liquidar.filterAll" : `femme.commissions.status.${f}`)} · {count(f)}
            </button>
          ))}
        </div>

        {selectedRows.length > 0 && (
          <div role="region" aria-label={t("femme.commissions.liquidar.selectionAria")} data-testid="liquidar-selection" className="flex flex-wrap items-center gap-3 rounded-2xl bg-ink px-4 py-2.5 text-surface">
            <span className="flex-1 basis-48 text-sm">
              <b data-testid="liquidar-selection-count">{t("femme.commissions.liquidar.selectedCount", { count: selectedRows.length })}</b> ·{" "}
              {formatGuaraniesGs(selectedRows.reduce((a, r) => a + r.amount, 0))}
            </span>
            {selectedRows.some((r) => r.status === "DRAFT") && (
              <button
                type="button"
                data-testid="liquidar-bulk-void"
                onClick={() => openVoid(selectedRows)}
                className="inline-flex min-h-11 items-center rounded-full bg-surface px-5 text-sm font-extrabold text-danger"
              >
                {t("femme.commissions.liquidar.bulkVoid")}
              </button>
            )}
            <button type="button" data-testid="liquidar-selection-clear" onClick={() => setSelected(new Set())} className="inline-flex min-h-11 items-center px-3 text-sm font-extrabold">
              {t("femme.commissions.liquidar.clearSelection")}
            </button>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-ink-3" data-testid="liquidar-empty">
            {t("femme.commissions.liquidar.empty")}
          </p>
        ) : (
          <div className="w-full overflow-x-auto">
            <div className="min-w-[48rem]">
              <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_8rem_8rem_9.5rem_13.5rem] gap-2 pb-1 pt-1 text-[11px] font-extrabold uppercase tracking-wide text-ink-3">
                <span />
                <span>{t("femme.commissions.liquidar.colProfessional")}</span>
                <span className="text-right">{t("femme.commissions.liquidar.colAmount")}</span>
                <span className="text-right">{t("femme.commissions.liquidar.colRetained")}</span>
                <span className="text-center">{t("femme.commissions.liquidar.colState")}</span>
                <span />
              </div>
              {GROUP_ORDER.map((status) => {
                const list = visible.filter((r) => r.status === status);
                if (list.length === 0) return null;
                const subtotal = list.reduce((a, r) => a + r.amount, 0);
                return (
                  <div key={status} data-testid={`liquidar-group-${status}`} className="flex flex-col">
                    <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2 text-sm font-extrabold ${GROUP_TONE[status]}`}>
                      <span className="inline-flex items-center gap-2.5">
                        {status !== "NONE" && status !== "PAID" && (
                          <input
                            type="checkbox"
                            className="size-[18px] accent-[var(--color-primary)]"
                            aria-label={t("femme.commissions.liquidar.pickGroup", { group: t(`femme.commissions.status.${status}`) })}
                            checked={list.every((r) => selected.has(r.professionalId))}
                            data-testid={`liquidar-group-check-${status}`}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                const all = list.every((r) => next.has(r.professionalId));
                                list.forEach((r) => (all ? next.delete(r.professionalId) : next.add(r.professionalId)));
                                return next;
                              })
                            }
                          />
                        )}
                        {t(`femme.commissions.status.${status}`)} · {list.length}
                      </span>
                      <span className="text-[13px] font-bold" data-testid={`liquidar-group-${status}-subtotal`}>
                        {t(`femme.commissions.liquidar.subtotal.${status}`, { amount: formatGuaraniesGs(subtotal) })}
                      </span>
                    </div>
                    <ul>
                      {list.map((r) => (
                        <li
                          key={r.professionalId}
                          data-testid="liquidar-row"
                          data-professional={r.professionalName}
                          data-status={r.status}
                          className="grid grid-cols-[1.5rem_minmax(0,1fr)_8rem_8rem_9.5rem_13.5rem] items-center gap-2 border-t border-line py-2 first:border-t-0"
                        >
                          {r.status === "NONE" ? (
                            <span aria-hidden />
                          ) : (
                            <input
                              type="checkbox"
                              className="size-[18px] accent-[var(--color-primary)]"
                              aria-label={t("femme.commissions.liquidar.pick", { name: r.professionalName })}
                              checked={selected.has(r.professionalId)}
                              data-testid="liquidar-row-check"
                              onChange={() =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.professionalId)) next.delete(r.professionalId);
                                  else next.add(r.professionalId);
                                  return next;
                                })
                              }
                            />
                          )}
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Avatar name={r.professionalName} />
                            <span className="flex min-w-0 flex-col">
                              <Link to={`/app/commissions/equipo/${r.professionalId}`} className="min-w-0 truncate font-extrabold text-ink">
                                {r.professionalName}
                              </Link>
                              <span className="truncate text-xs text-ink-3" data-testid="liquidar-row-note">
                                {rowNote(r)}
                              </span>
                              {r.settlementId && r.status !== "PAID" && (
                                <Link to={`/app/commissions/settlements/${r.settlementId}`} className="text-xs font-bold text-primary" data-testid="liquidar-row-detail">
                                  {t("femme.commissions.liquidar.detail")}
                                </Link>
                              )}
                            </span>
                          </span>
                          <b className={`text-right tabular-nums ${r.status === "NONE" ? "text-ink-3" : ""}`} data-testid="liquidar-row-amount">
                            {r.status === "NONE" ? "—" : formatGuaraniesGs(r.amount)}
                          </b>
                          <span className="text-right text-sm font-bold tabular-nums text-warning" data-testid="liquidar-row-retention">
                            {data.aguinaldoEnabled && r.retention > 0 ? formatGuaraniesGs(r.retention) : "—"}
                          </span>
                          <StatusChip status={r.status} />
                          <span className="flex items-center justify-end gap-2">{rowAction(r)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm text-ink-3">
          <span>{t("femme.commissions.liquidar.withSelected")}</span>
          {(["GENERATE", "APPROVE", "PAY"] as const).map((k) => {
            const list = rows.filter((r) => selected.has(r.professionalId) && r.status === ACTION_STATUS[k]);
            return (
              <Button key={k} type="button" variant="secondary" className={ACTION_BUTTON} disabled={list.length === 0} data-testid={`liquidar-bulk-${k.toLowerCase()}`} onClick={() => open(k, list)}>
                {t(`femme.commissions.liquidar.action.${k}`)}
              </Button>
            );
          })}
          <Button
            type="button"
            variant="secondary"
            className={`${ACTION_BUTTON} ml-auto`}
            data-testid="liquidar-csv"
            onClick={() =>
              void downloadCommissionFile(settlementsCsvPath({}, i18n.language), "liquidaciones.csv").catch((err) => setError(translateApiError(err, t)))
            }
          >
            {t("femme.commissions.liquidar.csv")}
          </Button>
        </div>
      </section>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog ? t(`femme.commissions.liquidar.dialog.${dialog.kind}.title`, { count: dialog.rows.length }) : ""}
        description={dialog ? t(`femme.commissions.liquidar.dialog.${dialog.kind}.description`) : undefined}
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setDialog(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              variant={dialog?.kind === "VOID" ? "danger" : "primary"}
              className={`${ACTION_BUTTON} w-full sm:w-auto`}
              disabled={busy}
              data-testid="liquidar-confirm"
              onClick={() => void confirm()}
            >
              {dialog ? t(`femme.commissions.liquidar.dialog.${dialog.kind}.confirm`, { count: dialog.rows.length }) : ""}
            </Button>
          </>
        }
      >
        {dialog && (
          <div className="flex flex-col gap-3" data-testid="liquidar-dialog">
            {dialog.kind === "VOID" ? (
              <ul className="rounded-xl border border-line text-sm text-ink" data-testid="liquidar-dialog-summary">
                {dialog.rows.map((r) => (
                  <li key={r.professionalId} className="flex justify-between gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
                    <span>
                      <b>{r.professionalName}</b> · {t("femme.commissions.liquidar.note.settlement", { id: r.settlementId })}
                    </span>
                    <b className="tabular-nums">{formatGuaraniesGs(r.amount)}</b>
                  </li>
                ))}
              </ul>
            ) : (
            <div className="rounded-xl bg-primary-lt p-3 text-sm text-ink" data-testid="liquidar-dialog-summary">
              <div>{names(dialog.rows)}</div>
              <b>{t("femme.commissions.liquidar.dialog.total", { amount: formatGuaraniesGs(dialogTotal) })}</b>
              {data.aguinaldoEnabled && dialogRetention > 0 && (
                <span className="ml-1">· {t("femme.commissions.liquidar.dialog.retained", { amount: formatGuaraniesGs(dialogRetention) })}</span>
              )}
            </div>
            )}
            {dialog.kind === "VOID" && (
              <>
                {dialog.skipped > 0 && (
                  <p className="text-sm text-ink-2" data-testid="liquidar-void-skipped">
                    {t("femme.commissions.liquidar.dialog.VOID.skipped", { count: dialog.skipped })}
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="liquidar-void-reason">
                    {t(dialog.rows.length > 1 ? "femme.commissions.liquidar.dialog.VOID.reasonAll" : "femme.commissions.liquidar.dialog.VOID.reason")}
                  </Label>
                  <Input
                    id="liquidar-void-reason"
                    value={voidReason}
                    maxLength={500}
                    placeholder={t("femme.commissions.liquidar.dialog.VOID.placeholder")}
                    data-testid="liquidar-void-reason"
                    onChange={(e) => setVoidReason(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {VOID_REASONS.map((k) => {
                      const text = t(`femme.commissions.liquidar.dialog.VOID.reasons.${k}`);
                      return (
                        <button
                          key={k}
                          type="button"
                          data-testid={`liquidar-void-reason-${k}`}
                          onClick={() => setVoidReason(text)}
                          className="min-h-9 rounded-full border border-line px-3.5 text-[13px] font-bold text-ink hover:bg-bg"
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            {dialog.kind === "GENERATE" && (
              <p className="text-sm text-ink-2">
                {t("femme.commissions.liquidar.dialog.GENERATE.period", { period: periodLabel(t, data.period, dateLocale) })}
              </p>
            )}
            {dialog.kind === "APPROVE" && <p className="text-sm text-ink-2">{t("femme.commissions.liquidar.dialog.APPROVE.warning")}</p>}
            {dialog.kind === "PAY" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="liquidar-method">{t("femme.commissions.liquidar.dialog.PAY.method")}</Label>
                  <Select id="liquidar-method" value={method} onChange={(e) => setMethod(e.target.value)} data-testid="liquidar-method">
                    {(["CASH", "TRANSFER", "OTHER"] as const).map((m) => (
                      <option key={m} value={m}>
                        {t(`femme.commissions.paymentMethod.${m}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="liquidar-paid-on">{t("femme.commissions.liquidar.dialog.PAY.date")}</Label>
                  <LocalizedDateInput id="liquidar-paid-on" value={paidOn} onChange={setPaidOn} />
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <Label htmlFor="liquidar-reference">{t("femme.commissions.liquidar.dialog.PAY.reference")}</Label>
                  <Input id="liquidar-reference" value={reference} onChange={(e) => setReference(e.target.value)} data-testid="liquidar-reference" />
                </div>
              </div>
            )}
            {dialogError && <Alert variant="destructive">{dialogError}</Alert>}
          </div>
        )}
      </Modal>
    </div>
  );
}
