import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Spinner, Text } from "@design-system";
import { getAguinaldo, getAguinaldoDetail, type AguinaldoDetail, type AguinaldoSummary } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate } from "../../lib/paraguayDateTime";
import { useFundActions } from "./FundActions";

/**
 * HU-COM-14 «Aguinaldo»: the fund of what was retained from each professional's commissions —
 * balances, movements, payments (partial, whole, on departure, to everyone) and manual adjustments.
 */
export function AguinaldoTab({ professionalId, part }: { professionalId?: number; /** «movements»: only the balance bar and the movements of one professional (her page). */ part?: "movements" } = {}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [summary, setSummary] = useState<AguinaldoSummary | null>(null);
  const [detail, setDetail] = useState<AguinaldoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const all = await getAguinaldo();
      if (professionalId === undefined) setSummary(all);
      else {
        const balances = all.balances.filter((b) => b.professionalId === professionalId);
        setSummary({ ...all, balances, totalBalance: balances.reduce((acc, b) => acc + b.balance, 0) });
      }
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [t, professionalId]);

  useEffect(() => {
    void load();
    if (professionalId !== undefined) {
      getAguinaldoDetail(professionalId)
        .then(setDetail)
        .catch((err) => setError(translateApiError(err, t)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function openDetail(id: number) {
    try {
      setDetail(await getAguinaldoDetail(id));
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }

  async function refresh(professionalId?: number) {
    await load();
    const id = professionalId ?? detail?.professionalId;
    if (id !== undefined) await openDetail(id);
  }

  const fund = useFundActions(refresh, summary?.totalBalance ?? 0);

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
  const movementList = detail ? (
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
  ) : null;

  if (part === "movements") {
    const mine = summary.balances[0] ?? null;
    return (
      <div className="flex min-w-0 flex-col gap-3" data-testid="commission-aguinaldo">
        {!summary.enabled && (
          <Alert variant="warning" data-testid="aguinaldo-off">
            {t("femme.commissions.aguinaldo.off")}
          </Alert>
        )}
        {fund.notice && (
          <Alert variant="success" role="status" data-testid="aguinaldo-notice">
            {fund.notice}
          </Alert>
        )}
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary-lt px-4 py-3" data-testid="aguinaldo-balance-bar">
          <span className="text-sm font-extrabold text-primary">{t("femme.commissions.pro.retentionBalance")}</span>
          <b className="font-heading text-xl tabular-nums text-primary" data-testid="aguinaldo-balance">
            {formatGuaraniesGs(mine?.balance ?? 0)}
          </b>
          <div className="flex flex-wrap gap-2">
            {mine && mine.balance > 0 && (
              <Button type="button" variant="outline" className={ACTION_BUTTON} data-testid="aguinaldo-pay" onClick={() => fund.openPay(mine)}>
                {t("femme.commissions.pro.retentionPay")}
              </Button>
            )}
            {mine && (
              <Button type="button" variant="secondary" className={ACTION_BUTTON} data-testid="aguinaldo-adjust" onClick={() => fund.openAdjust(mine)}>
                {t("femme.commissions.pro.retentionAdjust")}
              </Button>
            )}
          </div>
        </div>
        <section className="rounded-card border border-line bg-surface p-3 shadow-sm sm:p-4" data-testid="aguinaldo-detail">
          {movementList ?? <Spinner />}
        </section>
        {fund.dialogs}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="commission-aguinaldo">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.aguinaldo.intro")}</p>
      {!summary.enabled && (
        <Alert variant="warning" data-testid="aguinaldo-off">
          {t("femme.commissions.aguinaldo.off")}
        </Alert>
      )}
      {fund.notice && (
        <Alert variant="success" role="status" data-testid="aguinaldo-notice">
          {fund.notice}
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
        {payable.length > 0 && professionalId === undefined && (
          <Button
            type="button"
            className={ACTION_BUTTON}
            data-testid="aguinaldo-pay-all"
            onClick={fund.openPayAll}
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
                    onClick={() => fund.openPay(b)}
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
                if (target) fund.openAdjust(target);
              }}
            >
              {t("femme.commissions.aguinaldo.adjustAction")}
            </Button>
          </div>
          {movementList}
        </section>
      )}


      {fund.dialogs}
    </div>
  );
}
