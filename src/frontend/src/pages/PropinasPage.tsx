import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  KebabMenu,
  Label,
  Modal,
  Select,
  Spinner,
  Text,
  Toast,
} from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  createTipWithdrawal,
  downloadTipsReportPdf,
  getProfessionalTipBalance,
  getTipsReport,
  listTipWithdrawalsPaged,
  type TipReportResponse,
  type TipWithdrawalHistoryItem,
} from "../api/propinas";
import { FieldValidationError } from "../components/FieldValidationError";
import { useDateLocale } from "../i18n/dateLocale";
import { formatGuaraniesGs } from "../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../lib/moneyInputMask";

type Professional = { id: number; fullName: string; active: boolean };
type Period = 7 | 30 | 90;
const PERIODS: Period[] = [7, 30, 90];
const MOVEMENTS_PAGE = 15;

const fmtYmd = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

/** Local calendar dates: `days` ago through today. */
function periodRange(days: number): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  return { from: fmtYmd(start), to: fmtYmd(today) };
}

function localDateYmdToIsoStart(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 0, 0, 0, 0).toISOString();
}

function localDateYmdToIsoEnd(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 23, 59, 59, 999).toISOString();
}

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

type Movement =
  | { kind: "tip"; key: string; at: string; professional: string; client: string; amount: number }
  | { kind: "withdrawal"; key: string; at: string; professional: string; amount: number };

