import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Radio, RadioGroup, Select, Text } from "@design-system";
import { adjustAguinaldo, payAguinaldo, payAguinaldoToAll, type AguinaldoBalance } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { formatGuaraniesGs } from "../../lib/formatMoney";
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
 * The payment and adjustment dialogs of the retention balance (formerly «Aguinaldo»), shared by the
 * Team tab and the professional's page: `openPay` / `openPayAll` / `openAdjust` open them and `dialogs`
 * must be rendered once by the caller. `onDone` reloads what the caller shows after a change.
 */
export function useFundActions(onDone: (professionalId?: number) => Promise<void>, totalBalance: number) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);
  const [pay, setPay] = useState<PayDialog | null>(null);
  const [payAll, setPayAll] = useState<{ paidOn: string; method: string; note: string; error: string | null } | null>(null);
  const [adjust, setAdjust] = useState<{ target: AguinaldoBalance; amount: string; reason: string; error: string | null } | null>(
    null,
  );

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
      await onDone(pay.target.professionalId);
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
      await onDone();
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
      await onDone(adjust.target.professionalId);
    } catch (err) {
      setAdjust({ ...adjust, error: translateApiError(err, t) });
    }
  }

  const methodSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid={id}>
      {(["CASH", "TRANSFER", "OTHER"] as const).map((m) => (
        <option key={m} value={m}>
          {t(`femme.commissions.paymentMethod.${m}`)}
        </option>
      ))}
    </Select>
  );

  const dialogs: ReactNode = (
    <>
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
        description={t("femme.commissions.aguinaldo.payAllDescription", { total: formatGuaraniesGs(totalBalance) })}
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
    </>
  );

  return {
    notice,
    openPay: (target: AguinaldoBalance) =>
      setPay({ target, mode: "ALL", amount: "", paidOn: todayYmd(), method: "CASH", note: "", closesFund: false, error: null }),
    openPayAll: () => setPayAll({ paidOn: todayYmd(), method: "CASH", note: "", error: null }),
    openAdjust: (target: AguinaldoBalance) => setAdjust({ target, amount: "", reason: "", error: null }),
    dialogs,
  };
}
