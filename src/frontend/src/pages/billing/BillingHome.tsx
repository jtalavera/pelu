import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Modal,
  PageSizeSelect,
  Pagination,
  Spinner,
  Text,
} from "@design-system";
import { listInvoicesPaged, type PagedInvoicesResponse } from "../../api/invoices";
import {
  closeSession as closeSessionApi,
  createMovement as createMovementApi,
  getSessionDetail,
  openSession as openSessionApi,
  type CashMovementType,
  type CashSession,
  type CashSessionDetail,
} from "../../api/cashSessions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { CashSessionSummaryCard } from "../../components/CashSessionSummaryCard";
import { FieldValidationError } from "../../components/FieldValidationError";
import { InvoiceCorrectionForm } from "../../components/InvoiceCorrectionForm";
import { InvoiceDetailModal } from "../../components/InvoiceDetailModal";
import { InvoiceStatePill, deriveInvoiceState } from "../../components/InvoiceStatePill";
import { isSifenStatusInFlight, useSifenStatusLiveRefresh } from "../../hooks/useSifenStatusLiveRefresh";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { maskMoneyInput, moneyDigitsOnly, parseMaskedMoney } from "../../lib/moneyInputMask";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { paymentMethodsLabel, todayRangeIso } from "./billingShared";

type PanelView = "summary" | "movement" | "close";

/**
 * Billing home: one primary action ("New invoice"), today's total, and today's invoices folded
 * away until the user expands them. Cash register management lives in the panel behind the chip.
 */
