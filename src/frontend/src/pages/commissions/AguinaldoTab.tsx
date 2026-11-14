import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Radio, RadioGroup, Select, Spinner, Text } from "@design-system";
import {
  adjustAguinaldo,
  getAguinaldo,
  getAguinaldoDetail,
  payAguinaldo,
  payAguinaldoToAll,
  type AguinaldoBalance,
  type AguinaldoDetail,
  type AguinaldoSummary,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate } from "../../lib/paraguayDateTime";
import { todayYmd } from "./common";
import { parseFixedInput } from "./ruleMath";

type PayDialog = {
  target: AguinaldoBalance;
  mode: "ALL" | "PARTIAL";
  amount: string;
  paidOn: string;
  method: string;
  note: string;
  closesFund: boolean;
  error: string | null;
};

/** "-2.350" / "5.000" → integer (negative allowed), or null. */
function parseSigned(raw: string): number | null {
  const s = raw.trim();
  const negative = s.startsWith("-");
  const n = parseFixedInput(negative ? s.slice(1) : s);
  return n === null || n === 0 ? null : negative ? -n : n;
}

/**
 * HU-COM-12 «Aguinaldo»: the fund of what was retained from each professional's commissions —
 * balances, movements, payments (partial, whole, on departure, to everyone) and manual adjustments.
 */
