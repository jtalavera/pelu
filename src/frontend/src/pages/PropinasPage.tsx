import { withDisplayNames } from "../lib/professionalDisplay";
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
  Textarea,
  Toast,
} from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  createManualTip,
  createTipWithdrawal,
  downloadTipsReportPdf,
  getProfessionalTipBalance,
  getTipsReport,
  listTipWithdrawalsPaged,
  updateManualTip,
  voidManualTip,
  type TipReportResponse,
  type TipWithdrawalHistoryItem,
} from "../api/propinas";
import { getCurrentSession, listCashSessionsPaged } from "../api/cashSessions";
import { FieldValidationError } from "../components/FieldValidationError";
import { useMe } from "../hooks/useMe";
import { useDateLocale } from "../i18n/dateLocale";
import { formatGuaraniesGs } from "../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../lib/moneyInputMask";

type Professional = { id: number; fullName: string; displayName?: string | null; active: boolean };
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

/** A tip loaded by hand by the administrator (editable until voided). */
type ManualInfo = {
  id: number;
  professionalId: number;
  note: string | null;
  createdByName: string | null;
  voided: boolean;
  voidReason: string | null;
  voidedByName: string | null;
};

type Movement =
  | {
      kind: "tip";
      key: string;
      at: string;
      professional: string;
      client: string | null;
      amount: number;
      manual?: ManualInfo;
    }
  | { kind: "withdrawal"; key: string; at: string; professional: string; amount: number };

/** Case- and accent-insensitive text for the professionals search. */
function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Noon of the chosen local day: far from midnight, so the day never shifts across timezones. */
function localDateYmdToIsoNoon(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 12, 0, 0, 0).toISOString();
}

