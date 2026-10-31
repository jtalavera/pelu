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
import { formatParaguayDate, formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ReassignDialog } from "./ReassignDialog";
import { SettlementStatusBadge, formatPercent, todayYmd } from "./common";

/** HU-COM-06: settlement detail, adjustments (Draft), approve, pay, void, PDF. */
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
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [toReassign, setToReassign] = useState<EntryView | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const [subtotalsOpen, setSubtotalsOpen] = useState(false);
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

  function entryLabel(e: EntryView): string {
    if (e.sourceType === "REVERSAL") return t(`femme.commissions.reason.${e.reasonCode ?? "VOID"}`);
    return "";
  }

  const sectionTitle = "mt-1 font-heading text-xs font-extrabold uppercase tracking-wider text-primary";
  const foldBtn =
    "flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4" data-testid="commission-settlement-detail">
      <Link to="/app/commissions" className="inline-flex min-h-11 items-center text-sm font-bold text-primary">
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
            <Button type="button" className="min-h-11" onClick={() => setConfirmApprove(true)} data-testid="settlement-approve">
              {t("femme.commissions.settlement.approve")}
            </Button>
          )}
          {s.status === "APPROVED" && (
            <Button type="button" className="min-h-11" onClick={() => setPayOpen(true)} data-testid="settlement-pay">
              {t("femme.commissions.settlement.markPaid")}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() =>
              void downloadCommissionFile(settlementPdfPath(s.id, i18n.language), `liquidacion-${s.id}.pdf`).catch((err) =>
                setError(translateApiError(err, t)),
              )
            }
            data-testid="settlement-pdf"
          >
            {t("femme.commissions.settlement.pdf")}
          </Button>
          {(isDraft || s.status === "APPROVED") && (
            <KebabMenu
              id="settlement-more"
              triggerAriaLabel={t("femme.commissions.settlement.moreActions")}
              items={[
                {
                  id: "void",
                  label: t("femme.commissions.settlement.void"),
                  destructive: true,
                  onSelect: () => setVoidOpen(true),
                },
              ]}
            />
          )}
        </div>
      </section>

      <h2 className={sectionTitle}>{t("femme.commissions.settlement.lines")}</h2>
      <ul className="rounded-card border border-line bg-surface shadow-sm" data-testid="settlement-lines">
        {detail.entries.map((e) => (
          <li
            key={e.id}
            data-testid="settlement-line"
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2.5 first:border-t-0"
          >
            <div className="min-w-0">
              <div className="truncate font-semibold text-ink">{e.itemName}</div>
              <div className="text-sm text-ink-3">
                {formatParaguayDate(e.accrualAt, dateLocale)} · {e.invoiceNumber} ·{" "}
                {formatGuaraniesGs(e.baseAmount)} × {formatPercent(e.percentApplied)}
                {e.baseType ? ` · ${t(`femme.commissions.baseShort.${e.baseType}`)}` : ""}
                {entryLabel(e) ? ` · ${entryLabel(e)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-right font-heading font-extrabold tabular-nums text-ink">
                {formatGuaraniesGs(e.commissionAmount)}
              </span>
              {isDraft && e.reassignable && (
                <KebabMenu
                  id={`settlement-line-${e.id}`}
                  triggerAriaLabel={t("femme.commissions.settlement.lineActions")}
                  items={[
                    {
                      id: "reassign",
                      label: t("femme.commissions.reassign.action"),
                      onSelect: () => setToReassign(e),
                    },
                  ]}
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      <h2 className={sectionTitle}>{t("femme.commissions.settlement.adjustments")}</h2>
      <div className="rounded-card border border-line bg-surface shadow-sm">
        {detail.adjustments.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-3">{t("femme.commissions.settlement.noAdjustments")}</p>
        ) : (
          <ul data-testid="settlement-adjustments">
            {detail.adjustments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 first:border-t-0"
              >
                <span className="min-w-0 break-words text-ink">
                  {a.note ?? t(`femme.commissions.reason.${a.reasonCode}`)}
                </span>
                <span
                  className={`font-heading font-extrabold tabular-nums ${a.commissionAmount < 0 ? "text-danger" : "text-success"}`}
                >
                  {a.commissionAmount > 0 ? "+" : ""}
                  {formatGuaraniesGs(a.commissionAmount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {isDraft && (
        <button
          type="button"
          className="min-h-11 self-start px-1 text-sm font-bold text-primary underline underline-offset-4"
          onClick={() => setAdjOpen(true)}
          data-testid="settlement-adjustment-open"
        >
          + {t("femme.commissions.settlement.addAdjustment")}
        </button>
      )}

      <button
        type="button"
        aria-expanded={subtotalsOpen}
        aria-controls="settlement-subtotals"
        data-testid="settlement-subtotals-toggle"
        className={foldBtn}
        onClick={() => setSubtotalsOpen((o) => !o)}
      >
        {t("femme.commissions.settlement.subtotals")}
        <span aria-hidden className={`text-ink-3 transition-transform ${subtotalsOpen ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {subtotalsOpen && (
        <div id="settlement-subtotals" className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-2">
          <div data-testid="settlement-subtotals-kind">
            <h3 className="text-sm font-bold text-ink">{t("femme.commissions.settlement.byKind")}</h3>
            {detail.byKind.map((st) => (
              <div key={st.key} className="flex justify-between gap-2 py-1 text-sm">
                <span>{t(`femme.commissions.kind.${st.key}`)}</span>
                <b className="tabular-nums">{formatGuaraniesGs(st.amount)}</b>
              </div>
            ))}
          </div>
          <div data-testid="settlement-subtotals-item">
            <h3 className="text-sm font-bold text-ink">{t("femme.commissions.settlement.byItem")}</h3>
            {detail.byItem.map((st) => (
              <div key={st.key} className="flex justify-between gap-2 py-1 text-sm">
                <span className="min-w-0 break-words">{st.label}</span>
                <b className="tabular-nums">{formatGuaraniesGs(st.amount)}</b>
              </div>
            ))}
          </div>
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
        description={t("femme.commissions.settlement.voidDescription")}
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
                if (!voidReason.trim()) {
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
        <Label htmlFor="void-reason" required>
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
