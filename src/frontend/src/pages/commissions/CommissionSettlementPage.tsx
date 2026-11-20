import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Input, KebabMenu, Label, Modal, Select, Spinner, Textarea } from "@design-system";
import {
  addAdjustment,
  approveSettlement,
  downloadCommissionFile,
  getSettlement,
  paySettlement,
  settlementPdfPath,
  voidSettlement,
  type EntryView,
  type SettlementDetail,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FieldValidationError } from "../../components/FieldValidationError";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { PARAGUAY_TIMEZONE, formatParaguayDate, formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ActionIcon } from "../../components/actionIcons";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { MoreActionsMenu } from "../../components/MoreActionsMenu";
import { MovementChangeSteps } from "./MovementChangeSteps";
import { ReassignDialog } from "./ReassignDialog";
import { SettlementStatusBadge, formatPercent, todayYmd } from "./common";
import { changeNote, changeTag, type MovementGroup } from "./movementGroups";
import { buildSettlementDays, compose, type Composition as CompositionData, type SettlementDay } from "./settlementDays";

/**
 * HU-COM-06: settlement detail, adjustments (Draft), approve, pay, void, PDF.
 * HU-COM-32: the detail is told day by day; a sale whose commission changed is ONE row with its history.
 */
export default function CommissionSettlementPage() {
  const { t, i18n } = useTranslation();
  const dateLocale = useDateLocale();
  const { id } = useParams();
  const settlementId = Number(id);
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjAmount, setAdjAmount] = useState("");
  const [adjSign, setAdjSign] = useState<"+" | "-">("+");
  const [adjReason, setAdjReason] = useState("");
  const [adjError, setAdjError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState("CASH");
  const [payDate, setPayDate] = useState(todayYmd());
  const [payRef, setPayRef] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [toReassign, setToReassign] = useState<EntryView | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  /** Sales whose «Ver cambios» is open. */
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getSettlement(settlementId));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [settlementId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<SettlementDetail>) {
    try {
      setDetail(await action());
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    const digits = adjAmount.replace(/\D+/g, "");
    if (!adjReason.trim()) {
      setAdjError(t("femme.apiErrors.SETTLEMENT_ADJUSTMENT_REASON_REQUIRED"));
      return;
    }
    if (!digits || Number(digits) === 0) {
      setAdjError(t("femme.commissions.settlement.adjustmentAmountInvalid"));
      return;
    }
    setAdjError(null);
    const amount = Number(digits) * (adjSign === "-" ? -1 : 1);
    setAdjOpen(false);
    await run(() => addAdjustment(settlementId, amount, adjReason.trim()));
    setAdjAmount("");
    setAdjReason("");
  }

  if (error && !detail) return <Alert variant="destructive">{error}</Alert>;
  if (!detail) return <Spinner />;
  const s = detail.settlement;
  const isDraft = s.status === "DRAFT";

  const days = buildSettlementDays(detail.entries, detail.adjustments);
  const comp = compose(days);
  const dayPart = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(dateLocale, { timeZone: PARAGUAY_TIMEZONE, ...opts }).format(new Date(iso));

  const chip = "inline-flex rounded-full px-2 py-0.5 text-xs font-extrabold";
  const rowGrid =
    "grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_3.5rem_7.5rem_2.75rem] sm:gap-x-3 sm:px-4";

  function renderSale(g: MovementGroup) {
    // The commission in force; a sale that ended up with none shows its last one.
    const e = g.current ?? g.rep;
    const hasCalc = g.current !== null || !g.changed;
    const open = g.changed && openKeys.has(g.key);
    const note = changeNote(t, g);
    const baseShort = e.baseType ? t(`femme.commissions.baseShort.${e.baseType}`) : "";
    const sub = [e.invoiceNumber ? t("femme.commissions.settlement.invoiceRef", { number: e.invoiceNumber }) : null, note || null]
      .filter(Boolean)
      .join(" · ");
    return (
      <li key={g.key} data-testid="settlement-line" data-changed={g.changed} className="border-t border-line first:border-t-0">
        <div className={rowGrid}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-words font-semibold text-ink">{e.itemName}</span>
              {g.rep.itemKind === "PRODUCT" && (
                <span className={`${chip} bg-primary-lt text-primary-dk`} data-testid="settlement-line-product">
                  {t("femme.commissions.settlement.productTag")}
                </span>
              )}
              {g.changed && (
                <span
                  className={`${chip} ${g.reason === "VOID" ? "bg-page text-ink-2" : "bg-warning-lt text-warning"}`}
                  data-testid="settlement-line-tag"
                >
                  {changeTag(t, g)}
                </span>
              )}
            </div>
            {sub && <div className="text-sm text-ink-3">{sub}</div>}
            {hasCalc && (e.fixedAmount !== 0 || e.retentionAmount !== 0) && (
              <div className="text-sm text-ink-3" data-testid="settlement-line-extra">
                {e.fixedAmount !== 0 &&
                  t("femme.commissions.settlement.lineProductCost", { amount: formatGuaraniesGs(e.fixedAmount) })}
                {e.fixedAmount !== 0 && e.retentionAmount !== 0 ? " · " : ""}
                {e.retentionAmount !== 0 &&
                  t("femme.commissions.settlement.lineRetention", {
                    percent: formatPercent(e.retentionPercent),
                    amount: formatGuaraniesGs(e.retentionAmount),
                  })}
              </div>
            )}
            {g.changed && (
              <button
                type="button"
                aria-expanded={open}
                data-testid="settlement-line-changes-toggle"
                onClick={() =>
                  setOpenKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.key)) next.delete(g.key);
                    else next.add(g.key);
                    return next;
                  })
                }
                className="inline-flex min-h-11 items-center gap-1 text-[13px] font-extrabold text-primary-dk underline underline-offset-4"
              >
                {open
                  ? t("femme.commissions.movements.group.hide")
                  : t("femme.commissions.movements.group.show", { count: g.entries.length })}
                <span aria-hidden>{open ? "⌃" : "⌄"}</span>
              </button>
            )}
          </div>
          <div className="hidden flex-col items-end text-sm tabular-nums text-ink-2 sm:flex" data-testid="settlement-line-base">
            {hasCalc ? (
              <>
                <span>{formatGuaraniesGs(e.baseAmount)}</span>
                <span className="text-xs text-ink-3">{baseShort}</span>
              </>
            ) : (
              "—"
            )}
          </div>
          <span className="hidden text-right text-sm tabular-nums text-ink-2 sm:block">{hasCalc ? formatPercent(e.percentApplied) : "—"}</span>
          <span
            data-testid="settlement-line-amount"
            className={`text-right font-heading font-extrabold tabular-nums ${g.net < 0 ? "text-danger" : g.changed && g.net === 0 ? "text-ink-3" : "text-ink"}`}
          >
            {formatGuaraniesGs(g.net)}
          </span>
          {isDraft && g.current?.reassignable ? (
            <KebabMenu
              id={`settlement-line-${g.current.id}`}
              triggerAriaLabel={t("femme.commissions.settlement.lineActions")}
              items={[
                {
                  id: "reassign",
                  label: t("femme.commissions.reassign.action"),
                  onSelect: () => setToReassign(g.current),
                },
              ]}
            />
          ) : (
            <span className="w-11" aria-hidden />
          )}
          {hasCalc && (
            <div className="col-span-2 text-xs text-ink-3 sm:hidden">
              {formatGuaraniesGs(e.baseAmount)} × {formatPercent(e.percentApplied)}
              {baseShort ? ` · ${baseShort}` : ""}
            </div>
          )}
        </div>
        {open && <MovementChangeSteps group={g} testIdPrefix="settlement-sale" />}
      </li>
    );
  }

  function renderAdjustment(a: EntryView) {
    return (
      <li key={a.id} data-testid="settlement-adjustment" className="border-t border-line first:border-t-0">
        <div className={rowGrid}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-words font-semibold text-ink">{a.note ?? t(`femme.commissions.reason.${a.reasonCode}`)}</span>
            <span className={`${chip} bg-success-lt text-success`}>{t("femme.commissions.settlement.adjustmentTag")}</span>
          </div>
          <span
            data-testid="settlement-adjustment-amount"
            className={`col-start-2 text-right font-heading font-extrabold tabular-nums sm:col-start-4 ${a.commissionAmount < 0 ? "text-danger" : "text-success"}`}
          >
            {a.commissionAmount > 0 ? "+" : ""}
            {formatGuaraniesGs(a.commissionAmount)}
          </span>
        </div>
      </li>
    );
  }

  function renderDay(day: SettlementDay) {
    return (
      <section
        key={day.key}
        data-testid="settlement-day"
        data-day={day.key}
        className="grid grid-cols-1 pb-3 last:pb-0 sm:grid-cols-[3.25rem_0.875rem_minmax(0,1fr)] sm:gap-x-3"
      >
        <div className="hidden flex-col items-end pt-2.5 sm:flex" aria-hidden>
          <b className="font-heading text-2xl font-extrabold leading-none text-ink">{dayPart(day.iso, { day: "numeric" })}</b>
          <span className="text-xs font-bold uppercase tracking-wide text-ink-3">{dayPart(day.iso, { month: "short" }).replace(".", "")}</span>
        </div>
        <div className="hidden flex-col items-center sm:flex" aria-hidden>
          <span className="mt-4 size-3 rounded-full bg-primary" />
          <span className="mt-1 w-0.5 flex-1 bg-line" />
        </div>
        <div className="min-w-0">
          <h3 className="mb-1 text-sm font-extrabold text-primary sm:sr-only">{dayPart(day.iso, { day: "numeric", month: "long" })}</h3>
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
            <div className="flex items-baseline justify-between gap-3 border-b border-line bg-page px-4 py-2 text-sm text-ink-2">
              <span>{t("femme.commissions.settlement.dayTotal")}</span>
              <b className="font-heading text-ink tabular-nums" data-testid="settlement-day-total">
                {formatGuaraniesGs(day.total)}
              </b>
            </div>
            <ul>
              {day.sales.map(renderSale)}
              {day.adjustments.map(renderAdjustment)}
            </ul>
          </div>
        </div>
      </section>
    );
  }

  const sectionTitle = "mt-1 font-heading text-xs font-extrabold uppercase tracking-wider text-primary";
  const foldBtn =
    "flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4" data-testid="commission-settlement-detail">
      <Link to="/app/commissions/liquidar" className="inline-flex min-h-11 items-center text-sm font-bold text-primary" data-testid="settlement-back">
        ← {t("femme.commissions.pageTitle")}
      </Link>

      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words font-heading text-xl font-extrabold text-ink">{s.professionalName}</h1>
            <p className="text-sm text-ink-3">
              {t("femme.commissions.settlement.subtitle", {
                id: s.id,
                from: formatParaguayDate(s.periodFrom + "T12:00:00", dateLocale),
                to: formatParaguayDate(s.periodTo + "T12:00:00", dateLocale),
              })}
            </p>
          </div>
          <SettlementStatusBadge status={s.status} />
        </div>
        <div className="font-heading text-3xl font-extrabold tabular-nums text-ink" data-testid="settlement-total">
          {formatGuaraniesGs(s.totalAmount)}
        </div>
        <Composition comp={comp} />
        {(s.retentionAmount !== 0 || s.fixedAmount !== 0) && (
          <div className="flex flex-col gap-0.5 text-sm" data-testid="settlement-breakdown">
            {s.fixedAmount !== 0 && (
              <div className="flex justify-between gap-3 text-ink-2">
                <span>{t("femme.commissions.settlement.productCost")}</span>
                <b className="tabular-nums" data-testid="settlement-product-cost">
                  {formatGuaraniesGs(s.fixedAmount)}
                </b>
              </div>
            )}
            {s.retentionAmount !== 0 && (
              <>
                <div className="flex justify-between gap-3 text-warning">
                  <span>{t("femme.commissions.settlement.retained")}</span>
                  <b className="tabular-nums" data-testid="settlement-retained">
                    {formatGuaraniesGs(s.retentionAmount)}
                  </b>
                </div>
                <span className="text-xs text-ink-3">{t("femme.commissions.settlement.retainedNote")}</span>
              </>
            )}
          </div>
        )}
        {s.paidAt && (
          <p className="text-sm text-ink-3" data-testid="settlement-paid-info">
            {t("femme.commissions.settlement.paidInfo", {
              date: formatParaguayDateTime(s.paidAt, dateLocale),
              method: t(`femme.commissions.paymentMethod.${s.paymentMethod}`),
              reference: s.paymentReference ?? "—",
            })}
          </p>
        )}
        {s.voidReason && (
          <p className="text-sm text-ink-3">{t("femme.commissions.settlement.voidedInfo", { reason: s.voidReason })}</p>
        )}
        {detail.mixedBases && (
          <Alert variant="warning" data-testid="settlement-mixed-bases">
            {t("femme.commissions.settlement.mixedBases")}
          </Alert>
        )}
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {isDraft && (
            <Button type="button" className={ACTION_BUTTON} onClick={() => setConfirmApprove(true)} data-testid="settlement-approve">
              {t("femme.commissions.settlement.approve")}
            </Button>
          )}
          {s.status === "APPROVED" && (
            <Button type="button" className={ACTION_BUTTON} onClick={() => setPayOpen(true)} data-testid="settlement-pay">
              {t("femme.commissions.settlement.markPaid")}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            className={ACTION_BUTTON}
            onClick={() =>
              void downloadCommissionFile(settlementPdfPath(s.id, i18n.language), `liquidacion-${s.id}.pdf`).catch((err) =>
                setError(translateApiError(err, t)),
              )
            }
            data-testid="settlement-pdf"
          >
            {t("femme.commissions.settlement.pdf")}
          </Button>
          {isDraft && (
            <Button
              type="button"
              variant="secondary"
              className={ACTION_BUTTON}
              onClick={() => setAdjOpen(true)}
              data-testid="settlement-adjustment-open"
            >
              + {t("femme.commissions.settlement.addAdjustment")}
            </Button>
          )}
          {(isDraft || s.status === "APPROVED") && (
            <MoreActionsMenu
              label={t("femme.commissions.settlement.moreActions")}
              open={moreOpen}
              onOpenChange={setMoreOpen}
              triggerTestId="settlement-more-trigger"
              items={[
                {
                  id: "void",
                  testId: "settlement-more-item-void",
                  icon: <ActionIcon name="ban" />,
                  label: t("femme.commissions.settlement.void"),
                  destructive: true,
                  onSelect: () => setVoidOpen(true),
                },
              ]}
            />
          )}
        </div>
      </section>

      <h2 className={sectionTitle}>{t("femme.commissions.settlement.timeline")}</h2>
      {days.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink-3" data-testid="settlement-no-days">
          {t("femme.commissions.settlement.noDays")}
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="settlement-lines">
          {days.map((day) => renderDay(day))}
        </div>
      )}

      <button
        type="button"
        aria-expanded={historyOpen}
        aria-controls="settlement-history"
        data-testid="settlement-history-toggle"
        className={foldBtn}
        onClick={() => setHistoryOpen((o) => !o)}
      >
        {t("femme.commissions.settlement.historyTitle")}
        <span aria-hidden className={`text-ink-3 transition-transform ${historyOpen ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {historyOpen && (
        <ul id="settlement-history" className="rounded-card border border-line bg-surface p-4 text-sm" data-testid="settlement-history">
          {detail.history.map((h, i) => (
            <li key={i} className="py-1">
              {formatParaguayDateTime(h.changedAt, dateLocale)} ·{" "}
              {h.fromStatus ? t(`femme.commissions.settlementStatus.${h.fromStatus}`) + " → " : ""}
              {t(`femme.commissions.settlementStatus.${h.toStatus}`)} · {h.changedByEmail}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={adjOpen}
        onClose={() => setAdjOpen(false)}
        title={t("femme.commissions.settlement.addAdjustment")}
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={() => setAdjOpen(false)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="submit"
              form="settlement-adjustment-form"
              className="min-h-11 w-full sm:w-auto"
              data-testid="settlement-add-adjustment"
            >
              {t("femme.commissions.settlement.addAdjustment")}
            </Button>
          </>
        }
      >
        <form id="settlement-adjustment-form" onSubmit={(e) => void submitAdjustment(e)} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="adj-sign">{t("femme.commissions.settlement.adjustmentType")}</Label>
              <Select id="adj-sign" value={adjSign} onChange={(e) => setAdjSign(e.target.value as "+" | "-")}>
                <option value="+">{t("femme.commissions.settlement.bonus")}</option>
                <option value="-">{t("femme.commissions.settlement.deduction")}</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="adj-amount">{t("femme.commissions.settlement.amount")}</Label>
              <Input id="adj-amount" inputMode="numeric" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="adj-reason" required>
              {t("femme.commissions.settlement.reason")}
            </Label>
            <Input
              id="adj-reason"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              invalid={!!adjError}
              aria-describedby={adjError ? "adj-error" : undefined}
            />
          </div>
          <FieldValidationError id="adj-error">{adjError}</FieldValidationError>
        </form>
      </Modal>

      <ReassignDialog
        entry={toReassign}
        onClose={() => setToReassign(null)}
        onDone={() => {
          setToReassign(null);
          void load();
        }}
      />

      <ConfirmDialog
        open={confirmApprove}
        title={t("femme.commissions.settlement.approveTitle")}
        description={t("femme.commissions.settlement.approveDescription")}
        cancelLabel={t("femme.commissions.common.cancel")}
        confirmLabel={t("femme.commissions.settlement.approve")}
        confirmVariant="primary"
        onCancel={() => setConfirmApprove(false)}
        onConfirm={() => {
          setConfirmApprove(false);
          void run(() => approveSettlement(settlementId));
        }}
      />

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={t("femme.commissions.settlement.markPaid")}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPayOpen(false)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              data-testid="settlement-pay-confirm"
              onClick={() => {
                setPayOpen(false);
                void run(() => paySettlement(settlementId, payMethod, payDate || null, payRef));
              }}
            >
              {t("femme.commissions.settlement.markPaid")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="pay-method">{t("femme.commissions.settlement.paymentMethod")}</Label>
            <Select id="pay-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {["CASH", "TRANSFER", "OTHER"].map((m) => (
                <option key={m} value={m}>
                  {t(`femme.commissions.paymentMethod.${m}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pay-date">{t("femme.commissions.settlement.paidOn")}</Label>
            <LocalizedDateInput id="pay-date" value={payDate} onChange={setPayDate} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pay-ref">{t("femme.commissions.settlement.reference")}</Label>
            <Input id="pay-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={t("femme.commissions.settlement.void")}
        description={t(isDraft ? "femme.commissions.settlement.voidDescriptionDraft" : "femme.commissions.settlement.voidDescription")}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setVoidOpen(false)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              data-testid="settlement-void-confirm"
              onClick={() => {
                // HU-COM-19: the reason is optional for a draft, required once it was approved.
                if (!isDraft && !voidReason.trim()) {
                  setVoidError(t("femme.apiErrors.SETTLEMENT_VOID_REASON_REQUIRED"));
                  return;
                }
                setVoidOpen(false);
                void run(() => voidSettlement(settlementId, voidReason.trim()));
              }}
            >
              {t("femme.commissions.settlement.void")}
            </Button>
          </>
        }
      >
        <Label htmlFor="void-reason" required={!isDraft}>
          {t("femme.commissions.settlement.reason")}
        </Label>
        <Textarea
          id="void-reason"
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          aria-describedby={voidError ? "void-error" : undefined}
        />
        <FieldValidationError id="void-error">{voidError}</FieldValidationError>
      </Modal>
    </div>
  );
}

