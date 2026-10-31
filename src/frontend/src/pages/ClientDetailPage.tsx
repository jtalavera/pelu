import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  Input,
  Label,
  LocalityCombobox,
  Select,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  type Locality,
} from "@design-system";
import { femmeJson, femmePutJson, femmePostJson } from "../api/femmeClient";
import {
  listAppointments,
  listClientAppointmentHistory,
  type Appointment,
} from "../api/appointments";
import { listInvoicesPaged, type InvoiceListItem } from "../api/invoices";
import { translateApiError } from "../api/parseApiErrorMessage";
import { focusMessageBox } from "../util/focusMessageBox";
import { FieldValidationError } from "../components/FieldValidationError";
import {
  ClientProfileExtrasFields,
  EMPTY_PROFILE_EXTRAS,
  profileExtrasFromClient,
  profileExtrasPayload,
  validateProfileExtras,
  type ClientProfileExtras,
} from "../components/ClientProfileExtrasFields";
import { useClientSummary, type ClientSummary } from "../components/ClientSummary";
import { ClientTechnicalSheetForm } from "../components/ClientTechnicalSheetForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InvoiceDetailModal } from "../components/InvoiceDetailModal";
import { InvoiceStatePill } from "../components/InvoiceStatePill";
import { StatusBadge } from "../components/StatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { useLocalitySearch } from "../hooks/useLocalitySearch";
import { isBirthdayOn } from "../lib/clientBirthday";
import { formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayPhone, isCompleteParaguayPhone, toWhatsAppPhone } from "../lib/paraguayPhone";
import { buildWhatsAppUrl, isMobileDevice, WHATSAPP_WINDOW_NAME } from "../lib/whatsappShare";
import { isValidEmail } from "../lib/validateEmail";
import { validateRuc } from "../lib/validateRuc";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useTour } from "../tour/useTour";
import { clientDetailSteps } from "../tour/steps/clientDetail";

type Client = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
  active: boolean;
  visitCount: number;
  address?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
  identityDocumentNumber?: string | null;
  identityDocumentType?: string | null;
  taxpayerType?: string | null;
  birthdayDay?: number | null;
  birthdayMonth?: number | null;
  birthdayYear?: number | null;
  acquisitionChannel?: string | null;
  acquisitionChannelOther?: string | null;
};

const IDENTITY_DOCUMENT_TYPE_OPTIONS = [
  { value: "RUC", labelKey: "femme.clients.identityDocumentTypeRuc" },
  { value: "CEDULA_PARAGUAYA", labelKey: "femme.clients.identityDocumentTypeCedulaParaguaya" },
  { value: "PASAPORTE", labelKey: "femme.clients.identityDocumentTypePasaporte" },
  { value: "CEDULA_EXTRANJERA", labelKey: "femme.clients.identityDocumentTypeCedulaExtranjera" },
  { value: "CARNET_RESIDENCIA", labelKey: "femme.clients.identityDocumentTypeCarnetResidencia" },
  { value: "TARJETA_DIPLOMATICA", labelKey: "femme.clients.identityDocumentTypeTarjetaDiplomatica" },
  { value: "OTRO", labelKey: "femme.clients.identityDocumentTypeOtro" },
  { value: "INNOMINADO", labelKey: "femme.clients.identityDocumentTypeInnominado" },
] as const;

/** Client tabs: "data" is the default and not written to the URL. */
const CLIENT_TABS = ["data", "appointments", "invoices", "sheet", "radiography"] as const;
type ClientTab = (typeof CLIENT_TABS)[number];
/** ≥44 px touch targets on phones (the design-system trigger is shorter). */
const TAB_TRIGGER_CLASS = "min-h-11 shrink-0 whitespace-nowrap sm:min-h-0";
const HISTORY_PAGE_SIZE = 10;

/** Same legacy derivation the backend uses (ClientIdentityDocumentType.resolve). */
function resolveIdentityDocumentTypeAndNumber(client: Client): { type: string; number: string } {
  if (client.identityDocumentType) {
    const number =
      client.identityDocumentType === "RUC"
        ? (client.ruc ?? "")
        : (client.identityDocumentNumber ?? "");
    return { type: client.identityDocumentType, number };
  }
  if (client.ruc) return { type: "RUC", number: client.ruc };
  if (client.identityDocumentNumber) {
    return { type: "CEDULA_PARAGUAYA", number: client.identityDocumentNumber };
  }
  return { type: "RUC", number: "" };
}