type ManualDialog = { mode: "create" | "edit"; tipId?: number; professionalId: number | ""; oldAmount: number };

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
  // The period/range the table currently on screen was loaded for. While a new one loads, the old
  // rows stay put (dimmed) instead of being replaced by a spinner: the card keeps its height and the
  // page does not jump.
  const [shown, setShown] = useState<{ range: { from: string; to: string }; period: Period | null }>(
    () => ({ range: periodRange(30), period: 30 }),
  );
  // First-load gates: the page is shown in one go (balances card + movements) instead of the
  // movements popping in first and the balances — a professionals fetch followed by one request
  // per professional — arriving (and re-sorting the list) afterwards.
  const [professionalsLoaded, setProfessionalsLoaded] = useState(false);
  const [balancesLoaded, setBalancesLoaded] = useState(false);
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [movPage, setMovPage] = useState(0);
  const [movPageSize, setMovPageSize] = useState(10);
  const [balPage, setBalPage] = useState(0);
  // Search over the professionals' balances: the draft is what is typed, the applied query is what
  // the list is filtered by (set on submit, like every other search field).
  const [balQueryDraft, setBalQueryDraft] = useState("");
  const [balQuery, setBalQuery] = useState("");
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "ADMIN";
  const [manualDialog, setManualDialog] = useState<ManualDialog | null>(null);
  const [manualAmount, setManualAmount] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualErrors, setManualErrors] = useState<{
    professional?: string;
    amount?: string;
    date?: string;
  }>({});
  const [manualSubmitError, setManualSubmitError] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [voidTarget, setVoidTarget] = useState<ManualInfo | null>(null);
  const [voidAmountLabel, setVoidAmountLabel] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  const [exportError, setExportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Withdraw dialog
  const [withdrawFor, setWithdrawFor] = useState<Professional | null>(null);
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Where the withdrawal will be recorded when no register is open (null = nothing to warn about). */
  const [registerNote, setRegisterNote] = useState<string | null>(null);

  const activeProfessionals = useMemo(() => professionals.filter((p) => p.active), [professionals]);
  // Most to withdraw first; ties alphabetical.
  const sortedProfessionals = useMemo(() => {
    // The balances are what each professional has accumulated today: neither the period nor the
    // professional filter (both belong to «Movimientos») change them.
    return [...activeProfessionals].sort(
      (a, b) =>
        (balances[b.id] ?? 0) - (balances[a.id] ?? 0) || a.fullName.localeCompare(b.fullName),
    );
  }, [activeProfessionals, balances]);
  const visibleProfessionals = useMemo(() => {
    const q = normalizeSearch(balQuery);
    if (!q) return sortedProfessionals;
    return sortedProfessionals.filter((p) => normalizeSearch(p.fullName).includes(q));
  }, [sortedProfessionals, balQuery]);
  // Accumulated tips of what the list currently shows (all of it, not only the current page).
  const visibleTotal = visibleProfessionals.reduce((acc, p) => acc + (balances[p.id] ?? 0), 0);
  const balPages = Math.max(1, Math.ceil(visibleProfessionals.length / BALANCES_PAGE));
  const safeBalPage = Math.min(balPage, balPages - 1);
  const shownProfessionals = visibleProfessionals.slice(
    safeBalPage * BALANCES_PAGE,
    (safeBalPage + 1) * BALANCES_PAGE,
  );

  useEffect(() => {
    femmeJson<Professional[]>("/api/professionals/options")
      .then((list) => {
        setProfessionals(Array.isArray(list) ? withDisplayNames(list) : []);
        setProfessionalsLoaded(true);
      })
      .catch(() => {
        setProfessionals([]);
        setProfessionalsLoaded(true);
      });
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
    setBalancesLoaded(true);
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
        setShown({ range, period });
        setMovPage(0);
      } catch (err) {
        if (!cancelled) {
          setLoadError(translateApiError(err, t, "femme.propinas.report.loadError"));
          setReport(null);
          setWithdrawals([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setMovementsLoaded(true);
        }
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

  // `me` is part of the first load too: the admin-only buttons (+ / Agregar propina / row menu)
  // must not pop in after everything else is already on screen.
  const pageReady =
    !meLoading &&
    movementsLoaded &&
    professionalsLoaded &&
    (activeProfessionals.length === 0 || balancesLoaded);

  const movements = useMemo<Movement[]>(() => {
    // Withdrawals are filtered by the range the report on screen was loaded for, not by the one just
    // picked (its data is still on its way).
    const fromMs = new Date(localDateYmdToIsoStart(shown.range.from)).getTime();
    const toMs = new Date(localDateYmdToIsoEnd(shown.range.to)).getTime();
    const tips: Movement[] = (report?.rows ?? []).map((row, i) => ({
      kind: "tip",
      key: `tip-${row.manualTipId ?? ""}-${row.professionalId}-${row.serviceDateTime}-${i}`,
      at: row.serviceDateTime,
      professional: row.professionalName,
      client: row.clientName,
      amount: Number(row.amount),
      manual:
        row.manualTipId != null
          ? {
              id: row.manualTipId,
              professionalId: row.professionalId,
              note: row.note ?? null,
              createdByName: row.createdByName ?? null,
              voided: row.voided === true,
              voidReason: row.voidReason ?? null,
              voidedByName: row.voidedByName ?? null,
            }
          : undefined,
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
  }, [report, withdrawals, shown]);

  const movPages = Math.max(1, Math.ceil(movements.length / movPageSize));
  const safeMovPage = Math.min(movPage, movPages - 1);
  const pagedMovements = movements.slice(safeMovPage * movPageSize, (safeMovPage + 1) * movPageSize);
  const movFrom = movements.length === 0 ? 0 : safeMovPage * movPageSize + 1;
  const movTo = Math.min((safeMovPage + 1) * movPageSize, movements.length);

  // The report's `grandTotal` is NET (tips minus the withdrawals of the period), so the gross tips
  // of the period are the net plus what was withdrawn — the two figures shown are tips and withdrawals.
  const withdrawnTotal = Number(report?.withdrawalsTotal ?? 0);
  const tipsTotal = Number(report?.grandTotal ?? 0) + withdrawnTotal;
  // The summary line describes what is on screen; the active-filter chip follows the live choice.
  const periodDays = shown.period ?? 0;
  const livePeriodDays = period ?? 0;

  const fmtDay = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short" }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const fmtTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    } catch {
      return "";
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
    setRegisterNote(null);
    // With no open register the withdrawal goes to the last closed one, flagged "after close":
    // tell the user before they confirm.
    void (async () => {
      try {
        if (await getCurrentSession()) return;
        const closed = await listCashSessionsPaged({ status: "CLOSED", page: 0, size: 1 });
        const last = closed.content[0];
        setRegisterNote(
          last
            ? t("femme.propinas.withdrawal.afterCloseNote", {
                id: last.id,
                date: fmtDay(last.closedAt ?? last.openedAt),
              })
            : t("femme.propinas.withdrawal.noRegisterNote"),
        );
      } catch {
        setRegisterNote(null);
      }
    })();
  }

  function closeWithdraw() {
    setWithdrawFor(null);
  }

  const withdrawBalance = withdrawFor ? (balances[withdrawFor.id] ?? 0) : 0;

  function submitBalanceSearch(e: React.FormEvent) {
    e.preventDefault();
    setBalQuery(balQueryDraft);
    setBalPage(0);
  }

  function clearBalanceSearch() {
    setBalQueryDraft("");
    setBalQuery("");
    setBalPage(0);
  }

  function openManualCreate(professionalId: number | "") {
    setManualDialog({ mode: "create", professionalId, oldAmount: 0 });
    setManualAmount("");
    setManualDate(fmtYmd(new Date()));
    setManualNote("");
    setManualErrors({});
    setManualSubmitError(null);
  }

  function openManualEdit(m: Movement) {
    if (m.kind !== "tip" || !m.manual) return;
    setManualDialog({
      mode: "edit",
      tipId: m.manual.id,
      professionalId: m.manual.professionalId,
      oldAmount: m.amount,
    });
    setManualAmount(maskMoneyInput(String(Math.round(m.amount))));
    setManualDate(fmtYmd(new Date(m.at)));
    setManualNote(m.manual.note ?? "");
    setManualErrors({});
    setManualSubmitError(null);
  }

  function openVoid(m: Movement) {
    if (m.kind !== "tip" || !m.manual) return;
    setVoidTarget(m.manual);
    setVoidAmountLabel(formatGuaraniesGs(m.amount));
    setVoidReason("");
    setVoidError(null);
  }

  const manualParsedAmount = parseMaskedMoney(manualAmount);
  const manualProfessional =
    manualDialog && manualDialog.professionalId !== ""
      ? professionals.find((p) => p.id === manualDialog.professionalId)
      : undefined;
  const manualCurrentBalance = manualProfessional ? (balances[manualProfessional.id] ?? 0) : 0;
  const manualNewBalance =
    manualCurrentBalance -
    (manualDialog?.mode === "edit" ? manualDialog.oldAmount : 0) +
    (Number.isFinite(manualParsedAmount) && manualParsedAmount > 0 ? manualParsedAmount : 0);

  async function submitManual() {
    if (!manualDialog) return;
    const errors: { professional?: string; amount?: string; date?: string } = {};
    if (manualDialog.professionalId === "") {
      errors.professional = t("femme.propinas.manual.professionalRequired");
    }
    if (!Number.isFinite(manualParsedAmount) || manualParsedAmount <= 0) {
      errors.amount = t("femme.propinas.manual.amountInvalid");
    }
    if (!manualDate) {
      errors.date = t("femme.propinas.manual.dateRequired");
    } else if (manualDate > fmtYmd(new Date())) {
      errors.date = t("femme.propinas.manual.dateFuture");
    }
    setManualErrors(errors);
    setManualSubmitError(null);
    if (Object.keys(errors).length > 0) return;
    const payload = {
      amount: manualParsedAmount,
      tippedAt: localDateYmdToIsoNoon(manualDate),
      note: manualNote.trim() === "" ? null : manualNote.trim(),
    };
    setManualSubmitting(true);
    try {
      if (manualDialog.mode === "edit" && manualDialog.tipId != null) {
        await updateManualTip(manualDialog.tipId, payload);
        setNotice(t("femme.propinas.manual.edited"));
      } else {
        await createManualTip(Number(manualDialog.professionalId), payload);
        setNotice(t("femme.propinas.manual.added"));
      }
      setManualDialog(null);
      setReloadTick((n) => n + 1);
    } catch (err) {
      setManualSubmitError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setManualSubmitting(false);
    }
  }

  async function submitVoid() {
    if (!voidTarget) return;
    if (voidReason.trim() === "") {
      setVoidError(t("femme.propinas.manual.voidReasonRequired"));
      return;
    }
    setVoidError(null);
    setVoidSubmitting(true);
    try {
      await voidManualTip(voidTarget.id, voidReason.trim());
      setVoidTarget(null);
      setNotice(t("femme.propinas.manual.voided"));
      setReloadTick((n) => n + 1);
    } catch (err) {
      setVoidError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setVoidSubmitting(false);
    }
  }

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
      const res = await createTipWithdrawal(withdrawFor.id, parsed);
      closeWithdraw();
      setNotice(
        res.afterClose && res.cashSessionId != null
          ? t("femme.propinas.withdrawal.successAfterClose", { id: res.cashSessionId })
          : t("femme.propinas.withdrawal.success"),
      );
      setReloadTick((n) => n + 1);
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.propinas.errorTitle"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold text-ink">{t("femme.propinas.pageTitle")}</h1>
        <div className="flex items-center gap-1 max-sm:w-full max-sm:justify-end">
          {pageReady && isAdmin ? (
            <Button
              type="button"
              className="min-h-11 max-sm:flex-1"
              data-testid="propinas-add-manual"
              onClick={() => openManualCreate("")}
            >
              + {t("femme.propinas.manual.addButton")}
            </Button>
          ) : null}
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
      </div>

      {exportError ? (
        <Alert variant="destructive" title={t("femme.propinas.errorTitle")} className="mb-4">
          {exportError}
        </Alert>
      ) : null}

      {loadError ? (
        <Alert variant="destructive" title={t("femme.propinas.errorTitle")} className="mb-4">
          {loadError}
        </Alert>
      ) : null}

      {!pageReady ? (
        <div className="flex items-center gap-2 py-6" data-testid="propinas-initial-loading">
          <Spinner size="sm" />
          <Text>{t("femme.propinas.initialLoading")}</Text>
        </div>
      ) : null}

      {pageReady ? (
      <>
      <section
        aria-label={t("femme.propinas.balancesTitle")}
        data-testid="propinas-cards"
        className="mb-4 flex flex-col gap-4 rounded-card bg-surface p-4 shadow-sm sm:p-6"
      >
        <div className="flex items-end justify-between gap-4" data-testid="propinas-balances-total">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-extrabold text-ink">{t("femme.propinas.balancesTitle")}</h2>
            <p className="text-sm text-ink-3" data-testid="propinas-balances-caption">
              {balQuery.trim() !== ""
                ? t("femme.propinas.balancesSubtitleFiltered", {
                    shown: visibleProfessionals.length,
                    total: sortedProfessionals.length,
                  })
                : t("femme.propinas.balancesSubtitle", { total: sortedProfessionals.length })}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-xs text-ink-3">{t("femme.propinas.balancesTotalLabel")}</span>
            <b
              className="font-heading text-xl font-extrabold text-primary sm:text-2xl"
              data-testid="propinas-balances-total-amount"
            >
              {formatGuaraniesGs(visibleTotal)}
            </b>
          </div>
        </div>
        {/* The search only earns its place when the list does not fit on one page. */}
        {sortedProfessionals.length > BALANCES_PAGE || balQuery !== "" ? (
          <form
            onSubmit={submitBalanceSearch}
            role="search"
            data-testid="propinas-balances-search"
            className="flex h-11 items-center gap-1 rounded-full bg-page pl-4 pr-1"
          >
            <input
              id="propinas-balances-search-input"
              type="search"
              value={balQueryDraft}
              onChange={(e) => setBalQueryDraft(e.target.value)}
              placeholder={t("femme.propinas.balancesSearchPlaceholder")}
              aria-label={t("femme.propinas.balancesSearchLabel")}
              data-testid="propinas-balances-search-input"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
            />
            {balQuery !== "" ? (
              <button
                type="button"
                aria-label={t("femme.propinas.balancesSearchClear")}
                data-testid="propinas-balances-search-clear"
                onClick={clearBalanceSearch}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-ink-3 hover:text-ink"
              >
                ×
              </button>
            ) : null}
            <button
              type="submit"
              aria-label={t("femme.propinas.balancesSearchSubmit")}
              data-testid="propinas-balances-search-submit"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="8" cy="8" r="5.5" />
                <path d="M12.5 12.5L16 16" />
              </svg>
            </button>
          </form>
        ) : null}
        {visibleProfessionals.length === 0 && balQuery.trim() !== "" ? (
          <div data-testid="propinas-balances-no-match">
            <p className="font-bold text-ink">
              {t("femme.propinas.balancesNoMatch", { query: balQuery.trim() })}
            </p>
            <p className="text-sm text-ink-3">{t("femme.propinas.balancesNoMatchHint")}</p>
          </div>
        ) : null}
        <div>
          {shownProfessionals.map((p) => {
            const balance = balances[p.id] ?? 0;
            return (
              <div
                key={p.id}
                data-testid={`propinas-card-${p.id}`}
                className={`grid min-h-[3.75rem] items-center gap-2 border-t border-line/60 first:border-t-0 sm:gap-3 ${
                  isAdmin
                    ? "grid-cols-[minmax(0,1fr)_2.75rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_auto_2.75rem_6.5rem]"
                    : "grid-cols-[minmax(0,1fr)_5.5rem] sm:grid-cols-[minmax(0,1fr)_auto_6.5rem]"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading text-sm font-extrabold text-primary"
                  >
                    {getInitials(p.fullName).slice(0, 1)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-bold text-ink">{p.fullName}</span>
                    {/* On a phone the amount sits under the name; from sm up it has its own column. */}
                    <span className="font-heading text-sm font-extrabold text-ink-2 sm:hidden">
                      {formatGuaraniesGs(balance)}
                    </span>
                  </span>
                </span>
                <b
                  className="hidden whitespace-nowrap text-right font-heading text-ink sm:block"
                  data-testid={`propinas-balance-${p.id}`}
                >
                  {formatGuaraniesGs(balance)}
                </b>
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11 min-h-11 min-w-11 p-0 text-xl"
                    data-testid={`propinas-add-${p.id}`}
                    aria-label={t("femme.propinas.manual.addFor", { name: p.fullName })}
                    onClick={() => openManualCreate(p.id)}
                  >
                    +
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
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
        </div>
        {visibleProfessionals.length > BALANCES_PAGE ? (
          <div
            className="flex items-center justify-between gap-3 text-sm text-ink-3"
            data-testid="propinas-balances-pager"
          >
            <span>
              {t("femme.propinas.balancesRange", {
                from: safeBalPage * BALANCES_PAGE + 1,
                to: Math.min((safeBalPage + 1) * BALANCES_PAGE, visibleProfessionals.length),
                total: visibleProfessionals.length,
              })}
            </span>
            <span className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 min-w-11 text-xl"
                aria-label={t("femme.pagination.previous")}
                disabled={safeBalPage === 0}
                data-testid="propinas-balances-prev"
                onClick={() => setBalPage(safeBalPage - 1)}
              >
                ‹
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 min-w-11 text-xl text-primary"
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
        className="mb-4 flex flex-col gap-2 rounded-card bg-surface px-4 py-3 shadow-sm sm:px-6 sm:py-4"
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
              {shown.period ? t("femme.propinas.inPeriod", { count: periodDays }) : t("femme.propinas.inRange")}
            </span>
          </div>
        </div>
        <span
          className="w-fit rounded-full bg-primary-lt px-2.5 py-0.5 text-xs font-extrabold text-primary"
          data-testid="propinas-active-filter"
        >
          {t("femme.propinas.activeFilter", {
            period: period
              ? t("femme.propinas.lastDays", { count: livePeriodDays })
              : `${range.from} – ${range.to}`,
            professional:
              professionalId === ""
                ? t("femme.propinas.allProfessionals")
                : (activeProfessionals.find((p) => p.id === professionalId)?.fullName ?? ""),
          })}
        </span>
      <div role="group" aria-label={t("femme.propinas.periodGroup")} className="flex flex-wrap gap-2">
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
      <div className="overflow-hidden rounded-card border border-line bg-surface">
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
        <div
          aria-busy={loading}
          data-testid="propinas-movements-list"
          className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}
        >
        {movements.length === 0 ? (
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
                    {isAdmin ? <th className="w-11 px-1 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {pagedMovements.map((m) => {
                    const manual = m.kind === "tip" ? m.manual : undefined;
                    const voided = manual?.voided === true;
                    // The table stays simple: one line saying what the movement is. The rest (note,
                    // who loaded it, why it was voided) is a tooltip, and lives in the audit trail.
                    const conceptLabel =
                      m.kind === "withdrawal"
                        ? t("femme.propinas.concept.withdrawal")
                        : manual
                          ? t("femme.propinas.concept.manual")
                          : m.client
                            ? t("femme.propinas.concept.tipOf", { name: m.client })
                            : t("femme.propinas.concept.tip");
                    const conceptDetail = manual
                      ? [
                          manual.note,
                          manual.createdByName
                            ? t("femme.propinas.manual.createdBy", { name: manual.createdByName })
                            : null,
                          voided
                            ? t("femme.propinas.manual.voidedBy", {
                                name: manual.voidedByName ?? "",
                                reason: manual.voidReason ?? "",
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "";
                    return (
                    <tr
                      key={m.key}
                      data-testid="propinas-movement"
                      data-kind={m.kind}
                      data-manual={manual ? "true" : undefined}
                      data-voided={voided ? "true" : undefined}
                      className={`h-11 border-t border-line first:border-t-0 ${voided ? "text-ink-3" : ""}`}
                    >
                      <td className="whitespace-nowrap px-2 font-heading font-extrabold text-ink">
                        {fmtDay(m.at)}
                        <span className="ml-1.5 text-xs font-normal text-ink-3">{fmtTime(m.at)}</span>
                      </td>
                      <td className="px-2 text-ink" title={conceptDetail || undefined}>
                        <span className="flex items-center gap-2">
                          <span
                            className={`max-w-[16rem] truncate font-semibold ${voided ? "text-ink-3 line-through" : ""}`}
                            data-testid="propinas-movement-concept"
                          >
                            {conceptLabel}
                          </span>
                          {voided ? (
                            <span
                              className="rounded-full bg-danger-lt px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-danger"
                              data-testid="propinas-voided-tag"
                            >
                              {t("femme.propinas.manual.voidedTag")}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 text-ink">{m.professional}</td>
                      <td
                        data-testid="propinas-movement-amount"
                        className={`whitespace-nowrap px-2 text-right font-heading font-bold ${
                          m.kind === "withdrawal" ? "text-ink-2" : voided ? "text-ink-3 line-through" : "text-ink"
                        }`}
                      >
                        {m.kind === "withdrawal" ? "− " : ""}
                        {formatGuaraniesGs(m.amount)}
                      </td>
                      {isAdmin ? (
                        <td className="px-1 text-right">
                          {manual && !voided ? (
                            <KebabMenu
                              id={`propinas-manual-${manual.id}`}
                              triggerAriaLabel={t("femme.propinas.manual.rowActions", { name: m.professional })}
                              items={[
                                {
                                  id: "edit",
                                  label: t("femme.propinas.manual.edit"),
                                  onSelect: () => openManualEdit(m),
                                },
                                {
                                  id: "void",
                                  label: t("femme.propinas.manual.void"),
                                  destructive: true,
                                  onSelect: () => openVoid(m),
                                },
                              ]}
                            />
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
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
        </div>
      </section>
      </>
      ) : null}

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
            {registerNote ? (
              <Alert variant="info" data-testid="propinas-register-note">
                {registerNote}
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

      <Modal
        open={manualDialog !== null}
        onClose={() => setManualDialog(null)}
        title={
          manualDialog?.mode === "edit"
            ? t("femme.propinas.manual.editTitle")
            : t("femme.propinas.manual.addTitle")
        }
      >
        {manualDialog ? (
          <div className="flex flex-col gap-4" data-testid="propinas-manual-dialog">
            {manualDialog.mode === "create" ? (
              <Text variant="muted">{t("femme.propinas.manual.addLead")}</Text>
            ) : null}
            {manualSubmitError ? (
              <Alert variant="destructive" title={t("femme.propinas.errorTitle")}>
                {manualSubmitError}
              </Alert>
            ) : null}
            <div>
              <Label htmlFor="propinas-manual-professional">{t("femme.propinas.manual.professional")}</Label>
              <Select
                id="propinas-manual-professional"
                data-testid="propinas-manual-professional"
                value={manualDialog.professionalId === "" ? "" : String(manualDialog.professionalId)}
                disabled={manualDialog.mode === "edit"}
                aria-invalid={manualErrors.professional ? "true" : "false"}
                aria-describedby={manualErrors.professional ? "propinas-manual-professional-err" : undefined}
                onChange={(e) => {
                  setManualDialog({
                    ...manualDialog,
                    professionalId: e.target.value === "" ? "" : Number(e.target.value),
                  });
                  setManualErrors((prev) => ({ ...prev, professional: undefined }));
                }}
              >
                <option value="">{t("femme.propinas.manual.professionalPlaceholder")}</option>
                {sortedProfessionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} · {t("femme.propinas.manual.professionalAccumulated", {
                      amount: formatGuaraniesGs(balances[p.id] ?? 0),
                    })}
                  </option>
                ))}
              </Select>
              <FieldValidationError id="propinas-manual-professional-err">
                {manualErrors.professional}
              </FieldValidationError>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="propinas-manual-amount">{t("femme.propinas.manual.amount")}</Label>
                <Input
                  id="propinas-manual-amount"
                  data-testid="propinas-manual-amount"
                  inputMode="numeric"
                  value={manualAmount}
                  placeholder={t("femme.propinas.manual.amountPlaceholder")}
                  aria-invalid={manualErrors.amount ? "true" : "false"}
                  aria-describedby={manualErrors.amount ? "propinas-manual-amount-err" : undefined}
                  onChange={(e) => {
                    setManualAmount(maskMoneyInput(e.target.value));
                    setManualErrors((prev) => ({ ...prev, amount: undefined }));
                  }}
                />
                <FieldValidationError id="propinas-manual-amount-err">{manualErrors.amount}</FieldValidationError>
              </div>
              <div>
                <Label htmlFor="propinas-manual-date">{t("femme.propinas.manual.date")}</Label>
                <Input
                  id="propinas-manual-date"
                  data-testid="propinas-manual-date"
                  type="date"
                  max={fmtYmd(new Date())}
                  value={manualDate}
                  aria-invalid={manualErrors.date ? "true" : "false"}
                  aria-describedby={manualErrors.date ? "propinas-manual-date-err" : undefined}
                  onChange={(e) => {
                    setManualDate(e.target.value);
                    setManualErrors((prev) => ({ ...prev, date: undefined }));
                  }}
                />
                <FieldValidationError id="propinas-manual-date-err">{manualErrors.date}</FieldValidationError>
              </div>
            </div>
            <div>
              <Label htmlFor="propinas-manual-note">
                {t("femme.propinas.manual.note")}{" "}
                <span className="font-normal text-ink-3">{t("femme.propinas.manual.noteOptional")}</span>
              </Label>
              <Textarea
                id="propinas-manual-note"
                data-testid="propinas-manual-note"
                rows={2}
                maxLength={200}
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
              />
              <div className="text-right text-xs text-ink-3">
                {t("femme.propinas.manual.noteCounter", { count: manualNote.length })}
              </div>
            </div>
            {manualProfessional ? (
              <div
                className="flex items-baseline justify-between gap-3 rounded-xl bg-primary-lt px-4 py-2.5 text-primary"
                data-testid="propinas-manual-new-balance"
              >
                <span className="text-sm font-bold">
                  {t("femme.propinas.manual.newBalance", { name: manualProfessional.fullName })}
                </span>
                <b className="font-heading text-lg font-extrabold" data-testid="propinas-manual-new-balance-amount">
                  {formatGuaraniesGs(manualNewBalance)}
                </b>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => setManualDialog(null)}
              >
                {t("femme.propinas.cancel")}
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={manualSubmitting}
                data-testid="propinas-manual-confirm"
                onClick={() => void submitManual()}
              >
                {manualSubmitting
                  ? t("femme.propinas.manual.submitting")
                  : manualDialog.mode === "edit"
                    ? t("femme.propinas.manual.submitEdit")
                    : t("femme.propinas.manual.submitAdd")}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        title={t("femme.propinas.manual.voidTitle")}
      >
        {voidTarget ? (
          <div className="flex flex-col gap-4" data-testid="propinas-void-dialog">
            <Text variant="muted">{t("femme.propinas.manual.voidLead")}</Text>
            <div className="rounded-xl bg-page px-4 py-2.5 font-heading font-extrabold text-ink">
              {voidAmountLabel}
            </div>
            <div>
              <Label htmlFor="propinas-void-reason">{t("femme.propinas.manual.voidReason")}</Label>
              <Textarea
                id="propinas-void-reason"
                data-testid="propinas-void-reason"
                rows={2}
                maxLength={200}
                value={voidReason}
                invalid={voidError !== null}
                aria-describedby={voidError ? "propinas-void-reason-err" : undefined}
                onChange={(e) => {
                  setVoidReason(e.target.value);
                  setVoidError(null);
                }}
              />
              <FieldValidationError id="propinas-void-reason-err">{voidError}</FieldValidationError>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" className="min-h-11" onClick={() => setVoidTarget(null)}>
                {t("femme.propinas.cancel")}
              </Button>
              <Button
                type="button"
                variant="danger"
                className="min-h-11"
                disabled={voidSubmitting}
                data-testid="propinas-void-confirm"
                onClick={() => void submitVoid()}
              >
                {voidSubmitting ? t("femme.propinas.manual.submitting") : t("femme.propinas.manual.voidSubmit")}
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