/** Services + products + adjustments = total: one bar and its legend, so it is clear where the total comes from. */
function Composition({ comp }: { comp: CompositionData }) {
  const { t } = useTranslation();
  const parts = [
    { id: "services", label: t("femme.commissions.settlement.compServices"), count: t("femme.commissions.settlement.compCount", { count: comp.services.count }), amount: comp.services.amount, color: "bg-primary", n: comp.services.count },
    { id: "products", label: t("femme.commissions.settlement.compProducts"), count: t("femme.commissions.settlement.compCount", { count: comp.products.count }), amount: comp.products.amount, color: "bg-secondary", n: comp.products.count },
    { id: "adjustments", label: t("femme.commissions.settlement.compAdjustments"), count: t("femme.commissions.settlement.adjCount", { count: comp.adjustments.count }), amount: comp.adjustments.amount, color: comp.adjustments.amount < 0 ? "bg-danger" : "bg-success", n: comp.adjustments.count },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 pt-1" data-testid="settlement-composition">
      <div role="img" aria-label={t("femme.commissions.settlement.composition")} className="flex h-4 gap-0.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <span key={p.id} className={`${p.color} min-w-2`} style={{ flexGrow: Math.max(Math.abs(p.amount), 1), flexBasis: 0 }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink">
        {parts.map((p) => (
          <li key={p.id} data-testid={`settlement-comp-${p.id}`} className="inline-flex items-center gap-2">
            <span aria-hidden className={`size-3 rounded-[3px] ${p.color}`} />
            <b>{p.label}</b>
            <span className="text-ink-3">· {p.count}</span>
            <span className="tabular-nums">
              {p.id === "adjustments" && p.amount > 0 ? "+" : ""}
              {formatGuaraniesGs(p.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
