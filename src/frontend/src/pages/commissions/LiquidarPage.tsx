import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MoreActionsMenu } from "../../components/MoreActionsMenu";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate } from "../../lib/paraguayDateTime";
import { Avatar } from "./HomePage";
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

/** One tab per stage of the period; the professionals with nothing to settle hang from the footer. */
const TABS = ["UNSETTLED", "DRAFT", "APPROVED", "PAID"] as const;
type Tab = (typeof TABS)[number];
/** What the tab's main button does (nothing on «Pagadas»). */
const TAB_ACTION = { UNSETTLED: "GENERATE", DRAFT: "APPROVE", APPROVED: "PAY" } as const;
const TAB_STEP = { UNSETTLED: 1, DRAFT: 2, APPROVED: 3 } as const;

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
  /** The tab the user picked; null = the stage that is next to do (see `defaultTab`). */
  const [tab, setTab] = useState<Tab | null>(() => {
    const s = params.get("state");
    return TABS.includes(s as Tab) ? (s as Tab) : null;
  });
  // The link «Tu equipo» in Inicio opens this list straight away (?state=NONE).
  const [showNone, setShowNone] = useState(() => params.get("state") === "NONE");
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  /** After an action, a tab that ran out of rows gives way to the stage that is next to do. */
  const bounce = useRef(false);
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

  useEffect(() => {
    if (!bounce.current || !data) return;
    bounce.current = false;
    if (tab && tab !== "PAID" && !data.rows.some((r) => r.status === tab)) setTab(null);
  }, [data, tab]);

  // Every active professional is listed (also the ones with nothing to settle: «Sin movimientos»).
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byStatus = (s: OverviewStatus) => rows.filter((r) => r.status === s);
  const count = (s: OverviewStatus) => byStatus(s).length;
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
      bounce.current = true;
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
      return t("femme.commissions.liquidar.note.none");
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
    const voidMenu =
      r.status === "DRAFT" && r.settlementId ? (
        <MoreActionsMenu
          compact
          label={t("femme.commissions.liquidar.moreAria", { name: r.professionalName })}
          open={menuFor === r.professionalId}
          onOpenChange={(o) => setMenuFor(o ? r.professionalId : null)}
          triggerTestId="liquidar-row-more"
          items={[
            {
              id: "void",
              label: t("femme.commissions.liquidar.action.VOID"),
              destructive: true,
              testId: "liquidar-row-void",
              onSelect: () => {
                setMenuFor(null);
                openVoid([r]);
              },
            },
          ]}
        />
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
        {voidMenu}
      </>
    );
  }

  if (!data) return error ? <Alert variant="destructive">{error}</Alert> : <Spinner />;

  const currentStep = data.unsettled > 0 ? 1 : data.drafts > 0 ? 2 : data.approved > 0 ? 3 : 0;
  /** The stage that is next to do; with nothing pending, what is already paid. */
  const defaultTab: Tab = data.unsettled > 0 ? "UNSETTLED" : data.drafts > 0 ? "DRAFT" : data.approved > 0 ? "APPROVED" : data.paid > 0 ? "PAID" : "UNSETTLED";
  const activeTab = tab ?? defaultTab;
  const visible = byStatus(activeTab);
  const mainKind = activeTab === "PAID" ? null : TAB_ACTION[activeTab];
  const mainRows = mainKind ? targets(activeTab) : [];
  const noneRows = byStatus("NONE");
  function pickTab(next: Tab) {
    setTab(next);
  }
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
          <button
            type="button"
            aria-label={t("femme.commissions.liquidar.periodInfoAria")}
            aria-expanded={infoOpen}
            title={t("femme.commissions.liquidar.periodicityNote")}
            data-testid="liquidar-period-info"
            onClick={() => setInfoOpen((v) => !v)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-base font-extrabold text-ink-3 hover:bg-bg"
          >
            <span aria-hidden>ⓘ</span>
          </button>
        </div>
        <span className="text-sm text-ink-3">
          {t("femme.commissions.liquidar.total")}: <b className="text-ink" data-testid="liquidar-total">{formatGuaraniesGs(data.total)}</b>
          {" · "}
          {t("femme.commissions.liquidar.alreadyPaid")} <b className="text-ink" data-testid="liquidar-paid-total">{formatGuaraniesGs(amountOf("PAID"))}</b>
        </span>
      </div>

      {infoOpen && (
        <p className="-mt-2 text-[13px] text-ink-3" role="status" data-testid="liquidar-period-note">
          {t("femme.commissions.liquidar.periodicityNote")}
        </p>
      )}

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

      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-sm" data-testid="liquidar-table">
        <div role="tablist" aria-label={t("femme.commissions.liquidar.tabsAria")} className="flex overflow-x-auto border-b border-line bg-bg/60" data-testid="liquidar-tabs">
          {TABS.map((st) => {
            const on = activeTab === st;
            const isNext = currentStep > 0 && TAB_STEP[st as Exclude<Tab, "PAID">] === currentStep;
            return (
              <button
                key={st}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`liquidar-tab-${st}`}
                onClick={() => pickTab(st)}
                className={`inline-flex min-h-[52px] min-w-[8.5rem] flex-1 items-center justify-center gap-2 border-b-[3px] px-3 text-[15px] font-extrabold ${
                  on ? "border-primary bg-surface text-primary-dk" : "border-transparent text-ink-2 hover:bg-surface"
                }`}
              >
                <span>{t(`femme.commissions.liquidar.tab.${st}`)}</span>
                <span
                  data-testid={`liquidar-tab-${st}-count`}
                  className={`inline-flex size-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-extrabold ${isNext ? "bg-primary text-surface" : "bg-bg text-ink-2"}`}
                >
                  {count(st)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <span className="text-[15px] text-ink" data-testid="liquidar-summary">
            <b>{t("femme.commissions.liquidar.summary", { count: visible.length })}</b>
            {" · "}
            {formatGuaraniesGs(amountOf(activeTab))}
          </span>
          {mainKind && (
            <Button
              type="button"
              className={`${ACTION_BUTTON} !min-h-12 px-7 text-[15px]`}
              disabled={mainRows.length === 0}
              data-testid="liquidar-main-action"
              onClick={() => open(mainKind, mainRows)}
            >
              {t(`femme.commissions.liquidar.step${TAB_STEP[activeTab as Exclude<Tab, "PAID">]}.button`, { count: mainRows.length })}
            </Button>
          )}
        </div>

        {selectedRows.length > 0 && (
          <div role="region" aria-label={t("femme.commissions.liquidar.selectionAria")} data-testid="liquidar-selection" className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-ink px-4 py-2.5 text-surface sm:mx-5">
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

        <div className="w-full overflow-x-auto px-4 sm:px-5">
          <div className="min-w-[44rem]">
            <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_8rem_7rem_11rem] items-center gap-2 border-t border-line py-2 text-[11px] font-extrabold uppercase tracking-wide text-ink-3">
              {activeTab !== "PAID" && visible.length > 0 ? (
                <input
                  type="checkbox"
                  className="size-[18px] accent-[var(--color-primary)]"
                  aria-label={t("femme.commissions.liquidar.pickGroup", { group: t(`femme.commissions.liquidar.tab.${activeTab}`) })}
                  checked={visible.every((r) => selected.has(r.professionalId))}
                  data-testid={`liquidar-group-check-${activeTab}`}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      const all = visible.every((r) => next.has(r.professionalId));
                      visible.forEach((r) => (all ? next.delete(r.professionalId) : next.add(r.professionalId)));
                      return next;
                    })
                  }
                />
              ) : (
                <span />
              )}
              <span>{t("femme.commissions.liquidar.colProfessional")}</span>
              <span className="text-right">{t("femme.commissions.liquidar.colAmount")}</span>
              <span className="text-right">{t("femme.commissions.liquidar.colRetained")}</span>
              <span />
            </div>
            {visible.length === 0 ? (
              <p className="border-t border-line py-7 text-center text-[15px] text-ink-2" data-testid="liquidar-empty">
                {t(`femme.commissions.liquidar.tabEmpty.${activeTab}`)}
              </p>
            ) : (
              <ul>
                {visible.map((r) => (
                  <li
                    key={r.professionalId}
                    data-testid="liquidar-row"
                    data-professional={r.professionalName}
                    data-status={r.status}
                    className="grid min-h-[60px] grid-cols-[1.5rem_minmax(0,1fr)_8rem_7rem_11rem] items-center gap-2 border-t border-line py-1.5"
                  >
                    {activeTab === "PAID" ? (
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
                          {r.settlementId && r.status !== "PAID" ? (
                            <Link to={`/app/commissions/settlements/${r.settlementId}`} className="font-bold text-primary" data-testid="liquidar-row-detail">
                              {rowNote(r)}
                            </Link>
                          ) : (
                            rowNote(r)
                          )}
                        </span>
                      </span>
                    </span>
                    <b className="text-right tabular-nums" data-testid="liquidar-row-amount">
                      {formatGuaraniesGs(r.amount)}
                    </b>
                    <span className="text-right text-sm font-bold tabular-nums text-warning" data-testid="liquidar-row-retention">
                      {data.aguinaldoEnabled && r.retention > 0 ? formatGuaraniesGs(r.retention) : "—"}
                    </span>
                    <span className="flex items-center justify-end gap-1.5">{rowAction(r)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-bg/60 px-4 py-1 sm:px-5">
          {noneRows.length > 0 ? (
            <button
              type="button"
              aria-expanded={showNone}
              data-testid="liquidar-none-toggle"
              onClick={() => setShowNone((v) => !v)}
              className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-extrabold text-primary-dk underline underline-offset-4"
            >
              {t("femme.commissions.liquidar.noneToggle", { count: noneRows.length })}
              <span aria-hidden>{showNone ? "⌃" : "⌄"}</span>
            </button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="secondary"
            className={ACTION_BUTTON}
            data-testid="liquidar-csv"
            onClick={() =>
              void downloadCommissionFile(settlementsCsvPath({}, i18n.language), "liquidaciones.csv").catch((err) => setError(translateApiError(err, t)))
            }
          >
            {t("femme.commissions.liquidar.csv")}
          </Button>
        </div>
        {showNone && noneRows.length > 0 && (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-2 sm:px-5" data-testid="liquidar-none-list">
            {noneRows.map((r, i) => (
              <span key={r.professionalId} data-testid="liquidar-none-item">
                {i > 0 && " · "}
                <Link to={`/app/commissions/equipo/${r.professionalId}`} className="font-bold text-ink">
                  {r.professionalName}
                </Link>
              </span>
            ))}
          </p>
        )}
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
