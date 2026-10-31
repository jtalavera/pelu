import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  KebabMenu,
  Label,
  Modal,
  PageSizeSelect,
  Pagination,
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
const BALANCES_PAGE = 5;

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
  const [movPage, setMovPage] = useState(0);
  const [movPageSize, setMovPageSize] = useState(10);
  const [balPage, setBalPage] = useState(0);

  const [exportError, setExportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Withdraw dialog
  const [withdrawFor, setWithdrawFor] = useState<Professional | null>(null);
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeProfessionals = useMemo(() => professionals.filter((p) => p.active), [professionals]);
  // Most to withdraw first; ties alphabetical.
  const sortedProfessionals = useMemo(() => {
    const list =
      professionalId === ""
        ? activeProfessionals
        : activeProfessionals.filter((p) => p.id === professionalId);
    return [...list].sort(
      (a, b) =>
        (balances[b.id] ?? 0) - (balances[a.id] ?? 0) || a.fullName.localeCompare(b.fullName),
    );
  }, [activeProfessionals, professionalId, balances]);
  const balPages = Math.max(1, Math.ceil(sortedProfessionals.length / BALANCES_PAGE));
  const safeBalPage = Math.min(balPage, balPages - 1);
  const shownProfessionals = sortedProfessionals.slice(
    safeBalPage * BALANCES_PAGE,
    (safeBalPage + 1) * BALANCES_PAGE,
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
        setMovPage(0);
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

  const movPages = Math.max(1, Math.ceil(movements.length / movPageSize));
  const safeMovPage = Math.min(movPage, movPages - 1);
  const pagedMovements = movements.slice(safeMovPage * movPageSize, (safeMovPage + 1) * movPageSize);
  const movFrom = movements.length === 0 ? 0 : safeMovPage * movPageSize + 1;
  const movTo = Math.min((safeMovPage + 1) * movPageSize, movements.length);

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
                onChange={(e) => {
                  setProfessionalId(e.target.value === "" ? "" : Number(e.target.value));
                  setBalPage(0);
                }}
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
        className="mb-4 rounded-card border border-line bg-surface px-4"
      >
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1fr)_auto_6rem] gap-3 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-wider text-ink-3 sm:grid"
        >
          <span>{t("femme.propinas.colProfessional")}</span>
          <span className="text-right">{t("femme.propinas.withdrawal.balanceLabel")}</span>
          <span />
        </div>
        {shownProfessionals.map((p) => {
          const balance = balances[p.id] ?? 0;
          return (
            <div
              key={p.id}
              data-testid={`propinas-card-${p.id}`}
              className="grid min-h-[3.25rem] grid-cols-[minmax(0,1fr)_auto_6rem] items-center gap-3 border-t border-line max-sm:[&:nth-child(2)]:border-t-0"
            >
              <span className="flex min-w-0 items-center gap-2.5 font-bold text-ink">
                <span
                  aria-hidden="true"
                  className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading text-[13px] font-extrabold text-primary"
                >
                  {getInitials(p.fullName).slice(0, 1)}
                </span>
                <span className="truncate">{p.fullName}</span>
              </span>
              <b
                className="whitespace-nowrap text-right font-heading text-ink"
                data-testid={`propinas-balance-${p.id}`}
              >
                {formatGuaraniesGs(balance)}
              </b>
              <Button
                type="button"
                variant={balance > 0 ? "primary" : "secondary"}
                className="min-h-11"
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
        {sortedProfessionals.length > BALANCES_PAGE ? (
          <div
            className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm text-ink-3"
            data-testid="propinas-balances-pager"
          >
            <span>
              {t("femme.propinas.balancesRange", {
                from: safeBalPage * BALANCES_PAGE + 1,
                to: Math.min((safeBalPage + 1) * BALANCES_PAGE, sortedProfessionals.length),
                total: sortedProfessionals.length,
              })}
            </span>
            <span className="flex gap-1">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 min-w-11"
                aria-label={t("femme.pagination.previous")}
                disabled={safeBalPage === 0}
                data-testid="propinas-balances-prev"
                onClick={() => setBalPage(safeBalPage - 1)}
              >
                ‹
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 min-w-11"
                aria-label={t("femme.pagination.next")}
                disabled={safeBalPage >= balPages - 1}
                data-testid="propinas-balances-next"
                onClick={() => setBalPage(safeBalPage + 1)}
              >
                ›
              </Button>
            </span>
          </div>
        ) : null}
      </section>

      <section
        className="mb-4 flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3"
        data-testid="propinas-movements"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-extrabold text-ink">
            {t("femme.propinas.movementsTitle")}
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2" data-testid="propinas-summary">
            <span>
              <b className="text-ink" data-testid="propinas-tips-total">
                {formatGuaraniesGs(tipsTotal)}
              </b>{" "}
              {t("femme.propinas.tipsLabel")}
            </span>
            <span>
              <b className="text-ink" data-testid="propinas-withdrawn-total">
                {formatGuaraniesGs(withdrawnTotal)}
              </b>{" "}
              {t("femme.propinas.withdrawnLabel")}
            </span>
            <span className="text-ink-3">
              {period ? t("femme.propinas.inPeriod", { count: periodDays }) : t("femme.propinas.inRange")}
            </span>
          </div>
        </div>
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
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] border-collapse text-sm" data-testid="propinas-table">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-extrabold uppercase tracking-wider text-ink-3">
                    <th className="px-2 py-2">{t("femme.propinas.colDate")}</th>
                    <th className="px-2 py-2">{t("femme.propinas.colConcept")}</th>
                    <th className="px-2 py-2">{t("femme.propinas.colProfessional")}</th>
                    <th className="px-2 py-2 text-right">{t("femme.propinas.colAmount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedMovements.map((m) => (
                    <tr
                      key={m.key}
                      data-testid="propinas-movement"
                      data-kind={m.kind}
                      className="h-11 border-t border-line first:border-t-0"
                    >
                      <td className="whitespace-nowrap px-2 font-heading font-extrabold text-ink">
                        {fmtDay(m.at)}
                      </td>
                      <td className="whitespace-nowrap px-2 text-ink">
                        {m.kind === "tip" ? (
                          m.client
                        ) : (
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-ink-3">
                            {t("femme.propinas.withdrawalTag")}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 text-ink">{m.professional}</td>
                      <td
                        className={`whitespace-nowrap px-2 text-right font-heading font-bold ${
                          m.kind === "withdrawal" ? "text-ink-2" : "text-ink"
                        }`}
                      >
                        {m.kind === "withdrawal" ? "− " : ""}
                        {formatGuaraniesGs(m.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <PageSizeSelect
                value={movPageSize}
                onChange={(size) => {
                  setMovPageSize(size);
                  setMovPage(0);
                }}
                label={t("femme.pagination.rowsPerPage")}
              />
              <Text variant="small" className="text-[var(--color-ink-3)]">
                {t("femme.pagination.showingRange", {
                  from: movFrom,
                  to: movTo,
                  total: movements.length,
                })}
              </Text>
              <Pagination
                page={safeMovPage + 1}
                pageCount={movPages}
                onPageChange={(p) => setMovPage(p - 1)}
                previousLabel={t("femme.pagination.previous")}
                nextLabel={t("femme.pagination.next")}
              />
            </div>
          </>
        )}
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