export default function PropinasPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [period, setPeriod] = useState<Period | null>(30);
  const [range, setRange] = useState(() => periodRange(30));
  const [professionalId, setProfessionalId] = useState<number | "">("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [report, setReport] = useState<TipReportResponse | null>(null);
  const [withdrawals, setWithdrawals] = useState<TipWithdrawalHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [visible, setVisible] = useState(MOVEMENTS_PAGE);

  const [exportError, setExportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Withdraw dialog
  const [withdrawFor, setWithdrawFor] = useState<Professional | null>(null);
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeProfessionals = useMemo(() => professionals.filter((p) => p.active), [professionals]);
  const shownProfessionals = useMemo(
    () =>
      professionalId === ""
        ? activeProfessionals
        : activeProfessionals.filter((p) => p.id === professionalId),
    [activeProfessionals, professionalId],
  );

  useEffect(() => {
    femmeJson<Professional[]>("/api/professionals")
      .then((list) => setProfessionals(Array.isArray(list) ? list : []))
      .catch(() => setProfessionals([]));
  }, []);

  const loadBalances = useCallback(async (list: Professional[]) => {
    const entries = await Promise.all(
      list.map(async (p) => {
        try {
          const b = await getProfessionalTipBalance(p.id);
          return [p.id, b.balance] as const;
        } catch {
          return [p.id, 0] as const;
        }
      }),
    );
    setBalances(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (activeProfessionals.length > 0) void loadBalances(activeProfessionals);
  }, [activeProfessionals, loadBalances, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [rep, wds] = await Promise.all([
          getTipsReport({
            from: localDateYmdToIsoStart(range.from),
            to: localDateYmdToIsoEnd(range.to),
            professionalIds: professionalId === "" ? [] : [professionalId],
          }),
          listTipWithdrawalsPaged({
            professionalId: professionalId === "" ? undefined : professionalId,
            page: 0,
            size: 200,
          }),
        ]);
        if (cancelled) return;
        setReport(rep);
        setWithdrawals(wds.content);
        setVisible(MOVEMENTS_PAGE);
      } catch (err) {
        if (!cancelled) {
          setLoadError(translateApiError(err, t, "femme.propinas.report.loadError"));
          setReport(null);
          setWithdrawals([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, professionalId, reloadTick, t]);

  function selectPeriod(days: Period) {
    setPeriod(days);
    setRange(periodRange(days));
  }

  function changeRange(patch: Partial<{ from: string; to: string }>) {
    setPeriod(null);
    setRange((prev) => ({ ...prev, ...patch }));
  }

  const movements = useMemo<Movement[]>(() => {
    const fromMs = new Date(localDateYmdToIsoStart(range.from)).getTime();
    const toMs = new Date(localDateYmdToIsoEnd(range.to)).getTime();
    const tips: Movement[] = (report?.rows ?? []).map((row, i) => ({
      kind: "tip",
      key: `tip-${row.professionalId}-${row.serviceDateTime}-${i}`,
      at: row.serviceDateTime,
      professional: row.professionalName,
      client: row.clientName,
      amount: Number(row.amount),
    }));
    const wds: Movement[] = withdrawals
      .filter((w) => {
        const ms = new Date(w.withdrawnAt).getTime();
        return ms >= fromMs && ms <= toMs;
      })
      .map((w) => ({
        kind: "withdrawal",
        key: `wd-${w.id}`,
        at: w.withdrawnAt,
        professional: w.professionalName,
        amount: Number(w.amount),
      }));
    return [...tips, ...wds].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [report, withdrawals, range]);

  const tipsTotal = Number(report?.grandTotal ?? 0);
  const withdrawnTotal = Number(report?.withdrawalsTotal ?? 0);
  const periodDays = period ?? 0;

  const fmtDay = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short" }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  async function handleExportPdf() {
    setExportError(null);
    try {
      await downloadTipsReportPdf({
        from: localDateYmdToIsoStart(range.from),
        to: localDateYmdToIsoEnd(range.to),
        professionalIds: professionalId === "" ? [] : [professionalId],
      });
    } catch (err) {
      setExportError(translateApiError(err, t, "femme.propinas.report.exportError"));
    }
  }

  function openWithdraw(p: Professional) {
    setWithdrawFor(p);
    setAmount("");
    setFieldError(null);
    setSubmitError(null);
  }

  function closeWithdraw() {
    setWithdrawFor(null);
  }

  const withdrawBalance = withdrawFor ? (balances[withdrawFor.id] ?? 0) : 0;

  async function submitWithdraw() {
    if (!withdrawFor) return;
    setSubmitError(null);
    const parsed = parseMaskedMoney(amount);
    if (parsed <= 0) {
      setFieldError(t("femme.propinas.withdrawal.amountInvalid"));
      return;
    }
    if (parsed > withdrawBalance) {
      setFieldError(t("femme.propinas.withdrawal.amountExceedsBalance"));
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      await createTipWithdrawal(withdrawFor.id, parsed);
      closeWithdraw();
      setNotice(t("femme.propinas.withdrawal.success"));
      setReloadTick((n) => n + 1);
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.propinas.errorTitle"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold text-ink">{t("femme.propinas.pageTitle")}</h1>
        <KebabMenu
          id="propinas-more"
          triggerAriaLabel={t("femme.propinas.moreActions")}
          items={[
            {
              id: "export-pdf",
              label: t("femme.propinas.report.exportPdf"),
              onSelect: () => void handleExportPdf(),
            },
          ]}
        />
      </div>

      {exportError ? (
        <Alert variant="destructive" title={t("femme.propinas.errorTitle")} className="mb-4">
          {exportError}
        </Alert>
      ) : null}

      <div role="group" aria-label={t("femme.propinas.periodGroup")} className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={period === d}
            data-testid={`propinas-period-${d}`}
            onClick={() => selectPeriod(d)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
              period === d
                ? "border-primary bg-primary-lt text-primary"
                : "border-line bg-surface text-ink hover:bg-bg"
            }`}
          >
            {t("femme.propinas.periodDays", { count: d })}
          </button>
        ))}
      </div>

      <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface">
        <button
          type="button"
          data-testid="propinas-filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="propinas-filters"
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between px-4 text-left font-semibold text-ink"
        >
          {t("femme.propinas.filters")}
          <span aria-hidden="true" className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
        {filtersOpen ? (
          <div id="propinas-filters" className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="propinas-filter-from">{t("femme.propinas.report.filterFrom")}</Label>
              <Input
                id="propinas-filter-from"
                type="date"
                value={range.from}
                onChange={(e) => changeRange({ from: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="propinas-filter-to">{t("femme.propinas.report.filterTo")}</Label>
              <Input
                id="propinas-filter-to"
                type="date"
                value={range.to}
                onChange={(e) => changeRange({ to: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="propinas-filter-professional">
                {t("femme.propinas.report.filterProfessional")}
              </Label>
              <Select
                id="propinas-filter-professional"
                value={professionalId === "" ? "" : String(professionalId)}
                onChange={(e) => setProfessionalId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">{t("femme.propinas.allProfessionals")}</option>
                {activeProfessionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </div>

      {loadError ? (
        <Alert variant="destructive" title={t("femme.propinas.errorTitle")} className="mb-4">
          {loadError}
        </Alert>
      ) : null}

      <section
        aria-label={t("femme.propinas.balancesTitle")}
        data-testid="propinas-cards"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]"
      >
        {shownProfessionals.map((p) => {
          const balance = balances[p.id] ?? 0;
          return (
            <div
              key={p.id}
              data-testid={`propinas-card-${p.id}`}
              className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading font-extrabold text-primary"
                >
                  {getInitials(p.fullName)}
                </span>
                <span className="break-words font-heading font-extrabold text-ink">{p.fullName}</span>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-ink-3">
                  {t("femme.propinas.withdrawal.balanceLabel")}
                </div>
                <div className="font-heading text-2xl font-extrabold text-ink" data-testid={`propinas-balance-${p.id}`}>
                  {formatGuaraniesGs(balance)}
                </div>
              </div>
              <Button
                type="button"
                variant={balance > 0 ? "primary" : "secondary"}
                className="min-h-11 w-full"
                disabled={balance <= 0}
                data-testid={`propinas-withdraw-${p.id}`}
                aria-label={t("femme.propinas.withdrawFor", { name: p.fullName })}
                onClick={() => openWithdraw(p)}
              >
                {t("femme.propinas.withdrawal.submit")}
              </Button>
            </div>
          );
        })}
      </section>

      <section
        data-testid="propinas-summary"
        className="mb-4 grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-4"
      >
        <div className="flex flex-col gap-0.5 rounded-xl bg-primary-lt p-3">
          <b className="font-heading text-lg font-extrabold text-ink" data-testid="propinas-tips-total">
            {formatGuaraniesGs(tipsTotal)}
          </b>
          <span className="text-xs text-ink-2">
            {period
              ? t("femme.propinas.tipsInPeriod", { count: periodDays })
              : t("femme.propinas.tipsInRange")}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl bg-primary-lt p-3">
          <b className="font-heading text-lg font-extrabold text-ink" data-testid="propinas-withdrawn-total">
            {formatGuaraniesGs(withdrawnTotal)}
          </b>
          <span className="text-xs text-ink-2">
            {period
              ? t("femme.propinas.withdrawnInPeriod", { count: periodDays })
              : t("femme.propinas.withdrawnInRange")}
          </span>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface px-4 py-3" data-testid="propinas-movements">
        <h2 className="mb-2 font-heading text-base font-extrabold text-ink">
          {t("femme.propinas.movementsTitle")}
        </h2>
        {loading ? (
          <div className="flex items-center gap-2 py-4">
            <Spinner size="sm" />
            <Text>{t("femme.propinas.report.loading")}</Text>
          </div>
        ) : movements.length === 0 ? (
          <Text variant="muted" className="py-3" data-testid="propinas-empty">
            {t("femme.propinas.emptyMovements")}
          </Text>
        ) : (
          <ul className="flex flex-col" role="list">
            {movements.slice(0, visible).map((m) => (
              <li
                key={m.key}
                data-testid="propinas-movement"
                data-kind={m.kind}
                className="grid min-h-12 grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line py-1.5 first:border-t-0"
              >
                <span className="whitespace-nowrap font-heading text-sm font-extrabold text-ink">
                  {fmtDay(m.at)}
                </span>
                {m.kind === "tip" ? (
                  <span className="truncate text-ink">
                    {m.client}
                    <small className="text-sm text-ink-3"> · {m.professional}</small>
                  </span>
                ) : (
                  <span className="truncate text-ink">
                    <span className="mr-1.5 text-[11px] font-extrabold uppercase tracking-wider text-ink-3">
                      {t("femme.propinas.withdrawalTag")}
                    </span>
                    {m.professional}
                  </span>
                )}
                <b
                  className={`whitespace-nowrap font-heading ${m.kind === "withdrawal" ? "text-ink-2" : "text-ink"}`}
                >
                  {m.kind === "withdrawal" ? "− " : ""}
                  {formatGuaraniesGs(m.amount)}
                </b>
              </li>
            ))}
          </ul>
        )}
        {!loading && movements.length > visible ? (
          <div className="flex justify-center py-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              data-testid="propinas-more"
              onClick={() => setVisible((v) => v + MOVEMENTS_PAGE)}
            >
              {t("femme.propinas.showMore")}
            </Button>
          </div>
        ) : null}
      </section>

      <Modal
        open={withdrawFor !== null}
        onClose={closeWithdraw}
        title={t("femme.propinas.withdrawTitle")}
      >
        {withdrawFor ? (
          <div className="flex flex-col gap-4">
            {submitError ? (
              <Alert variant="destructive" title={t("femme.propinas.errorTitle")}>
                {submitError}
              </Alert>
            ) : null}
            <div>
              <div className="text-sm text-ink-3">{withdrawFor.fullName}</div>
              <div className="font-heading text-2xl font-extrabold text-ink" data-testid="propinas-dialog-balance">
                {formatGuaraniesGs(withdrawBalance)}
              </div>
              <div className="text-sm text-ink-3">{t("femme.propinas.withdrawal.balanceLabel")}</div>
            </div>
            <div>
              <Label htmlFor="propinas-withdrawal-amount">{t("femme.propinas.withdrawal.amountLabel")}</Label>
              <Input
                id="propinas-withdrawal-amount"
                inputMode="numeric"
                value={amount}
                placeholder={t("femme.propinas.withdrawal.amountPlaceholder")}
                aria-invalid={fieldError ? "true" : "false"}
                aria-describedby={fieldError ? "propinas-withdrawal-amount-err" : undefined}
                onChange={(e) => {
                  setAmount(maskMoneyInput(e.target.value));
                  setFieldError(null);
                }}
              />
              <FieldValidationError id="propinas-withdrawal-amount-err">{fieldError}</FieldValidationError>
            </div>
            <button
              type="button"
              data-testid="propinas-withdraw-all"
              onClick={() => {
                setAmount(maskMoneyInput(String(Math.round(withdrawBalance))));
                setFieldError(null);
              }}
              className="min-h-11 self-start px-1 text-sm font-bold text-primary underline underline-offset-4"
            >
              {t("femme.propinas.withdrawAll", { amount: formatGuaraniesGs(withdrawBalance) })}
            </button>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" className="min-h-11" onClick={closeWithdraw}>
                {t("femme.propinas.cancel")}
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={submitting}
                data-testid="propinas-withdraw-confirm"
                onClick={() => void submitWithdraw()}
              >
                {submitting ? t("femme.propinas.withdrawal.submitting") : t("femme.propinas.withdrawal.submit")}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Toast
        open={notice !== null}
        onOpenChange={(o) => {
          if (!o) setNotice(null);
        }}
        variant="success"
        duration={4000}
        data-testid="propinas-toast"
      >
        {notice}
      </Toast>
    </div>
  );
}