function localityFromClient(c: Client): Locality | null {
  if (!c.departmentCode || !c.departmentName || !c.cityCode || !c.cityName) return null;
  return {
    departmentCode: c.departmentCode,
    departmentName: c.departmentName,
    cityCode: c.cityCode,
    cityName: c.cityName,
  };
}

function formatShortDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatLongDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function Disclosure({
  id,
  label,
  open,
  onToggle,
  testId,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testId} className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        data-testid={`${testId}-toggle`}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between py-2 text-left font-semibold text-ink"
      >
        {label}
        <span aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {open ? (
        <div id={id} className="flex flex-col gap-4 pb-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function RankBars({
  rows,
  tone,
  testId,
}: {
  rows: Array<{ key: string; label: string; value: number; display: string }>;
  tone: "orange" | "primary";
  testId: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3" data-testid={testId} role="list">
      {rows.map((r) => (
        <li key={r.key} data-testid={`${testId}-item`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
          <span className="break-words font-semibold text-ink">{r.label}</span>
          <span className="text-sm font-semibold text-ink-3">{r.display}</span>
          <span className="col-span-2 h-2.5 overflow-hidden rounded-full bg-primary-lt">
            <span
              className={`block h-full rounded-full ${
                tone === "orange" ? "bg-gradient-to-r from-[#F3A66B] to-[#E0783A]" : "bg-primary"
              }`}
              style={{ width: `${Math.round((r.value / max) * 100)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Client "radiography": spend, most-used services, usual professionals and the latest services. */
function ClientRadiography({
  client,
  summaryState,
  locale,
}: {
  client: Client;
  summaryState: { summary: ClientSummary | null; error: string | null };
  locale: string;
}) {
  const { t } = useTranslation();
  const { summary, error } = summaryState;
  if (error) {
    return (
      <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
        {error}
      </Alert>
    );
  }
  if (!summary) {
    return (
      <div className="flex items-center justify-center gap-2 py-6">
        <Spinner size="md" />
        <Text>{t("femme.clients.loading")}</Text>
      </div>
    );
  }
  const firstName = client.fullName.trim().split(/\s+/)[0];
  const totalPro = summary.professionalRanking.reduce((acc, p) => acc + p.serviceCount, 0);
  const empty = summary.topServices.length === 0 && summary.lastServices.length === 0;
  const stat = (label: string, value: string, id: string) => (
    <div data-testid={id} className="flex flex-col gap-0.5 rounded-xl bg-primary-lt p-3">
      <b className="font-heading text-xl font-extrabold text-ink">{value}</b>
      <span className="text-xs text-ink-2">{label}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="client-radiography">
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <Heading as="h2" className="text-base">
          {t("femme.clients.radiography.title", { name: firstName })}
        </Heading>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stat(t("femme.clients.radiography.visits"), String(client.visitCount), "client-radiography-visits")}
          {stat(
            t("femme.clients.radiography.spent"),
            `Gs. ${formatAmountDecimal(summary.spentLast12Months ?? 0)}`,
            "client-radiography-spent",
          )}
          {stat(
            t("femme.clients.radiography.ticket"),
            `Gs. ${formatAmountDecimal(summary.averageTicketLast12Months ?? 0)}`,
            "client-radiography-ticket",
          )}
        </div>
      </Card>

      {empty ? (
        <Card className="p-4">
          <Text variant="muted" data-testid="client-radiography-empty">
            {t("femme.clients.radiography.empty")}
          </Text>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3 p-4 sm:p-5">
            <Heading as="h2" className="text-base">
              {t("femme.clients.radiography.topServices")}
            </Heading>
            <RankBars
              testId="client-radiography-services"
              tone="orange"
              rows={summary.topServices.map((s) => ({
                key: s.serviceName,
                label: s.serviceName,
                value: s.count,
                display: t("femme.clients.radiography.times", { count: s.count }),
              }))}
            />
          </Card>

          <Card className="flex flex-col gap-3 p-4 sm:p-5">
            <Heading as="h2" className="text-base">
              {t("femme.clients.radiography.professionals")}
            </Heading>
            <RankBars
              testId="client-radiography-professionals"
              tone="primary"
              rows={summary.professionalRanking.map((p) => ({
                key: String(p.id),
                label: p.fullName,
                value: p.serviceCount,
                display: `${Math.round((p.serviceCount / Math.max(1, totalPro)) * 100)}%`,
              }))}
            />
          </Card>

          <Card className="flex flex-col gap-1 p-4 sm:p-5">
            <Heading as="h2" className="mb-2 text-base">
              {t("femme.clients.radiography.lastServices")}
            </Heading>
            <ul className="flex flex-col" role="list" data-testid="client-radiography-last">
              {summary.lastServices.map((s, i) => (
                <li
                  key={`${s.performedAt}-${i}`}
                  className="flex items-start gap-3 border-t border-line py-3 first:border-t-0"
                >
                  <div className="w-16 shrink-0 font-semibold text-ink">
                    {formatShortDate(s.performedAt, locale)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">{s.serviceName}</div>
                    {s.professionalName ? (
                      <div className="text-sm text-ink-3">{s.professionalName}</div>
                    ) : null}
                  </div>
                  <div className="shrink-0 font-semibold text-ink">Gs. {formatAmountDecimal(s.price)}</div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

export default function ClientDetailPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("client-detail", clientDetailSteps, undefined, guidedTourEnabled);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [client, setClient] = useState<Client | null>(null);

  // The active tab lives in the URL (?tab=…); no / unknown value = "Datos".
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = CLIENT_TABS.includes(tabParam as ClientTab) ? (tabParam as ClientTab) : "data";
  const setTab = (next: string) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "data") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: false },
    );
  };

  // Edit form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [identityDocumentType, setIdentityDocumentType] = useState("RUC");
  const [identityDocumentNumber, setIdentityDocumentNumber] = useState("");
  const [taxpayerType, setTaxpayerType] = useState("PERSONA_FISICA");
  const [address, setAddress] = useState("");
  const [locality, setLocality] = useState<Locality | null>(null);
  const [extras, setExtras] = useState<ClientProfileExtras>(EMPTY_PROFILE_EXTRAS);
  const [openSection, setOpenSection] = useState<"fiscal" | "profile" | null>(null);
  const localitySearch = useLocalitySearch();
  const [fieldError, setFieldError] = useState<{
    fullName?: string;
    identityDocumentNumber?: string;
    phone?: string;
    email?: string;
    birthday?: string;
    acquisitionOther?: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveMessagesRef = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);

  const [deactivating, setDeactivating] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Client | null>(null);
  const [reactivating, setReactivating] = useState(false);

  // Appointments and invoices load only once their tab is opened.
  const [apptsLoading, setApptsLoading] = useState(false);
  const [apptsError, setApptsError] = useState<string | null>(null);
  const [apptsLoaded, setApptsLoaded] = useState(false);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [pastAppts, setPastAppts] = useState<Appointment[]>([]);
  const [pastPage, setPastPage] = useState(0);
  const [pastTotalPages, setPastTotalPages] = useState(0);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);
  const [invLoaded, setInvLoaded] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [invoicePage, setInvoicePage] = useState(0);
  const [invoiceTotalPages, setInvoiceTotalPages] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await femmeJson<Client>(`/api/clients/${id ?? ""}`);
      setClient(data);
      setFullName(data.fullName);
      setPhone(data.phone ?? "");
      setEmail(data.email ?? "");
      const resolved = resolveIdentityDocumentTypeAndNumber(data);
      setIdentityDocumentType(resolved.type);
      setIdentityDocumentNumber(resolved.number);
      setTaxpayerType(data.taxpayerType ?? "PERSONA_FISICA");
      setAddress(data.address ?? "");
      setLocality(localityFromClient(data));
      setExtras(profileExtrasFromClient(data));
    } catch {
      setLoadError(t("femme.clients.profileLoadError"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const clientIdNum = id ? Number(id) : NaN;
  const summaryState = useClientSummary(clientIdNum);

  useEffect(() => {
    if (tab !== "appointments" || apptsLoaded || !id || Number.isNaN(clientIdNum)) return;
    let cancelled = false;
    (async () => {
      setApptsLoading(true);
      setApptsError(null);
      const now = new Date();
      const futureEnd = new Date(now);
      futureEnd.setMonth(futureEnd.getMonth() + 6);
      futureEnd.setHours(23, 59, 59, 999);
      try {
        const [next, past] = await Promise.all([
          listAppointments(now.toISOString(), futureEnd.toISOString(), null, clientIdNum),
          listClientAppointmentHistory(clientIdNum, 0, HISTORY_PAGE_SIZE),
        ]);
        if (cancelled) return;
        setUpcoming(next);
        setPastAppts(past.content);
        setPastPage(0);
        setPastTotalPages(past.totalPages);
        setApptsLoaded(true);
      } catch (e) {
        if (!cancelled) setApptsError(translateApiError(e, t, "femme.clients.historyLoadError"));
      } finally {
        if (!cancelled) setApptsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, apptsLoaded, id, clientIdNum, t]);

  useEffect(() => {
    if (tab !== "invoices" || invLoaded || !id || Number.isNaN(clientIdNum)) return;
    let cancelled = false;
    (async () => {
      setInvLoading(true);
      setInvError(null);
      try {
        const inv = await listInvoicesPaged({ clientId: clientIdNum, page: 0, size: HISTORY_PAGE_SIZE });
        if (cancelled) return;
        setInvoices(inv.content);
        setInvoicePage(0);
        setInvoiceTotalPages(inv.totalPages);
        setInvLoaded(true);
      } catch (e) {
        if (!cancelled) setInvError(translateApiError(e, t, "femme.clients.historyLoadError"));
      } finally {
        if (!cancelled) setInvLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, invLoaded, id, clientIdNum, t]);

  async function loadMorePastAppointments() {
    setLoadingMore(true);
    try {
      const past = await listClientAppointmentHistory(clientIdNum, pastPage + 1, HISTORY_PAGE_SIZE);
      setPastAppts((prev) => [...prev, ...past.content]);
      setPastPage(pastPage + 1);
      setPastTotalPages(past.totalPages);
    } catch (e) {
      setApptsError(translateApiError(e, t, "femme.clients.historyLoadError"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMoreInvoices() {
    setLoadingMore(true);
    try {
      const inv = await listInvoicesPaged({
        clientId: clientIdNum,
        page: invoicePage + 1,
        size: HISTORY_PAGE_SIZE,
      });
      setInvoices((prev) => [...prev, ...inv.content]);
      setInvoicePage(invoicePage + 1);
      setInvoiceTotalPages(inv.totalPages);
    } catch (e) {
      setInvError(translateApiError(e, t, "femme.clients.historyLoadError"));
    } finally {
      setLoadingMore(false);
    }
  }

  const nextAppointment = useMemo(
    () =>
      [...upcoming].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())[0] ??
      null,
    [upcoming],
  );

  const pastSorted = useMemo(
    () => [...pastAppts].sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()),
    [pastAppts],
  );

  /** Desktop opens WhatsApp Web directly (no "app or web" chooser), reusing one tab; phones open the app. */
  function openWhatsApp(phone: string | null) {
    const wa = toWhatsAppPhone(phone);
    if (!wa) return;
    const mobile = isMobileDevice();
    window.open(
      buildWhatsAppUrl(wa, "", mobile),
      mobile ? "_blank" : WHATSAPP_WINDOW_NAME,
      mobile ? "noopener,noreferrer" : undefined,
    );
  }

  useEffect(() => {
    if (saveError) focusMessageBox(saveMessagesRef.current);
  }, [saveError]);

  async function saveClient() {
    setFieldError(null);
    setSaveError(null);
    const nextErr: NonNullable<typeof fieldError> = {};

    if (!fullName.trim()) {
      nextErr.fullName = t("femme.clients.fullNameRequired");
    }
    const isRucType = identityDocumentType === "RUC";
    const isInnominado = identityDocumentType === "INNOMINADO";
    const documentNumberTrim = isInnominado ? "" : identityDocumentNumber.trim();
    if (isRucType && documentNumberTrim && !validateRuc(documentNumberTrim)) {
      nextErr.identityDocumentNumber = t("femme.clients.rucInvalid");
    }
    if (phone.trim() && !isCompleteParaguayPhone(phone.trim())) {
      nextErr.phone = t("femme.clients.phoneInvalid");
    }
    if (email.trim() && !isValidEmail(email.trim())) {
      nextErr.email = t("femme.clients.emailInvalid");
    }
    const extrasErr = validateProfileExtras(extras, t);
    if (extrasErr.birthday) nextErr.birthday = extrasErr.birthday;
    if (extrasErr.other) nextErr.acquisitionOther = extrasErr.other;
    if (Object.keys(nextErr).length > 0) {
      setFieldError(nextErr);
      if (nextErr.identityDocumentNumber) setOpenSection("fiscal");
      else if (nextErr.birthday || nextErr.acquisitionOther) setOpenSection("profile");
      return;
    }

    setSaving(true);
    try {
      await femmePutJson<Client>(`/api/clients/${id ?? ""}`, {
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        ruc: isRucType ? documentNumberTrim || null : null,
        identityDocumentNumber: !isRucType && !isInnominado ? documentNumberTrim || null : null,
        identityDocumentType: documentNumberTrim ? identityDocumentType : null,
        taxpayerType: isRucType ? taxpayerType : null,
        address: address.trim() || null,
        departmentCode: locality?.departmentCode ?? null,
        departmentName: locality?.departmentName ?? null,
        cityCode: locality?.cityCode ?? null,
        cityName: locality?.cityName ?? null,
        ...profileExtrasPayload(extras),
      });
      // Saving closes the form: the list shows the success notice.
      navigate("/app/clients", { state: { notice: "updated" } });
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget || !id) return;
    setDeactivating(true);
    setSaveError(null);
    try {
      await femmePostJson<Client>(`/api/clients/${id}/deactivate`, {});
      setDeactivateTarget(null);
      navigate("/app/clients", { state: { notice: "deactivated" } });
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
      setDeactivateTarget(null);
    } finally {
      setDeactivating(false);
    }
  }

  async function activateClient() {
    if (!client || !id) return;
    setReactivating(true);
    setSaveError(null);
    try {
      await femmePostJson<Client>(`/api/clients/${id}/activate`, {});
      navigate("/app/clients", { state: { notice: "activated" } });
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setReactivating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.clients.loading")}</Text>
      </div>
    );
  }

  if (loadError || !client) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate("/app/clients")}
          className="self-start"
        >
          ← {t("femme.clients.backToList")}
        </Button>
        <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
          {loadError ?? t("femme.clients.profileLoadError")}
        </Alert>
      </div>
    );
  }

  const { summary } = summaryState;
  const usual = summary?.usualProfessionals?.[0] ?? null;
  const spent = summary?.spentLast12Months;
  const phoneDigits = client.phone ? client.phone.replace(/[^\d+]/g, "") : "";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div data-tour="client-detail-header">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate("/app/clients")}
          className="min-h-11 self-start"
        >
          ← {t("femme.clients.backToList")}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading as="h1">{client.fullName}</Heading>
          {!client.active ? <Badge variant="secondary">{t("femme.clients.inactive")}</Badge> : null}
          {isBirthdayOn(client.birthdayDay ?? null, client.birthdayMonth ?? null, new Date()) ? (
            <Badge data-testid="client-birthday-today">{t("femme.clients.birthday.today")}</Badge>
          ) : null}
        </div>
        <Text variant="muted" data-testid="client-header-facts" className="flex flex-wrap gap-x-3">
          <span>{t("femme.clients.visits", { count: client.visitCount })}</span>
          {summary?.lastVisitAt ? (
            <span>
              {t("femme.clients.lastVisit", { date: formatLongDate(summary.lastVisitAt, dateLocale) })}
            </span>
          ) : null}
          {spent != null && Number(spent) > 0 ? (
            <span>{t("femme.clients.spent12m", { amount: `Gs. ${formatAmountDecimal(spent)}` })}</span>
          ) : null}
          {usual ? <span>{t("femme.clients.usualProfessional", { name: usual.fullName })}</span> : null}
        </Text>
        <div className="flex flex-wrap gap-2" data-testid="client-contact-actions">
          {client.phone ? (
            <a
              href={`tel:${phoneDigits}`}
              aria-label={t("femme.clients.keyInfo.call", { phone: client.phone })}
              data-testid="client-call"
              className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-bg"
            >
              📞 {t("femme.clients.call")}
            </a>
          ) : null}
          {toWhatsAppPhone(client.phone) ? (
            <button
              type="button"
              data-testid="client-whatsapp"
              onClick={() => openWhatsApp(client.phone)}
              className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-bg"
            >
              {t("femme.clients.whatsapp")}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="client-radiography-cta"
            onClick={() => setTab("radiography")}
            className="inline-flex min-h-11 items-center rounded-md bg-gradient-to-br from-[#F3A66B] to-[#E0783A] px-4 text-sm font-extrabold text-white hover:opacity-90"
          >
            ✦ {t("femme.clients.radiography.cta")}
          </button>
        </div>
      </div>

      <Tabs data-tour="client-detail-tabs" value={tab} onValueChange={setTab}>
        <TabsList className="w-full overflow-x-auto">
          <TabsTrigger value="data" className={TAB_TRIGGER_CLASS}>
            {t("femme.clients.tabs.data")}
          </TabsTrigger>
          <TabsTrigger value="appointments" className={TAB_TRIGGER_CLASS}>
            {t("femme.clients.tabs.appointments")}
          </TabsTrigger>
          <TabsTrigger value="invoices" className={TAB_TRIGGER_CLASS}>
            {t("femme.clients.tabs.invoices")}
          </TabsTrigger>
          <TabsTrigger value="sheet" className={TAB_TRIGGER_CLASS}>
            {t("femme.clients.tabs.sheet")}
          </TabsTrigger>
          <TabsTrigger
            value="radiography"
            className={`${TAB_TRIGGER_CLASS} font-extrabold text-[#7A3E00] data-[state=active]:bg-gradient-to-br data-[state=active]:from-[#F3A66B] data-[state=active]:to-[#E0783A] data-[state=active]:text-white`}
            data-testid="client-tab-radiography"
          >
            ✦ {t("femme.clients.tabs.radiography")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="appointments">
          <div className="flex flex-col gap-4">
            {apptsError ? (
              <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
                {apptsError}
              </Alert>
            ) : null}
            {apptsLoading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Spinner size="md" />
                <Text>{t("femme.clients.loading")}</Text>
              </div>
            ) : null}
            {apptsLoaded && !apptsError ? (
              <>
                <Card className="p-4" data-testid="client-next-appointment">
                  <Heading as="h2" className="mb-3 text-base">
                    {t("femme.clients.nextAppointment")}
                  </Heading>
                  {nextAppointment ? (
                    <div className="flex items-start gap-3">
                      <div className="w-16 shrink-0 font-semibold text-ink">
                        {formatShortDate(nextAppointment.startAt, dateLocale)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-ink">{nextAppointment.serviceName}</div>
                        <div className="text-sm text-ink-3">
                          {formatTime(nextAppointment.startAt, dateLocale)} ·{" "}
                          {nextAppointment.professionalName}
                        </div>
                      </div>
                      <StatusBadge status={nextAppointment.status} />
                    </div>
                  ) : (
                    <Text variant="muted">{t("femme.clients.noNextAppointment")}</Text>
                  )}
                </Card>

                <Card className="p-4" data-testid="client-past-appointments">
                  <Heading as="h2" className="mb-3 text-base">
                    {t("femme.clients.pastAppointments")}
                  </Heading>
                  {pastSorted.length === 0 ? (
                    <Text variant="muted" data-testid="client-appointments-empty">
                      {t("femme.clients.noAppointments")}
                    </Text>
                  ) : (
                    <ul className="flex flex-col" role="list">
                      {pastSorted.map((appt) => (
                        <li
                          key={appt.id}
                          data-testid="client-appointment-item"
                          className="flex items-start gap-3 border-t border-line py-3 first:border-t-0"
                        >
                          <div className="w-16 shrink-0 font-semibold text-ink">
                            {formatShortDate(appt.startAt, dateLocale)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-ink">{appt.serviceName}</div>
                            <div className="text-sm text-ink-3">{appt.professionalName}</div>
                          </div>
                          <StatusBadge status={appt.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {pastPage + 1 < pastTotalPages ? (
                    <div className="mt-3 flex justify-center">
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11"
                        disabled={loadingMore}
                        data-testid="client-appointments-more"
                        onClick={() => void loadMorePastAppointments()}
                      >
                        {loadingMore ? t("femme.clients.loading") : t("femme.clients.historyMore")}
                      </Button>
                    </div>
                  ) : null}
                </Card>
              </>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="invoices">
          <div className="flex flex-col gap-4">
            {invError ? (
              <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
                {invError}
              </Alert>
            ) : null}
            {invLoading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Spinner size="md" />
                <Text>{t("femme.clients.loading")}</Text>
              </div>
            ) : null}
            {invLoaded && !invError ? (
              <Card className="p-4" data-testid="client-invoices">
                <Heading as="h2" className="mb-3 text-base">
                  {t("femme.clients.invoices")}
                </Heading>
                {invoices.length === 0 ? (
                  <Text variant="muted" data-testid="client-invoices-empty">
                    {t("femme.clients.noInvoices")}
                  </Text>
                ) : (
                  <ul className="flex flex-col" role="list">
                    {invoices.map((inv) => (
                      <li
                        key={inv.id}
                        data-testid="client-invoice-item"
                        className="flex items-start gap-3 border-t border-line py-3 first:border-t-0"
                      >
                        <div className="w-16 shrink-0 font-semibold text-ink">
                          {formatShortDate(inv.issuedAt, dateLocale)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setSelectedInvoiceId(inv.id)}
                            aria-label={t("femme.clients.openInvoice", {
                              number: inv.invoiceNumberFormatted,
                            })}
                            className="min-h-11 text-left font-semibold text-ink"
                          >
                            #{inv.invoiceNumberFormatted}
                          </button>
                          <div>
                            <InvoiceStatePill invoice={inv} />
                          </div>
                        </div>
                        <div className="shrink-0 pt-2 font-semibold text-ink">
                          Gs. {formatAmountDecimal(inv.total)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {invoicePage + 1 < invoiceTotalPages ? (
                  <div className="mt-3 flex justify-center">
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      disabled={loadingMore}
                      data-testid="client-invoices-more"
                      onClick={() => void loadMoreInvoices()}
                    >
                      {loadingMore ? t("femme.clients.loading") : t("femme.clients.historyMore")}
                    </Button>
                  </div>
                ) : null}
              </Card>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="radiography">
          <ClientRadiography client={client} summaryState={summaryState} locale={dateLocale} />
        </TabsContent>

        {/* HU-68 AC5: technical sheet, saved independently of the basic data form. */}
        <TabsContent value="sheet">
          <Card className="p-4 sm:p-6">
            <Heading as="h2" className="mb-3 text-base">
              {t("femme.clients.technicalSheet.title")}
            </Heading>
            <ClientTechnicalSheetForm clientId={client.id} />
          </Card>
        </TabsContent>

        <TabsContent value="data">
          <Card data-tour="client-detail-edit" className="p-4 sm:p-6">
            <div ref={saveMessagesRef} tabIndex={-1} className="outline-none">
              {saveError ? (
                <Alert variant="destructive" title={t("femme.clients.errorTitle")} className="mb-4">
                  {saveError}
                </Alert>
              ) : null}
            </div>

            <div className="flex flex-col gap-4">
              <div data-testid="client-section-contact" className="flex flex-col gap-4">
                <div>
                  <Label htmlFor="detail-fullname">{t("femme.clients.fullName")}</Label>
                  <Input
                    id="detail-fullname"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    aria-invalid={fieldError?.fullName ? "true" : "false"}
                    aria-describedby={fieldError?.fullName ? "detail-fullname-err" : undefined}
                  />
                  <FieldValidationError id="detail-fullname-err">
                    {fieldError?.fullName}
                  </FieldValidationError>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="detail-phone">{t("femme.clients.phone")}</Label>
                    <Input
                      id="detail-phone"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(formatParaguayPhone(e.target.value));
                        setFieldError((prev) => (prev ? { ...prev, phone: undefined } : prev));
                      }}
                      onBlur={() => {
                        const trimmed = phone.trim();
                        if (trimmed && !isCompleteParaguayPhone(trimmed)) {
                          setFieldError((prev) => ({
                            ...(prev ?? {}),
                            phone: t("femme.clients.phoneInvalid"),
                          }));
                        }
                      }}
                      placeholder={t("femme.clients.phonePlaceholder")}
                      aria-invalid={fieldError?.phone ? "true" : "false"}
                      aria-describedby={fieldError?.phone ? "detail-phone-err" : undefined}
                    />
                    <FieldValidationError id="detail-phone-err">
                      {fieldError?.phone}
                    </FieldValidationError>
                  </div>

                  <div>
                    <Label htmlFor="detail-email">{t("femme.clients.email")}</Label>
                    <Input
                      id="detail-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setFieldError((prev) => (prev ? { ...prev, email: undefined } : prev));
                      }}
                      onBlur={() => {
                        const trimmed = email.trim();
                        if (trimmed && !isValidEmail(trimmed)) {
                          setFieldError((prev) => ({
                            ...(prev ?? {}),
                            email: t("femme.clients.emailInvalid"),
                          }));
                        }
                      }}
                      placeholder={t("femme.clients.emailPlaceholder")}
                      aria-invalid={fieldError?.email ? "true" : "false"}
                      aria-describedby={fieldError?.email ? "detail-email-err" : undefined}
                    />
                    <FieldValidationError id="detail-email-err">
                      {fieldError?.email}
                    </FieldValidationError>
                  </div>
                </div>
              </div>

              <div>
                <Disclosure
                  id="detail-fiscal-body"
                  testId="client-section-fiscal"
                  label={t("femme.clients.sections.fiscal")}
                  open={openSection === "fiscal"}
                  onToggle={() => setOpenSection(openSection === "fiscal" ? null : "fiscal")}
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="detail-identity-document-type">
                        {t("femme.clients.identityDocumentType")}
                      </Label>
                      <Select
                        id="detail-identity-document-type"
                        value={identityDocumentType}
                        onChange={(e) => setIdentityDocumentType(e.target.value)}
                      >
                        {IDENTITY_DOCUMENT_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                          </option>
                        ))}
                      </Select>
                    </div>

                    {identityDocumentType === "RUC" && (
                      <div>
                        <Label htmlFor="detail-taxpayer-type">
                          {t("femme.clients.taxpayerType")}
                        </Label>
                        <Select
                          id="detail-taxpayer-type"
                          value={taxpayerType}
                          onChange={(e) => setTaxpayerType(e.target.value)}
                        >
                          <option value="PERSONA_FISICA">
                            {t("femme.clients.taxpayerTypePersonaFisica")}
                          </option>
                          <option value="PERSONA_JURIDICA">
                            {t("femme.clients.taxpayerTypePersonaJuridica")}
                          </option>
                        </Select>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="detail-identity-document-number">
                        {t("femme.clients.identityDocumentNumber")}
                      </Label>
                      <Input
                        id="detail-identity-document-number"
                        value={identityDocumentNumber}
                        onChange={(e) => setIdentityDocumentNumber(e.target.value)}
                        placeholder={t("femme.clients.identityDocumentNumberPlaceholder")}
                        disabled={identityDocumentType === "INNOMINADO"}
                        aria-invalid={fieldError?.identityDocumentNumber ? "true" : "false"}
                        aria-describedby={
                          fieldError?.identityDocumentNumber
                            ? "detail-identity-document-number-err"
                            : undefined
                        }
                      />
                      {identityDocumentType === "RUC" && (
                        <Text variant="muted" className="mt-1 text-sm">
                          {t("femme.clients.rucHint")}
                        </Text>
                      )}
                      <FieldValidationError id="detail-identity-document-number-err">
                        {fieldError?.identityDocumentNumber}
                      </FieldValidationError>
                    </div>

                    <div className="md:col-span-2">
                      <Label htmlFor="detail-address">{t("femme.clients.address")}</Label>
                      <Input
                        id="detail-address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={t("femme.clients.addressPlaceholder")}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <Label htmlFor="detail-locality">{t("femme.clients.locality")}</Label>
                      <LocalityCombobox
                        id="detail-locality"
                        value={locality}
                        onChange={setLocality}
                        onSearch={localitySearch.search}
                        options={localitySearch.options}
                        loading={localitySearch.loading}
                        placeholder={t("femme.clients.localityPlaceholder")}
                        noResultsLabel={t("femme.clients.localityNoResults")}
                      />
                      <Text variant="muted" className="mt-1 text-sm">
                        {t("femme.clients.localityHint")}
                      </Text>
                    </div>
                  </div>
                </Disclosure>

                <Disclosure
                  id="detail-profile-body"
                  testId="client-section-profile"
                  label={t("femme.clients.sections.profile")}
                  open={openSection === "profile"}
                  onToggle={() => setOpenSection(openSection === "profile" ? null : "profile")}
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <ClientProfileExtrasFields
                      idPrefix="detail"
                      alignColumns
                      value={extras}
                      onChange={setExtras}
                      birthdayError={fieldError?.birthday}
                      otherError={fieldError?.acquisitionOther}
                    />
                  </div>
                </Disclosure>
              </div>

              <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate("/app/clients")}
                  disabled={saving}
                  className="min-h-11"
                  data-testid="client-edit-cancel"
                >
                  {t("femme.clients.cancel")}
                </Button>
                <Button
                  type="button"
                  onClick={() => void saveClient()}
                  disabled={saving || !client.active}
                  className="min-h-11"
                >
                  {saving ? t("femme.clients.saving") : t("femme.clients.save")}
                </Button>
              </div>

              <div data-tour="client-detail-status" className="flex justify-center">
                {client.active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDeactivateTarget(client)}
                    disabled={deactivating}
                    className="min-h-11 text-danger hover:bg-danger/10"
                    data-testid="client-edit-deactivate"
                  >
                    {t("femme.clients.deactivateClient")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void activateClient()}
                    disabled={reactivating}
                    className="min-h-11"
                    data-testid="client-edit-reactivate"
                  >
                    {reactivating ? t("femme.clients.reactivating") : t("femme.clients.reactivateClient")}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {deactivateTarget ? (
        <ConfirmDialog
          open
          title={t("femme.clients.deactivateDialogTitle")}
          description={t("femme.clients.deactivateDialogDescription", {
            name: deactivateTarget.fullName,
          })}
          cancelLabel={t("femme.clients.cancel")}
          confirmLabel={t("femme.clients.deactivate")}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={() => void confirmDeactivate()}
        />
      ) : null}

      {selectedInvoiceId !== null && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          allowVoid={false}
        />
      )}
    </div>
  );
}