export function AguinaldoTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [summary, setSummary] = useState<AguinaldoSummary | null>(null);
  const [detail, setDetail] = useState<AguinaldoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pay, setPay] = useState<PayDialog | null>(null);
  const [payAll, setPayAll] = useState<{ paidOn: string; method: string; note: string; error: string | null } | null>(null);
  const [adjust, setAdjust] = useState<{ target: AguinaldoBalance; amount: string; reason: string; error: string | null } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      setSummary(await getAguinaldo());
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(professionalId: number) {
    try {
      setDetail(await getAguinaldoDetail(professionalId));
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }

  async function refresh(professionalId?: number) {
    await load();
    const id = professionalId ?? detail?.professionalId;
    if (id !== undefined) await openDetail(id);
  }

  async function submitPay() {
    if (!pay) return;
    const balance = pay.target.balance;
    let amount: number | null = null;
    if (pay.mode === "PARTIAL" && !pay.closesFund) {
      const n = parseFixedInput(pay.amount);
      if (n === null || n <= 0) return setPay({ ...pay, error: t("femme.commissions.aguinaldo.validation.amount") });
      if (n > balance) {
        return setPay({
          ...pay,
          error: t("femme.commissions.aguinaldo.validation.exceeds", { balance: formatGuaraniesGs(balance) }),
        });
      }
      amount = n;
    }
    try {
      await payAguinaldo({
        professionalId: pay.target.professionalId,
        amount,
        paidOn: pay.paidOn || null,
        paymentMethod: pay.method,
        closesFund: pay.closesFund,
        note: pay.note.trim() || null,
      });
      setPay(null);
      setNotice(t("femme.commissions.aguinaldo.paid"));
      await refresh(pay.target.professionalId);
    } catch (err) {
      setPay({ ...pay, error: translateApiError(err, t) });
    }
  }

  async function submitPayAll() {
    if (!payAll) return;
    try {
      const res = await payAguinaldoToAll({ paidOn: payAll.paidOn || null, paymentMethod: payAll.method, note: payAll.note.trim() || null });
      setPayAll(null);
      setNotice(t("femme.commissions.aguinaldo.payAllDone", { count: res.paid }));
      await refresh();
    } catch (err) {
      setPayAll({ ...payAll, error: translateApiError(err, t) });
    }
  }

  async function submitAdjust() {
    if (!adjust) return;
    const amount = parseSigned(adjust.amount);
    if (amount === null) return setAdjust({ ...adjust, error: t("femme.commissions.aguinaldo.validation.adjustAmount") });
    if (!adjust.reason.trim()) return setAdjust({ ...adjust, error: t("femme.commissions.aguinaldo.validation.reason") });
    try {
      await adjustAguinaldo({ professionalId: adjust.target.professionalId, amount, reason: adjust.reason.trim() });
      setAdjust(null);
      setNotice(t("femme.commissions.aguinaldo.adjusted"));
      await refresh(adjust.target.professionalId);
    } catch (err) {
      setAdjust({ ...adjust, error: translateApiError(err, t) });
    }
  }

  if (error && !summary) return <Alert variant="destructive">{error}</Alert>;
  if (!summary) return <Spinner />;

  const payable = summary.balances.filter((b) => b.balance > 0);
  const dateOf = (iso: string) => formatParaguayDate(iso + "T12:00:00", dateLocale);
  const concept = (m: AguinaldoDetail["movements"][number]) => {
    if (m.kind === "ACCRUAL") return t("femme.commissions.aguinaldo.concept.ACCRUAL", { period: m.note ?? "" });
    if (m.kind === "PAYMENT")
      return t(m.closesFund ? "femme.commissions.aguinaldo.concept.PAYMENT_EXIT" : "femme.commissions.aguinaldo.concept.PAYMENT");
    return t("femme.commissions.aguinaldo.concept.ADJUSTMENT", { note: m.note ?? "" });
  };
  const methodSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid={id}>
      {(["CASH", "TRANSFER", "OTHER"] as const).map((m) => (
        <option key={m} value={m}>
          {t(`femme.commissions.paymentMethod.${m}`)}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="commission-aguinaldo">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.aguinaldo.intro")}</p>
      {!summary.enabled && (
        <Alert variant="warning" data-testid="aguinaldo-off">
          {t("femme.commissions.aguinaldo.off")}
        </Alert>
      )}
      {notice && (
        <Alert variant="success" role="status" data-testid="aguinaldo-notice">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-8">
          <div>
            <div className="text-xs text-ink-3">{t("femme.commissions.aguinaldo.total")}</div>
            <b className="font-heading text-2xl tabular-nums text-warning" data-testid="aguinaldo-total">
              {formatGuaraniesGs(summary.totalBalance)}
            </b>
          </div>
          <div>
            <div className="text-xs text-ink-3">{t("femme.commissions.aguinaldo.withBalance")}</div>
            <b className="font-heading text-2xl tabular-nums text-ink" data-testid="aguinaldo-count">
              {payable.length}
            </b>
          </div>
        </div>
        {payable.length > 0 && (
          <Button
            type="button"
            className={ACTION_BUTTON}
            data-testid="aguinaldo-pay-all"
            onClick={() => setPayAll({ paidOn: todayYmd(), method: "CASH", note: "", error: null })}
          >
            {t("femme.commissions.aguinaldo.payAll")}
          </Button>
        )}
      </div>

      {summary.balances.length === 0 ? (
        <Text variant="muted" data-testid="aguinaldo-empty">
          {t("femme.commissions.aguinaldo.empty")}
        </Text>
      ) : (
        <ul className="rounded-card border border-line bg-surface shadow-sm" data-testid="aguinaldo-balances">
          {summary.balances.map((b) => (
            <li
              key={b.professionalId}
              data-testid="aguinaldo-row"
              data-professional={b.professionalName ?? ""}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-2.5 first:border-t-0 ${
                detail?.professionalId === b.professionalId ? "bg-primary-lt/40" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-extrabold text-ink">{b.professionalName}</div>
                <div className="text-xs text-ink-3">
                  {t("femme.commissions.aguinaldo.colLastPayment")}:{" "}
                  {b.lastPaymentOn ? dateOf(b.lastPaymentOn) : t("femme.commissions.aguinaldo.never")}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <b className="font-heading text-lg tabular-nums text-warning" data-testid="aguinaldo-balance">
                  {formatGuaraniesGs(b.balance)}
                </b>
                <Button
                  type="button"
                  variant="secondary"
                  className={ACTION_BUTTON}
                  data-testid="aguinaldo-view"
                  onClick={() => void openDetail(b.professionalId)}
                >
                  {t("femme.commissions.aguinaldo.viewMovements")}
                </Button>
                {b.balance > 0 && (
                  <Button
                    type="button"
                    className={ACTION_BUTTON}
                    data-testid="aguinaldo-pay"
                    aria-label={t("femme.commissions.aguinaldo.payAria", { name: b.professionalName ?? "" })}
                    onClick={() =>
                      setPay({
                        target: b,
                        mode: "ALL",
                        amount: "",
                        paidOn: todayYmd(),
                        method: "CASH",
                        note: "",
                        closesFund: false,
                        error: null,
                      })
                    }
                  >
                    {t("femme.commissions.aguinaldo.pay")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {detail && (
        <section className="rounded-card border border-line bg-surface p-3 shadow-sm sm:p-4" data-testid="aguinaldo-detail">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-heading text-base font-extrabold text-ink">
              {t("femme.commissions.aguinaldo.movementsTitle", { name: detail.professionalName })}
            </h3>
            <Button
              type="button"
              variant="secondary"
              className={ACTION_BUTTON}
              data-testid="aguinaldo-adjust"
              onClick={() => {
                const target = summary.balances.find((b) => b.professionalId === detail.professionalId);
                if (target) setAdjust({ target, amount: "", reason: "", error: null });
              }}
            >
              {t("femme.commissions.aguinaldo.adjustAction")}
            </Button>
          </div>
          <div className="mt-2 w-full overflow-x-auto">
            <ul className="min-w-[28rem]">
              {detail.movements.map((m, i) => (
                <li
                  key={`${m.kind}-${m.movementId ?? m.settlementId}-${i}`}
                  data-testid="aguinaldo-movement"
                  data-kind={m.kind}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)_6.5rem_7rem] items-center gap-2 border-t border-line py-2 text-sm first:border-t-0"
                >
                  <span className="text-ink-3">{dateOf(m.date)}</span>
                  <span className="min-w-0 break-words font-semibold text-ink">{concept(m)}</span>
                  <span className={`text-right font-extrabold tabular-nums ${m.amount < 0 ? "text-danger" : "text-success"}`} data-testid="aguinaldo-movement-amount">
                    {m.amount > 0 ? "+ " : "− "}
                    {formatGuaraniesGs(Math.abs(m.amount))}
                  </span>
                  <span className="text-right tabular-nums" data-testid="aguinaldo-movement-balance">
                    {formatGuaraniesGs(m.balance)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <Modal
        open={pay !== null}
        onClose={() => setPay(null)}
        title={t("femme.commissions.aguinaldo.payTitle", { name: pay?.target.professionalName ?? "" })}
        description={t("femme.commissions.aguinaldo.currentBalance", { amount: formatGuaraniesGs(pay?.target.balance ?? 0) })}
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setPay(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} data-testid="aguinaldo-pay-confirm" onClick={() => void submitPay()}>
              {t("femme.commissions.aguinaldo.register")}
            </Button>
          </>
        }
      >
        {pay && (
          <div className="flex flex-col gap-3" data-testid="aguinaldo-pay-dialog">
            <RadioGroup
              value={pay.closesFund ? "ALL" : pay.mode}
              onChange={(v) => setPay({ ...pay, mode: v as "ALL" | "PARTIAL", error: null })}
              aria-label={t("femme.commissions.aguinaldo.howMuch")}
            >
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <Radio value="ALL" data-testid="aguinaldo-mode-ALL" />
                <span className="font-medium">{t("femme.commissions.aguinaldo.all", { amount: formatGuaraniesGs(pay.target.balance) })}</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <Radio value="PARTIAL" data-testid="aguinaldo-mode-PARTIAL" disabled={pay.closesFund} />
                <span className="font-medium">{t("femme.commissions.aguinaldo.partial")}</span>
              </label>
            </RadioGroup>
            {pay.mode === "PARTIAL" && !pay.closesFund && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="aguinaldo-amount">{t("femme.commissions.aguinaldo.amount")}</Label>
                <Input
                  id="aguinaldo-amount"
                  inputMode="numeric"
                  value={pay.amount}
                  invalid={!!pay.error}
                  aria-describedby={pay.error ? "aguinaldo-pay-error" : undefined}
                  className="max-w-[12rem] text-right"
                  data-testid="aguinaldo-amount"
                  onChange={(e) => setPay({ ...pay, amount: e.target.value, error: null })}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="aguinaldo-paid-on">{t("femme.commissions.aguinaldo.paidOn")}</Label>
                <LocalizedDateInput id="aguinaldo-paid-on" value={pay.paidOn} onChange={(v) => setPay({ ...pay, paidOn: v })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="aguinaldo-method">{t("femme.commissions.aguinaldo.method")}</Label>
                {methodSelect(pay.method, (v) => setPay({ ...pay, method: v }), "aguinaldo-method")}
              </div>
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-[var(--color-primary)]"
                checked={pay.closesFund}
                data-testid="aguinaldo-closes"
                onChange={(e) => setPay({ ...pay, closesFund: e.target.checked, mode: e.target.checked ? "ALL" : pay.mode, error: null })}
              />
              <span>
                <b>{t("femme.commissions.aguinaldo.closes")}</b>
                <span className="block text-xs text-ink-3">{t("femme.commissions.aguinaldo.closesHelp")}</span>
              </span>
            </label>
            <div className="flex flex-col gap-1">
              <Label htmlFor="aguinaldo-note">{t("femme.commissions.aguinaldo.note")}</Label>
              <Input id="aguinaldo-note" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            </div>
            <Text variant="small" className="text-ink-3" data-testid="aguinaldo-balance-after">
              {t("femme.commissions.aguinaldo.balanceAfter", {
                amount: formatGuaraniesGs(
                  pay.mode === "ALL" || pay.closesFund ? 0 : Math.max(0, pay.target.balance - (parseFixedInput(pay.amount) ?? 0)),
                ),
              })}
            </Text>
            <FieldValidationError id="aguinaldo-pay-error">{pay.error}</FieldValidationError>
          </div>
        )}
      </Modal>

      <Modal
        open={payAll !== null}
        onClose={() => setPayAll(null)}
        title={t("femme.commissions.aguinaldo.payAllTitle")}
        description={t("femme.commissions.aguinaldo.payAllDescription", { total: formatGuaraniesGs(summary.totalBalance) })}
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setPayAll(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} data-testid="aguinaldo-pay-all-confirm" onClick={() => void submitPayAll()}>
              {t("femme.commissions.aguinaldo.register")}
            </Button>
          </>
        }
      >
        {payAll && (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="aguinaldo-all-paid-on">{t("femme.commissions.aguinaldo.paidOn")}</Label>
                <LocalizedDateInput id="aguinaldo-all-paid-on" value={payAll.paidOn} onChange={(v) => setPayAll({ ...payAll, paidOn: v })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="aguinaldo-all-method">{t("femme.commissions.aguinaldo.method")}</Label>
                {methodSelect(payAll.method, (v) => setPayAll({ ...payAll, method: v }), "aguinaldo-all-method")}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="aguinaldo-all-note">{t("femme.commissions.aguinaldo.note")}</Label>
              <Input id="aguinaldo-all-note" value={payAll.note} onChange={(e) => setPayAll({ ...payAll, note: e.target.value })} />
            </div>
            {payAll.error && <Alert variant="destructive">{payAll.error}</Alert>}
          </div>
        )}
      </Modal>

      <Modal
        open={adjust !== null}
        onClose={() => setAdjust(null)}
        title={t("femme.commissions.aguinaldo.adjustTitle", { name: adjust?.target.professionalName ?? "" })}
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setAdjust(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} data-testid="aguinaldo-adjust-confirm" onClick={() => void submitAdjust()}>
              {t("femme.commissions.aguinaldo.adjustSave")}
            </Button>
          </>
        }
      >
        {adjust && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="aguinaldo-adjust-amount">{t("femme.commissions.aguinaldo.adjustAmount")}</Label>
              <Input
                id="aguinaldo-adjust-amount"
                inputMode="numeric"
                value={adjust.amount}
                invalid={!!adjust.error}
                aria-describedby={adjust.error ? "aguinaldo-adjust-error" : undefined}
                className="max-w-[12rem] text-right"
                data-testid="aguinaldo-adjust-amount"
                onChange={(e) => setAdjust({ ...adjust, amount: e.target.value, error: null })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="aguinaldo-adjust-reason">{t("femme.commissions.aguinaldo.adjustReason")}</Label>
              <Input
                id="aguinaldo-adjust-reason"
                value={adjust.reason}
                data-testid="aguinaldo-adjust-reason"
                onChange={(e) => setAdjust({ ...adjust, reason: e.target.value, error: null })}
              />
            </div>
            <FieldValidationError id="aguinaldo-adjust-error">{adjust.error}</FieldValidationError>
          </div>
        )}
      </Modal>
    </div>
  );
}
