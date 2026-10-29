import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Spinner, Text } from "@design-system";
import { getCurrentSession as fetchCurrentSession, type CashSession } from "../api/cashSessions";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useTour } from "../tour/useTour";
import { billingSteps, registerBillingTabSwitcher } from "../tour/steps/billing";
import { BillingHome } from "./billing/BillingHome";
import { BillingHistory, type HistoryView } from "./billing/InvoiceHistory";
import {
  NewInvoiceFlow,
  type InitialClientForBilling,
  type PrefillServiceRecord,
} from "./billing/NewInvoiceFlow";

type BillingScreen = "home" | "invoice" | "history";
/** Names other screens (clients, fichas, tour) use to point at a billing screen. */
type NavTab = "session" | "invoice" | "history";

const SCREEN_BY_NAV_TAB: Record<NavTab, BillingScreen> = {
  session: "home",
  invoice: "invoice",
  history: "history",
};

export default function BillingPage() {
  const { t } = useTranslation();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("billing", billingSteps, undefined, guidedTourEnabled);
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as
    | {
        activeTab?: NavTab;
        selectedClient?: InitialClientForBilling;
        prefillServiceRecord?: PrefillServiceRecord;
      }
    | null;
  const [loading, setLoading] = useState(true);
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<BillingScreen>(
    navState?.activeTab ? SCREEN_BY_NAV_TAB[navState.activeTab] : "home",
  );
  const [historyView, setHistoryView] = useState<HistoryView>("invoices");
  const [invoiceListRefresh, setInvoiceListRefresh] = useState(0);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [cashHistoryRefresh, setCashHistoryRefresh] = useState(0);
  const [invoiceFormResetKey, setInvoiceFormResetKey] = useState(0);
  const [pendingInitialClient, setPendingInitialClient] = useState<InitialClientForBilling | null>(
    navState?.selectedClient ?? null,
  );
  const [pendingPrefillServiceRecord, setPendingPrefillServiceRecord] =
    useState<PrefillServiceRecord | null>(navState?.prefillServiceRecord ?? null);
  const firstLoadDone = useRef(false);

  useEffect(() => {
    if (navState && (navState.activeTab || navState.selectedClient || navState.prefillServiceRecord)) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openHistory = useCallback((view: HistoryView) => {
    setHistoryView(view);
    if (view === "invoices") setHistoryRefresh((k) => k + 1);
    else setCashHistoryRefresh((k) => k + 1);
    setScreen("history");
  }, []);

  useEffect(() => {
    registerBillingTabSwitcher((tab) => {
      if (tab === "history") openHistory("invoices");
      else setScreen(SCREEN_BY_NAV_TAB[tab]);
    });
    return () => registerBillingTabSwitcher(null);
  }, [openHistory]);

  const loadCurrentSession = useCallback(async () => {
    // Only the very first load blanks the page: a refresh after opening/closing the register
    // must not unmount the screen (it would drop the "register closed" summary).
    if (!firstLoadDone.current) setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCurrentSession();
      setCurrentSession(data ?? null);
    } catch {
      setLoadError(t("femme.billing.loadError"));
    } finally {
      firstLoadDone.current = true;
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCurrentSession();
  }, [loadCurrentSession]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.billing.loading")}</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {loadError}
        </Alert>
      )}

      <div hidden={screen !== "home"}>
        <BillingHome
          currentSession={currentSession}
          onSessionChanged={() => void loadCurrentSession()}
          onNewInvoice={() => {
            setInvoiceFormResetKey((k) => k + 1);
            setScreen("invoice");
          }}
          onOpenHistory={openHistory}
          refreshTrigger={invoiceListRefresh}
          isActive={screen === "home"}
        />
      </div>

      <div hidden={screen !== "invoice"}>
        {currentSession ? (
          <NewInvoiceFlow
            onIssued={() => setInvoiceListRefresh((k) => k + 1)}
            onBack={() => setScreen("home")}
            initialClient={pendingInitialClient}
            onInitialClientConsumed={() => setPendingInitialClient(null)}
            initialPrefillServiceRecord={pendingPrefillServiceRecord}
            onInitialPrefillConsumed={() => setPendingPrefillServiceRecord(null)}
            resetKey={invoiceFormResetKey}
          />
        ) : (
          <Text variant="muted">{t("femme.billing.noOpenSession")}</Text>
        )}
      </div>

      <div hidden={screen !== "history"}>
        <BillingHistory
          view={historyView}
          onViewChange={(v) => {
            setHistoryView(v);
            if (v === "invoices") setHistoryRefresh((k) => k + 1);
            else setCashHistoryRefresh((k) => k + 1);
          }}
          onBack={() => setScreen("home")}
          invoicesRefresh={historyRefresh}
          cashRefresh={cashHistoryRefresh}
          isActive={screen === "history"}
        />
      </div>
    </div>
  );
}
