import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  PageSizeSelect,
  Pagination,
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
  type PageResponse,
} from "../api/appointments";
import { listInvoicesPaged, type PagedInvoicesResponse } from "../api/invoices";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InvoiceDetailModal } from "../components/InvoiceDetailModal";
import { SifenStatusBadge } from "../components/SifenStatusBadge";
import { StatusBadge } from "../components/StatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { useLocalitySearch } from "../hooks/useLocalitySearch";
import { formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayPhone, isCompleteParaguayPhone } from "../lib/paraguayPhone";
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

function formatHistoryDateTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}


function HistoryInvoiceStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  let bg = "var(--color-warning-lt)";
  let color = "var(--color-warning)";
  let label = t("femme.billing.session.statusPending");
  if (status === "ISSUED") {
    bg = "var(--color-success-lt)";
    color = "var(--color-success)";
    label = t("femme.billing.session.statusIssued");
  } else if (status === "VOIDED") {
    bg = "var(--color-danger-lt)";
    color = "var(--color-danger)";
    label = t("femme.billing.session.statusVoided");
  }
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        display: "inline-block",
        whiteSpace: "nowrap",
        background: bg,
        color,
      }}
    >
      {label}
    </span>
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

  const [tab, setTab] = useState("info");

  // Edit form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [identityDocumentType, setIdentityDocumentType] = useState("RUC");
  const [identityDocumentNumber, setIdentityDocumentNumber] = useState("");
  const [taxpayerType, setTaxpayerType] = useState("PERSONA_FISICA");
  const [address, setAddress] = useState("");
  const [locality, setLocality] = useState<Locality | null>(null);
  const localitySearch = useLocalitySearch();
  const [fieldError, setFieldError] = useState<{
    fullName?: string;
    identityDocumentNumber?: string;
    phone?: string;
    email?: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deactivating, setDeactivating] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Client | null>(null);
  const [reactivating, setReactivating] = useState(false);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Upcoming appointments (unmodified — small list fetched via existing endpoint)
  const [upcomingAppointments, setUpcomingAppointments] = useState<Appointment[] | null>(null);
  // Past appointments — paginated via /api/appointments/history
  const [pastApptPage, setPastApptPage] = useState<PageResponse<Appointment> | null>(null);
  const [pastApptPageNum, setPastApptPageNum] = useState(0);
  const [pastApptPageSize, setPastApptPageSize] = useState(10);
  const [pastApptLoading, setPastApptLoading] = useState(false);
  // Client invoices — paginated via /api/invoices
  const [invoicesPage, setInvoicesPage] = useState<PagedInvoicesResponse | null>(null);
  const [invoicePageNum, setInvoicePageNum] = useState(0);
  const [invoicePageSize, setInvoicePageSize] = useState(10);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
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
    } catch {
      setLoadError(t("femme.clients.profileLoadError"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setUpcomingAppointments(null);
    setPastApptPage(null);
    setPastApptPageNum(0);
    setInvoicesPage(null);
    setInvoicePageNum(0);
    setHistoryError(null);
  }, [id]);

  const clientIdNum = id ? Number(id) : NaN;

  // Initial history load: upcoming appointments (unchanged) + first page of past + invoices
  useEffect(() => {
    if (tab !== "history" || !id || Number.isNaN(clientIdNum)) return;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      // Upcoming: from now to +6 months
      const now = new Date();
      const futureEnd = new Date(now);
      futureEnd.setMonth(futureEnd.getMonth() + 6);
      futureEnd.setHours(23, 59, 59, 999);
      try {
        const [upcoming, pastPage, invPage] = await Promise.all([
          listAppointments(now.toISOString(), futureEnd.toISOString(), null, clientIdNum),
          listClientAppointmentHistory(clientIdNum, 0, pastApptPageSize),
          listInvoicesPaged({ clientId: clientIdNum, page: 0, size: invoicePageSize }),
        ]);
        if (!cancelled) {
          setUpcomingAppointments(upcoming);
          setPastApptPage(pastPage);
          setInvoicesPage(invPage);
        }
      } catch (e) {
        if (!cancelled) {
          setHistoryError(translateApiError(e, t, "femme.clients.historyLoadError"));
          setUpcomingAppointments(null);
          setPastApptPage(null);
          setInvoicesPage(null);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // pastApptPageSize / invoicePageSize intentionally excluded — they're for the sub-table effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, id, clientIdNum, t]);

  // Re-fetch past appointments when page/size changes
  useEffect(() => {
    if (tab !== "history" || !id || Number.isNaN(clientIdNum) || pastApptPage === null) return;
    let cancelled = false;
    setPastApptLoading(true);
    void listClientAppointmentHistory(clientIdNum, pastApptPageNum, pastApptPageSize).then(
      (p) => { if (!cancelled) { setPastApptPage(p); setPastApptLoading(false); } },
      () => { if (!cancelled) setPastApptLoading(false); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastApptPageNum, pastApptPageSize]);

  // Re-fetch invoices when page/size changes
  useEffect(() => {
    if (tab !== "history" || !id || Number.isNaN(clientIdNum) || invoicesPage === null) return;
    let cancelled = false;
    setInvoicesLoading(true);
    void listInvoicesPaged({ clientId: clientIdNum, page: invoicePageNum, size: invoicePageSize }).then(
      (p) => { if (!cancelled) { setInvoicesPage(p); setInvoicesLoading(false); } },
      () => { if (!cancelled) setInvoicesLoading(false); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoicePageNum, invoicePageSize]);

  async function saveClient() {
    setFieldError(null);
    setSaveError(null);
    setSaveSuccess(false);
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
    if (Object.keys(nextErr).length > 0) {
      setFieldError(nextErr);
      return;
    }

    setSaving(true);
    try {
      const updated = await femmePutJson<Client>(`/api/clients/${id ?? ""}`, {
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
      });
      setClient(updated);
      setFullName(updated.fullName);
      setPhone(updated.phone ?? "");
      setEmail(updated.email ?? "");
      const resolved = resolveIdentityDocumentTypeAndNumber(updated);
      setIdentityDocumentType(resolved.type);
      setIdentityDocumentNumber(resolved.number);
      setTaxpayerType(updated.taxpayerType ?? "PERSONA_FISICA");
      setAddress(updated.address ?? "");
      setLocality(localityFromClient(updated));
      setSaveSuccess(true);
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget || !id) return;
    setDeactivating(true);
    try {
      await femmePostJson<Client>(`/api/clients/${id}/deactivate`, {});
      setDeactivateTarget(null);
      await load();
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
    try {
      await femmePostJson<Client>(`/api/clients/${id}/activate`, {});
      await load();
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div data-tour="client-detail-header" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate("/app/clients")}
          className="self-start"
        >
          ← {t("femme.clients.backToList")}
        </Button>
        <div data-tour="client-detail-status">
          {client.active ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeactivateTarget(client)}
              disabled={deactivating}
              className="min-h-11 sm:self-auto"
            >
              {t("femme.clients.deactivate")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void activateClient()}
              disabled={reactivating}
              className="min-h-11 sm:self-auto"
            >
              {reactivating ? t("femme.clients.reactivating") : t("femme.clients.reactivate")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Heading as="h1">{client.fullName}</Heading>
          {!client.active ? (
            <Badge variant="secondary">{t("femme.clients.inactive")}</Badge>
          ) : null}
        </div>
        <Text variant="muted">
          {t("femme.clients.visits", { count: client.visitCount })}
        </Text>
      </div>

      <Tabs data-tour="client-detail-tabs" value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="info">{t("femme.clients.basicInfo")}</TabsTrigger>
          <TabsTrigger value="history">{t("femme.clients.history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <Card data-tour="client-detail-edit" className="p-6">
            {saveSuccess ? (
              <Alert variant="success" title={t("femme.clients.editSuccess")} className="mb-4" />
            ) : null}
            {saveError ? (
              <Alert variant="destructive" title={t("femme.clients.errorTitle")} className="mb-4">
                {saveError}
              </Alert>
            ) : null}

            <div className="flex flex-col gap-4">
              <div>
                <Label htmlFor="detail-fullname">{t("femme.clients.fullName")}</Label>
                <Input
                  id="detail-fullname"
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); setSaveSuccess(false); }}
                  aria-invalid={fieldError?.fullName ? "true" : "false"}
                  aria-describedby={fieldError?.fullName ? "detail-fullname-err" : undefined}
                />
                <FieldValidationError id="detail-fullname-err">
                  {fieldError?.fullName}
                </FieldValidationError>
              </div>

              <div>
                <Label htmlFor="detail-phone">{t("femme.clients.phone")}</Label>
                <Input
                  id="detail-phone"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(formatParaguayPhone(e.target.value));
                    setSaveSuccess(false);
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
                <FieldValidationError id="detail-phone-err">{fieldError?.phone}</FieldValidationError>
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
                    setSaveSuccess(false);
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
                <FieldValidationError id="detail-email-err">{fieldError?.email}</FieldValidationError>
              </div>

              <div>
                <Label htmlFor="detail-identity-document-type">
                  {t("femme.clients.identityDocumentType")}
                </Label>
                <Select
                  id="detail-identity-document-type"
                  value={identityDocumentType}
                  onChange={(e) => {
                    setIdentityDocumentType(e.target.value);
                    setSaveSuccess(false);
                  }}
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
                  <Label htmlFor="detail-taxpayer-type">{t("femme.clients.taxpayerType")}</Label>
                  <Select
                    id="detail-taxpayer-type"
                    value={taxpayerType}
                    onChange={(e) => {
                      setTaxpayerType(e.target.value);
                      setSaveSuccess(false);
                    }}
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
                  onChange={(e) => {
                    setIdentityDocumentNumber(e.target.value);
                    setSaveSuccess(false);
                  }}
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

              <div>
                <Label htmlFor="detail-address">{t("femme.clients.address")}</Label>
                <Input
                  id="detail-address"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setSaveSuccess(false);
                  }}
                  placeholder={t("femme.clients.addressPlaceholder")}
                />
              </div>

              <div>
                <Label htmlFor="detail-locality">{t("femme.clients.locality")}</Label>
                <LocalityCombobox
                  id="detail-locality"
                  value={locality}
                  onChange={(next) => {
                    setLocality(next);
                    setSaveSuccess(false);
                  }}
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

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
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
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <div className="flex flex-col gap-4">
            {historyError ? (
              <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
                {historyError}
              </Alert>
            ) : null}
            {tab === "history" && historyLoading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Spinner size="md" />
                <Text>{t("femme.clients.loading")}</Text>
              </div>
            ) : null}
            {tab === "history" && !historyLoading && !historyError ? (
              <>
                <Card className="p-4">
                  <Heading as="h2" className="mb-3 text-base">
                    {t("femme.clients.appointments")}
                  </Heading>
                  {upcomingAppointments == null && pastApptPage == null ? null : (
                    <div className="flex flex-col gap-4">
                      <div>
                        <Text className="mb-2 text-sm font-medium">
                          {t("femme.clients.historyUpcoming")}
                        </Text>
                        {!upcomingAppointments || upcomingAppointments.length === 0 ? (
                          <Text variant="muted" className="text-sm">
                            {t("femme.clients.noAppointments")}
                          </Text>
                        ) : (
                          <ul className="flex flex-col gap-2" role="list">
                            {upcomingAppointments.map((a) => (
                              <li
                                key={a.id}
                                className="flex flex-col gap-1 rounded-md border border-[var(--color-border)]/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div>
                                  <Text className="font-medium">
                                    {a.serviceName}
                                  </Text>
                                  <Text variant="muted" className="text-sm">
                                    {formatHistoryDateTime(a.startAt, dateLocale)} ·{" "}
                                    {a.professionalName}
                                  </Text>
                                </div>
                                <div className="self-start sm:self-center">
                                  <StatusBadge status={a.status} />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <Text className="mb-2 text-sm font-medium">
                          {t("femme.clients.historyPast")}
                        </Text>
                        {pastApptLoading ? (
                          <Spinner size="sm" />
                        ) : pastApptPage == null || pastApptPage.totalElements === 0 ? (
                          <Text variant="muted" className="text-sm">
                            {t("femme.clients.noAppointments")}
                          </Text>
                        ) : (
                          <>
                            <ul className="flex flex-col gap-2" role="list">
                              {pastApptPage.content.map((a) => (
                                <li
                                  key={a.id}
                                  className="flex flex-col gap-1 rounded-md border border-[var(--color-border)]/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div>
                                    <Text className="font-medium">
                                      {a.serviceName}
                                    </Text>
                                    <Text variant="muted" className="text-sm">
                                      {formatHistoryDateTime(a.startAt, dateLocale)} ·{" "}
                                      {a.professionalName}
                                    </Text>
                                  </div>
                                  <div className="self-start sm:self-center">
                                    <StatusBadge status={a.status} />
                                  </div>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                              <PageSizeSelect
                                value={pastApptPageSize}
                                label={t("femme.pagination.rowsPerPage")}
                                onChange={(s) => { setPastApptPageSize(s); setPastApptPageNum(0); }}
                              />
                              <Text variant="muted" className="text-sm">
                                {t("femme.pagination.showingRange", {
                                  from: pastApptPageNum * pastApptPageSize + 1,
                                  to: Math.min((pastApptPageNum + 1) * pastApptPageSize, pastApptPage.totalElements),
                                  total: pastApptPage.totalElements,
                                })}
                              </Text>
                              {pastApptPage.totalPages > 1 && (
                                <Pagination
                                  page={pastApptPageNum + 1}
                                  pageCount={pastApptPage.totalPages}
                                  onPageChange={(p) => setPastApptPageNum(p - 1)}
                                  previousLabel={t("femme.pagination.previous")}
                                  nextLabel={t("femme.pagination.next")}
                                />
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
                <Card className="p-4">
                  <Heading as="h2" className="mb-3 text-base">
                    {t("femme.clients.invoices")}
                  </Heading>
                  {invoicesLoading ? (
                    <Spinner size="sm" />
                  ) : invoicesPage == null || invoicesPage.totalElements === 0 ? (
                    <Text variant="muted">{t("femme.clients.noInvoices")}</Text>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[320px] text-left text-sm">
                          <thead>
                            <tr className="border-b text-xs text-[var(--color-ink-2)]">
                              <th className="py-2 pr-2 font-medium">
                                {t("femme.billing.history.colNumber")}
                              </th>
                              <th className="py-2 pr-2 font-medium">
                                {t("femme.billing.history.colDate")}
                              </th>
                              <th className="py-2 pr-2 font-medium">
                                {t("femme.billing.history.colTotal")}
                              </th>
                              <th className="py-2 pr-2 font-medium">
                                {t("femme.clients.colStatus")}
                              </th>
                              <th className="py-2 pr-2 font-medium">
                                {t("femme.billing.history.colSifenStatus")}
                              </th>
                              <th className="py-2 font-medium" />
                            </tr>
                          </thead>
                          <tbody>
                            {invoicesPage.content.map((inv) => (
                              <tr
                                key={inv.id}
                                className="border-b border-[var(--color-border)]/60"
                              >
                                <td className="py-2 pr-2 align-top font-mono text-xs">
                                  {inv.invoiceNumberFormatted}
                                </td>
                                <td className="py-2 pr-2 align-top">
                                  {formatHistoryDateTime(inv.issuedAt, dateLocale)}
                                </td>
                                <td className="py-2 pr-2 align-top">
                                  {formatAmountDecimal(inv.total)}
                                </td>
                                <td className="py-2 pr-2 align-top">
                                  <HistoryInvoiceStatusPill status={inv.status} />
                                </td>
                                <td className="py-2 pr-2 align-top">
                                  <SifenStatusBadge status={inv.sifenSubmissionStatus} />
                                </td>
                                <td className="py-2 align-top text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedInvoiceId(inv.id)}
                                  >
                                    {t("femme.billing.history.viewDetail")}
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <PageSizeSelect
                          value={invoicePageSize}
                          label={t("femme.pagination.rowsPerPage")}
                          onChange={(s) => { setInvoicePageSize(s); setInvoicePageNum(0); }}
                        />
                        <Text variant="muted" className="text-sm">
                          {t("femme.pagination.showingRange", {
                            from: invoicePageNum * invoicePageSize + 1,
                            to: Math.min((invoicePageNum + 1) * invoicePageSize, invoicesPage.totalElements),
                            total: invoicesPage.totalElements,
                          })}
                        </Text>
                        {invoicesPage.totalPages > 1 && (
                          <Pagination
                            page={invoicePageNum + 1}
                            pageCount={invoicesPage.totalPages}
                            onPageChange={(p) => setInvoicePageNum(p - 1)}
                            previousLabel={t("femme.pagination.previous")}
                            nextLabel={t("femme.pagination.next")}
                          />
                        )}
                      </div>
                    </>
                  )}
                </Card>
              </>
            ) : null}
          </div>
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
