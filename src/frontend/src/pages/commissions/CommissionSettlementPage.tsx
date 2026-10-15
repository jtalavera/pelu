import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Card, Input, Label, Modal, Select, Spinner, Text, Textarea } from "@design-system";
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
import { SettlementStatusBadge, TableWrap, formatPercent, tdClass, thClass, todayYmd } from "./common";

/** HU-COM-06: settlement detail, adjustments (Draft), approve, pay, void, PDF. */
export default function CommissionSettlementPage() {
  const { t } = useTranslation();
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

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="commission-settlement-detail">
      <Link to="/app/commissions" className="text-sm underline">
        ← {t("femme.commissions.pageTitle")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-medium">
          {t("femme.commissions.settlement.title", { id: s.id, name: s.professionalName })}
        </h2>
        <SettlementStatusBadge status={s.status} />
      </div>
      <Text>
        {t("femme.commissions.settlements.period")}: {formatParaguayDate(s.periodFrom + "T12:00:00", dateLocale)} –{" "}
        {formatParaguayDate(s.periodTo + "T12:00:00", dateLocale)}
      </Text>
      <Text className="text-lg font-semibold" data-testid="settlement-total">
        {t("femme.commissions.common.total")}: {formatGuaraniesGs(s.totalAmount)}
      </Text>
      {s.paidAt && (
        <Text variant="small">
          {t("femme.commissions.settlement.paidInfo", {
            date: formatParaguayDateTime(s.paidAt, dateLocale),
            method: t(`femme.commissions.paymentMethod.${s.paymentMethod}`),
            reference: s.paymentReference ?? "—",
          })}
        </Text>
      )}
      {s.voidReason && <Alert variant="warning">{t("femme.commissions.settlement.voidedInfo", { reason: s.voidReason })}</Alert>}
      {detail.mixedBases && (
        <Alert variant="warning" data-testid="settlement-mixed-bases">
          {t("femme.commissions.settlement.mixedBases")}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        {isDraft && (
          <Button type="button" onClick={() => setConfirmApprove(true)} data-testid="settlement-approve">
            {t("femme.commissions.settlement.approve")}
          </Button>
        )}
        {s.status === "APPROVED" && (
          <Button type="button" onClick={() => setPayOpen(true)} data-testid="settlement-pay">
            {t("femme.commissions.settlement.markPaid")}
          </Button>
        )}
        {(isDraft || s.status === "APPROVED") && (
          <Button type="button" variant="danger" onClick={() => setVoidOpen(true)} data-testid="settlement-void">
            {t("femme.commissions.settlement.void")}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void downloadCommissionFile(settlementPdfPath(s.id), `liquidacion-${s.id}.pdf`).catch((err) =>
              setError(translateApiError(err, t)),
            )
          }
          data-testid="settlement-pdf"
        >
          {t("femme.commissions.settlement.pdf")}
        </Button>
      </div>

      <Card className="flex flex-col gap-2 p-4">
        <h3 className="text-base font-medium">{t("femme.commissions.settlement.lines")}</h3>
        <TableWrap testId="settlement-lines">
          <thead>
            <tr>
              <th className={thClass}>{t("femme.commissions.history.date")}</th>
              <th className={thClass}>{t("femme.commissions.reports.invoice")}</th>
              <th className={thClass}>{t("femme.commissions.common.item")}</th>
              <th className={thClass}>{t("femme.commissions.common.itemKind")}</th>
              <th className={thClass}>{t("femme.commissions.settlement.base")}</th>
              <th className={`${thClass} text-right`}>{t("femme.commissions.settlement.baseAmount")}</th>
              <th className={`${thClass} text-right`}>%</th>
              <th className={`${thClass} text-right`}>{t("femme.commissions.settlement.commission")}</th>
              {isDraft && <th className={thClass} />}
            </tr>
          </thead>
          <tbody>
            {detail.entries.map((e) => (
              <tr key={e.id} className="border-t" data-testid="settlement-line">
                <td className={tdClass}>{formatParaguayDateTime(e.accrualAt, dateLocale)}</td>
                <td className={tdClass}>{e.invoiceNumber}</td>
                <td className={tdClass}>
                  {e.itemName}
                  {entryLabel(e) && <span className="block text-xs text-[var(--color-ink-3)]">{entryLabel(e)}</span>}
                </td>
                <td className={tdClass}>{e.itemKind ? t(`femme.commissions.kind.${e.itemKind}`) : ""}</td>
                <td className={tdClass}>{e.baseType ? t(`femme.commissions.base.${e.baseType}`) : ""}</td>
                <td className={`${tdClass} text-right`}>{formatGuaraniesGs(e.baseAmount)}</td>
                <td className={`${tdClass} text-right`}>{formatPercent(e.percentApplied)}</td>
                <td className={`${tdClass} text-right`}>{formatGuaraniesGs(e.commissionAmount)}</td>
                {isDraft && (
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {e.reassignable && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => setToReassign(e)}>
                        {t("femme.commissions.reassign.action")}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="grid gap-2 sm:grid-cols-2">
          <div data-testid="settlement-subtotals-kind">
            <h4 className="text-sm font-medium">{t("femme.commissions.settlement.byKind")}</h4>
            {detail.byKind.map((st) => (
              <Text key={st.key} variant="small">
                {t(`femme.commissions.kind.${st.key}`)}: {formatGuaraniesGs(st.amount)}
              </Text>
            ))}
          </div>
          <div data-testid="settlement-subtotals-item">
            <h4 className="text-sm font-medium">{t("femme.commissions.settlement.byItem")}</h4>
            {detail.byItem.map((st) => (
              <Text key={st.key} variant="small">
                {st.label}: {formatGuaraniesGs(st.amount)}
              </Text>
            ))}
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h3 className="text-base font-medium">{t("femme.commissions.settlement.adjustments")}</h3>
        {detail.adjustments.length === 0 ? (
          <Text variant="muted">{t("femme.commissions.settlement.noAdjustments")}</Text>
        ) : (
          <ul className="text-sm" data-testid="settlement-adjustments">
            {detail.adjustments.map((a) => (
              <li key={a.id}>
                {a.note ?? t(`femme.commissions.reason.${a.reasonCode}`)}: {formatGuaraniesGs(a.commissionAmount)}
              </li>
            ))}
          </ul>
        )}
        {isDraft && (
          <form onSubmit={(e) => void submitAdjustment(e)} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="adj-sign">{t("femme.commissions.settlement.adjustmentType")}</Label>
              <Select id="adj-sign" value={adjSign} onChange={(e) => setAdjSign(e.target.value as "+" | "-")}>
                <option value="+">{t("femme.commissions.settlement.bonus")}</option>
                <option value="-">{t("femme.commissions.settlement.deduction")}</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="adj-amount">{t("femme.commissions.settlement.amount")}</Label>
              <Input id="adj-amount" inputMode="numeric" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} className="max-w-[10rem]" />
            </div>
            <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
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
            <Button type="submit" data-testid="settlement-add-adjustment">
              {t("femme.commissions.settlement.addAdjustment")}
            </Button>
            <div className="w-full">
              <FieldValidationError id="adj-error">{adjError}</FieldValidationError>
            </div>
          </form>
        )}
      </Card>

      <Card className="flex flex-col gap-1 p-4">
        <h3 className="text-base font-medium">{t("femme.commissions.settlement.historyTitle")}</h3>
        <ul className="text-sm" data-testid="settlement-history">
          {detail.history.map((h, i) => (
            <li key={i}>
              {formatParaguayDateTime(h.changedAt, dateLocale)} · {h.fromStatus ? t(`femme.commissions.settlementStatus.${h.fromStatus}`) + " → " : ""}
              {t(`femme.commissions.settlementStatus.${h.toStatus}`)} · {h.changedByEmail}
            </li>
          ))}
        </ul>
      </Card>

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