export function BillingHome({
  currentSession,
  onSessionChanged,
  onNewInvoice,
  onOpenHistory,
  refreshTrigger,
  isActive,
}: {
  currentSession: CashSession | null;
  onSessionChanged: () => void;
  onNewInvoice: () => void;
  onOpenHistory: (view: "invoices" | "cash") => void;
  refreshTrigger: number;
  /** Home is the view on screen — live SIFEN refresh only runs while it is. */
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();

  // ── Open session (shown when the cash register is closed) ──
  const [openingAmount, setOpeningAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openSuccess, setOpenSuccess] = useState(false);

  // ── Cash panel ──
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>("summary");
  const [liveDetail, setLiveDetail] = useState<CashSessionDetail | null>(null);
  const [liveDetailError, setLiveDetailError] = useState<string | null>(null);

  const [countedCash, setCountedCash] = useState("");
  const [countedCashError, setCountedCashError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<CashSessionDetail | null>(null);

  const [movementType, setMovementType] = useState<Extract<CashMovementType, "MANUAL_IN" | "MANUAL_OUT">>(
    "MANUAL_IN",
  );
  const [movementAmount, setMovementAmount] = useState("");
  const [movementAmountError, setMovementAmountError] = useState<string | null>(null);
  const [movementReason, setMovementReason] = useState("");
  const [movementReasonError, setMovementReasonError] = useState<string | null>(null);
  const [movementSubmitting, setMovementSubmitting] = useState(false);
  const [movementSubmitError, setMovementSubmitError] = useState<string | null>(null);
  const [movementSubmitSuccess, setMovementSubmitSuccess] = useState(false);

  const loadLiveDetail = useCallback(async () => {
    if (!currentSession) {
      setLiveDetail(null);
      return;
    }
    try {
      const data = await getSessionDetail(currentSession.id);
      setLiveDetail(data);
      setLiveDetailError(null);
    } catch (err) {
      setLiveDetailError(translateApiError(err, t, "femme.billing.cashHistory.loadError"));
    }
  }, [currentSession, t]);

  useEffect(() => {
    void loadLiveDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLiveDetail, refreshTrigger]);

  function openPanel() {
    setPanelView("summary");
    setMovementSubmitError(null);
    setMovementSubmitSuccess(false);
    setCloseError(null);
    setPanelOpen(true);
  }

  async function handleCreateMovement(e: React.FormEvent) {
    e.preventDefault();
    setMovementSubmitError(null);
    setMovementSubmitSuccess(false);
    let hasError = false;
    if (moneyDigitsOnly(movementAmount) === "" || parseMaskedMoney(movementAmount) <= 0) {
      setMovementAmountError(t("femme.billing.movements.form.amountInvalid"));
      hasError = true;
    } else {
      setMovementAmountError(null);
    }
    if (movementReason.trim() === "") {
      setMovementReasonError(t("femme.billing.movements.form.reasonRequired"));
      hasError = true;
    } else {
      setMovementReasonError(null);
    }
    if (hasError) return;

    setMovementSubmitting(true);
    try {
      await createMovementApi({
        type: movementType,
        amount: parseMaskedMoney(movementAmount),
        reason: movementReason.trim(),
      });
      setMovementAmount("");
      setMovementReason("");
      setMovementSubmitSuccess(true);
      await loadLiveDetail();
    } catch (err) {
      setMovementSubmitError(translateApiError(err, t, "femme.billing.movements.form.submitError"));
    } finally {
      setMovementSubmitting(false);
    }
  }

  async function handleOpenSession(e: React.FormEvent) {
    e.preventDefault();
    setOpenSuccess(false);
    setOpenError(null);
    if (moneyDigitsOnly(openingAmount) === "") {
      setAmountError(t("femme.billing.openingCashAmountInvalid"));
      return;
    }
    setAmountError(null);
    setSubmitting(true);
    try {
      await openSessionApi(parseMaskedMoney(openingAmount));
      setOpeningAmount("");
      setOpenSuccess(true);
      setCloseResult(null);
      onSessionChanged();
    } catch (err) {
      setOpenError(translateApiError(err, t, "femme.billing.saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseSession(e: React.FormEvent) {
    e.preventDefault();
    setCloseError(null);
    if (moneyDigitsOnly(countedCash) === "") {
      setCountedCashError(t("femme.billing.close.countedCashAmountInvalid"));
      return;
    }
    setCountedCashError(null);
    setClosing(true);
    try {
      const result = await closeSessionApi(parseMaskedMoney(countedCash));
      setCloseResult(result);
      setCountedCash("");
      setPanelOpen(false);
      onSessionChanged();
    } catch (err) {
      setCloseError(translateApiError(err, t, "femme.billing.close.closeError"));
    } finally {
      setClosing(false);
    }
  }

  // ── Today's invoices (folded by default) ──
  const [todayOpen, setTodayOpen] = useState(false);
  const [todayPage, setTodayPage] = useState<PagedInvoicesResponse | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [todayPageNum, setTodayPageNum] = useState(0);
  const [todayPageSize, setTodayPageSize] = useState(10);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [correctionInvoiceId, setCorrectionInvoiceId] = useState<number | null>(null);

  const loadTodayInvoices = useCallback(
    async (page: number, size: number, silent = false) => {
      if (!currentSession) {
        setTodayPage(null);
        return;
      }
      if (!silent) setTodayLoading(true);
      try {
        const { from, to } = todayRangeIso();
        setTodayPage(await listInvoicesPaged({ from, to, page, size }));
      } catch {
        if (!silent) setTodayPage(null);
      } finally {
        if (!silent) setTodayLoading(false);
      }
    },
    [currentSession],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTodayInvoices(todayPageNum, todayPageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTodayInvoices, refreshTrigger, currentSession?.id, todayPageNum, todayPageSize]);

  const todayInvoices = todayPage?.content ?? [];
  // RT-20: SIFEN submission is async — a row "En proceso" can flip to its final state within
  // seconds without any user action, so re-read silently while any visible row still can.
  useSifenStatusLiveRefresh(
    isActive && todayInvoices.some((inv) => isSifenStatusInFlight(inv.sifenSubmissionStatus)),
    () => void loadTodayInvoices(todayPageNum, todayPageSize, true),
  );
  const dayTotalIssued = todayPage?.issuedTotal ?? 0;
  const todayTotalElements = todayPage?.totalElements ?? 0;
  const todayTotalPages = todayPage?.totalPages ?? 0;
  const todayShowingFrom = todayTotalElements === 0 ? 0 : todayPageNum * todayPageSize + 1;
  const todayShowingTo = Math.min((todayPageNum + 1) * todayPageSize, todayTotalElements);
  const attentionCount = todayInvoices.filter((i) => deriveInvoiceState(i) === "attention").length;

  const chip = (
    <button
      type="button"
      data-testid="billing-cash-chip"
      aria-haspopup="dialog"
      onClick={openPanel}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-primary-lt"
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${currentSession ? "bg-success" : "bg-ink-3"}`}
      />
      <span>{currentSession ? t("femme.billing.sessionOpen") : t("femme.billing.sessionClosed")}</span>
      <span aria-hidden className="text-ink-3">▾</span>
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div data-tour="billing-header" className="flex flex-wrap items-center justify-between gap-3">
        <Heading as="h1" className="text-2xl">
          {t("femme.billing.title")}
        </Heading>
        <span data-tour="billing-session">{chip}</span>
      </div>

      {openError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {openError}
        </Alert>
      )}
      {openSuccess && (
        <Alert variant="success" title={t("femme.billing.savedTitle")}>
          {t("femme.billing.savedBody")}
        </Alert>
      )}

      {closeResult && !currentSession && (
        <Card className="flex flex-col gap-3 p-4 sm:p-6" data-testid="billing-close-result">
          <Heading as="h2" className="text-lg">
            {t("femme.billing.close.closedTitle")}
          </Heading>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="font-medium">{t("femme.billing.close.closedAt")}: </span>
              {formatParaguayDateTime(closeResult.closedAt as string, dateLocale)}
            </span>
            <span>
              <span className="font-medium">{t("femme.billing.close.closedBy")}: </span>
              {closeResult.closedByEmail}
            </span>
          </div>
          <CashSessionSummaryCard detail={closeResult} />
        </Card>
      )}

      {currentSession ? (
        <>
          <Card className="flex flex-col gap-4 p-4 sm:p-6">
            <div>
              <Text variant="muted" className="text-sm">
                {t("femme.billing.home.today")}
              </Text>
              <div className="font-heading text-3xl font-extrabold tabular-nums text-ink" data-testid="billing-day-total">
                {formatGuaraniesGs(dayTotalIssued)}
              </div>
              <Text variant="muted" className="text-sm">
                {t("femme.billing.home.invoiceCount", { count: todayTotalElements })}
              </Text>
            </div>
            <Button
              type="button"
              variant="primary"
              size="lg"
              data-tour="billing-new-invoice"
              data-testid="billing-new-invoice"
              className="min-h-14 w-full text-base"
              onClick={onNewInvoice}
            >
              {t("femme.billing.session.newInvoiceButton")}
            </Button>
          </Card>

          <Card className="p-0">
            <button
              type="button"
              id="billing-today-toggle"
              data-testid="billing-today-toggle"
              aria-expanded={todayOpen}
              aria-controls="billing-today-list"
              onClick={() => setTodayOpen((o) => !o)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left sm:px-6"
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-heading text-base font-extrabold text-ink">
                  {t("femme.billing.session.todayInvoicesTitle")}
                </span>
                <span className="text-sm text-ink-3">{todayTotalElements}</span>
                {attentionCount > 0 && (
                  <span
                    data-testid="billing-attention-count"
                    className="rounded-full bg-danger-lt px-2.5 py-0.5 text-xs font-semibold text-danger"
                  >
                    {t("femme.billing.home.attentionCount", { count: attentionCount })}
                  </span>
                )}
              </span>
              <span aria-hidden className={`text-ink-3 transition-transform ${todayOpen ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>

            {todayOpen && (
              <div id="billing-today-list" className="border-t border-line px-2 pb-3 sm:px-4">
                {todayLoading ? (
                  <div className="flex items-center gap-2 p-3">
                    <Spinner size="sm" />
                    <Text>{t("femme.billing.session.loadingToday")}</Text>
                  </div>
                ) : todayTotalElements === 0 ? (
                  <Text variant="muted" className="p-3">
                    {t("femme.billing.session.emptyToday")}
                  </Text>
                ) : (
                  <>
                    {todayInvoices.some((inv) => inv.sifenSubmissionStatus === "REJECTED") && (
                      <Text variant="small" className="px-2 pt-3 text-ink-3">
                        {t("femme.billing.session.todayTotalExcludesRejected")}
                      </Text>
                    )}
                    <ul className="divide-y divide-line">
                      {todayInvoices.map((inv) => (
                        <li key={inv.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            data-testid={`billing-today-row-${inv.id}`}
                            aria-label={t("femme.billing.history.openDetail", {
                              invoiceNumber: inv.invoiceNumberFormatted,
                            })}
                            onClick={() => setSelectedInvoiceId(inv.id)}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedInvoiceId(inv.id);
                              }
                            }}
                            className="grid min-h-14 w-full cursor-pointer grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md px-2 py-3 text-left hover:bg-primary-lt"
                          >
                            <span className="min-w-0 truncate font-semibold text-ink">
                              {inv.clientDisplayName || t("femme.billing.invoice.noName")}
                            </span>
                            <span className="text-right font-bold tabular-nums text-ink">
                              {formatGuaraniesGs(inv.total)}
                            </span>
                            <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
                              <InvoiceStatePill invoice={inv} />
                              <span className="font-mono text-xs">{inv.invoiceNumberFormatted}</span>
                              <span>{paymentMethodsLabel(inv.paymentMethodsSummary, t)}</span>
                            </span>
                            {deriveInvoiceState(inv) === "attention" && inv.status === "ISSUED" && (
                              <span className="col-span-2 pt-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  data-testid={`today-row-correct-resend-${inv.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCorrectionInvoiceId(inv.id);
                                  }}
                                >
                                  {t("femme.billing.history.detail.sifen.correctResendButton")}
                                </Button>
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 px-2 pt-3"
                      data-testid="billing-today-pagination"
                    >
                      <PageSizeSelect
                        value={todayPageSize}
                        onChange={(s) => {
                          setTodayPageSize(s);
                          setTodayPageNum(0);
                        }}
                        label={t("femme.pagination.rowsPerPage")}
                      />
                      <Text variant="small" className="text-ink-3">
                        {t("femme.pagination.showingRange", {
                          from: todayShowingFrom,
                          to: todayShowingTo,
                          total: todayTotalElements,
                        })}
                      </Text>
                      <Pagination
                        page={todayPageNum + 1}
                        pageCount={todayTotalPages}
                        onPageChange={(p) => setTodayPageNum(p - 1)}
                        previousLabel={t("femme.pagination.previous")}
                        nextLabel={t("femme.pagination.next")}
                      />
                    </div>
                  </>
                )}
                <div className="border-t border-line px-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    data-tour="billing-history-link"
                    data-testid="billing-view-history"
                    className="text-primary"
                    onClick={() => onOpenHistory("invoices")}
                  >
                    {t("femme.billing.home.viewHistory")}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      ) : (
        <Card className="flex flex-col gap-4 p-4 sm:p-6">
          <Heading as="h2" className="text-lg">
            {t("femme.billing.home.closedTitle")}
          </Heading>
          <Text variant="muted">{t("femme.billing.noOpenSession")}</Text>
          <form
            id="billing-open-session"
            onSubmit={(e) => void handleOpenSession(e)}
            noValidate
            className="flex flex-col gap-3"
          >
            <div>
              <Label htmlFor="opening-amount">{t("femme.billing.openingCashAmount")}</Label>
              <Input
                id="opening-amount"
                inputMode="numeric"
                value={openingAmount}
                onChange={(e) => {
                  setOpeningAmount(maskMoneyInput(e.target.value));
                  setAmountError(null);
                  setOpenError(null);
                  setOpenSuccess(false);
                }}
                className="mt-1 w-full sm:max-w-xs"
                placeholder="0"
                aria-invalid={!!amountError}
                aria-describedby={amountError ? "amount-err" : "amount-hint"}
              />
              <FieldValidationError id="amount-err">{amountError}</FieldValidationError>
              <Text variant="small" id="amount-hint" className="mt-1 text-ink-3">
                {t("femme.billing.openingCashAmountHint")}
              </Text>
            </div>
            <Button type="submit" variant="primary" size="lg" className="min-h-14 w-full text-base" disabled={submitting}>
              {submitting ? t("femme.billing.opening") : t("femme.billing.open")}
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            data-testid="billing-view-history"
            className="self-center text-primary"
            onClick={() => onOpenHistory("invoices")}
          >
            {t("femme.billing.home.viewHistoryShort")}
          </Button>
        </Card>
      )}

      <Modal
        open={panelOpen}
        // While the movement form is on top, Escape belongs to it, not to the panel below.
        onClose={() => {
          if (panelView !== "movement") setPanelOpen(false);
        }}
        title={panelView === "close" ? t("femme.billing.close.title") : t("femme.billing.panel.title")}
      >
        {panelView !== "close" && (
          <div className="flex flex-col gap-4" data-testid="billing-cash-panel">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${currentSession ? "bg-success" : "bg-ink-3"}`}
              />
              <span className={currentSession ? "text-success" : "text-ink-2"}>
                {currentSession ? t("femme.billing.sessionOpen") : t("femme.billing.sessionClosed")}
              </span>
            </div>
            {currentSession ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                  <dt className="text-ink-3">{t("femme.billing.session.metricOpenedAt")}</dt>
                  <dd className="text-right font-semibold">
                    {formatParaguayDateTime(currentSession.openedAt, dateLocale)}
                  </dd>
                  <dt className="text-ink-3">{t("femme.billing.session.metricOpenedBy")}</dt>
                  <dd className="min-w-0 break-words text-right font-semibold">
                    {currentSession.openedByEmail}
                  </dd>
                  <dt className="text-ink-3">{t("femme.billing.session.metricOpeningAmount")}</dt>
                  <dd className="text-right font-semibold">
                    {formatGuaraniesGs(currentSession.openingCashAmount)}
                  </dd>
                </dl>
                {liveDetailError && (
                  <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                    {liveDetailError}
                  </Alert>
                )}
                {liveDetail && <CashSessionSummaryCard detail={liveDetail} />}
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12"
                    data-testid="billing-open-movement"
                    onClick={() => {
                      setMovementSubmitError(null);
                      setMovementSubmitSuccess(false);
                      setPanelView("movement");
                    }}
                  >
                    {t("femme.billing.movements.form.openButton")}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-12"
                    data-testid="billing-open-close-form"
                    onClick={() => setPanelView("close")}
                  >
                    {t("femme.billing.close.title")}
                  </Button>
                </div>
              </>
            ) : (
              <Text variant="muted">{t("femme.billing.noOpenSession")}</Text>
            )}
            <Button
              type="button"
              variant="ghost"
              data-testid="billing-view-cash-history"
              className="self-start text-primary"
              onClick={() => {
                setPanelOpen(false);
                onOpenHistory("cash");
              }}
            >
              {t("femme.billing.tabs.cashHistory")}
            </Button>
          </div>
        )}

        {panelView === "close" && currentSession && (
          <form onSubmit={(e) => void handleCloseSession(e)} noValidate className="flex flex-col gap-4">
            <Text variant="muted">{t("femme.billing.close.lead")}</Text>
            {closeError && (
              <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                {closeError}
              </Alert>
            )}
            <div>
              <Label htmlFor="counted-cash">{t("femme.billing.close.countedCashAmount")}</Label>
              <Input
                id="counted-cash"
                inputMode="numeric"
                value={countedCash}
                onChange={(e) => {
                  setCountedCash(maskMoneyInput(e.target.value));
                  setCountedCashError(null);
                }}
                placeholder="0"
                className="mt-1 w-full sm:max-w-xs"
                aria-invalid={!!countedCashError}
                aria-describedby={countedCashError ? "counted-cash-err" : "counted-cash-hint"}
              />
              <FieldValidationError id="counted-cash-err">{countedCashError}</FieldValidationError>
              <Text variant="small" id="counted-cash-hint" className="mt-1 text-ink-3">
                {t("femme.billing.close.countedCashAmountHint")}
              </Text>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="min-h-11" onClick={() => setPanelView("summary")}>
                {t("femme.billing.history.detail.voidCancel")}
              </Button>
              <Button type="submit" variant="primary" className="min-h-11" disabled={closing}>
                {closing ? t("femme.billing.close.closing") : t("femme.billing.close.confirmClose")}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={panelOpen && panelView === "movement" && !!currentSession}
        onClose={() => setPanelView("summary")}
        title={t("femme.billing.movements.form.title")}
      >
          <>
            {movementSubmitSuccess && (
              <Alert variant="success" className="mb-3 py-2">
                {t("femme.billing.movements.form.submitSuccess")}
              </Alert>
            )}
            {movementSubmitError && (
              <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                {movementSubmitError}
              </Alert>
            )}
            <form onSubmit={(e) => void handleCreateMovement(e)} noValidate className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={movementType === "MANUAL_IN" ? "primary" : "outline"}
                  aria-pressed={movementType === "MANUAL_IN"}
                  onClick={() => setMovementType("MANUAL_IN")}
                >
                  {t("femme.billing.movements.form.typeIngreso")}
                </Button>
                <Button
                  type="button"
                  variant={movementType === "MANUAL_OUT" ? "primary" : "outline"}
                  aria-pressed={movementType === "MANUAL_OUT"}
                  onClick={() => setMovementType("MANUAL_OUT")}
                >
                  {t("femme.billing.movements.form.typeEgreso")}
                </Button>
              </div>
              <div>
                <Label htmlFor="movement-amount">{t("femme.billing.movements.form.amountLabel")}</Label>
                <Input
                  id="movement-amount"
                  inputMode="numeric"
                  value={movementAmount}
                  onChange={(e) => {
                    setMovementAmount(maskMoneyInput(e.target.value));
                    setMovementAmountError(null);
                  }}
                  className="mt-1 w-full sm:max-w-xs"
                  placeholder="0"
                  aria-invalid={!!movementAmountError}
                  aria-describedby={movementAmountError ? "movement-amount-err" : "movement-amount-hint"}
                />
                <FieldValidationError id="movement-amount-err">{movementAmountError}</FieldValidationError>
                <Text variant="small" id="movement-amount-hint" className="mt-1 text-ink-3">
                  {t("femme.billing.movements.form.amountHint")}
                </Text>
              </div>
              <div>
                <Label htmlFor="movement-reason">{t("femme.billing.movements.form.reasonLabel")}</Label>
                <Input
                  id="movement-reason"
                  value={movementReason}
                  onChange={(e) => {
                    setMovementReason(e.target.value);
                    setMovementReasonError(null);
                  }}
                  className="mt-1 w-full"
                  maxLength={500}
                  aria-invalid={!!movementReasonError}
                  aria-describedby={movementReasonError ? "movement-reason-err" : "movement-reason-hint"}
                />
                <FieldValidationError id="movement-reason-err">{movementReasonError}</FieldValidationError>
                <Text variant="small" id="movement-reason-hint" className="mt-1 text-ink-3">
                  {t("femme.billing.movements.form.reasonHint")}
                </Text>
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => setPanelView("summary")}>
                  {t("femme.billing.movements.form.closeButton")}
                </Button>
                <Button type="submit" variant="primary" className="min-h-11" disabled={movementSubmitting}>
                  {movementSubmitting
                    ? t("femme.billing.movements.form.submitting")
                    : t("femme.billing.movements.form.submit")}
                </Button>
              </div>
            </form>
          </>
      </Modal>

      {correctionInvoiceId !== null && (
        <InvoiceCorrectionForm
          invoiceId={correctionInvoiceId}
          onClose={() => setCorrectionInvoiceId(null)}
          onResent={() => {
            setCorrectionInvoiceId(null);
            void loadTodayInvoices(todayPageNum, todayPageSize);
          }}
        />
      )}

      {selectedInvoiceId !== null && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          onVoided={() => {
            setSelectedInvoiceId(null);
            void loadTodayInvoices(todayPageNum, todayPageSize);
            onSessionChanged();
          }}
        />
      )}
    </div>
  );
}
