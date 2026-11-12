import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  KebabMenu,
  Label,
  LocalityCombobox,
  Modal,
  PageSizeSelect,
  Pagination,
  Select,
  Spinner,
  Switch,
  Text,
  Toast,
  type Locality,
} from "@design-system";
import { femmePostJson } from "../api/femmeClient";
import {
  ClientProfileExtrasFields,
  EMPTY_PROFILE_EXTRAS,
  profileExtrasPayload,
  validateProfileExtras,
  type ClientProfileExtras,
} from "../components/ClientProfileExtrasFields";
import { listClientsAll, listClientsPaged, type ClientListFilterParams } from "../api/clients";
import type { PageResponse } from "../api/pagination";
import { translateApiError } from "../api/parseApiErrorMessage";
import { focusMessageBox } from "../util/focusMessageBox";
import { FieldValidationError } from "../components/FieldValidationError";
import { SearchInput } from "../components/ui/SearchInput";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { getDateLocale } from "../i18n/dateLocale";
import { useLocalitySearch } from "../hooks/useLocalitySearch";
import { formatParaguayPhone, isCompleteParaguayPhone } from "../lib/paraguayPhone";
import { isValidEmail } from "../lib/validateEmail";
import { validateRuc } from "../lib/validateRuc";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useTour } from "../tour/useTour";
import { clientsSteps } from "../tour/steps/clients";

// ── Types ─────────────────────────────────────────────────────────────────────

type Client = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
  active: boolean;
  visitCount: number;
  lastVisitAt?: string | null;
  createdAt?: string | null;
  address?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
  identityDocumentNumber?: string | null;
  identityDocumentType?: string | null;
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

type FilterKey = "all" | "active" | "new";

function pillFilterParams(filter: FilterKey): ClientListFilterParams {
  if (filter === "active") return { active: true };
  if (filter === "new") return { isNew: true };
  return {};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

function exportCsv(clients: Client[]) {
  const headers = ["Name", "Phone", "Email", "RUC", "Visits", "Status"];
  const rows = clients.map((c) => [
    c.fullName,
    c.phone ?? "",
    c.email ?? "",
    c.ruc ?? "",
    String(c.visitCount),
    c.active ? "Active" : "Inactive",
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "clients.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const { t, i18n } = useTranslation();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("clients", clientsSteps, undefined, guidedTourEnabled);
  const navigate = useNavigate();
  const location = useLocation();
  const locale = getDateLocale(i18n);

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [pageData, setPageData] = useState<PageResponse<Client> | null>(null);

  const [filter, setFilter]     = useState<FilterKey>("all");
  const [listQuery, setListQuery] = useState("");
  const [page, setPage]         = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [reloadTick, setReloadTick] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<Client | null>(null);
  const [notice, setNotice] = useState<"created" | "updated" | "activated" | "deactivated" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen]   = useState(false);
  const [fullName, setFullName]     = useState("");
  const [phone, setPhone]           = useState("");
  const [email, setEmail]           = useState("");
  const [identityDocumentType, setIdentityDocumentType] = useState("RUC");
  const [identityDocumentNumber, setIdentityDocumentNumber] = useState("");
  const [taxpayerType, setTaxpayerType] = useState("PERSONA_FISICA");
  const [address, setAddress]       = useState("");
  const [locality, setLocality]     = useState<Locality | null>(null);
  const [extras, setExtras]         = useState<ClientProfileExtras>(EMPTY_PROFILE_EXTRAS);
  const localitySearch = useLocalitySearch();
  const [fieldError, setFieldError] = useState<{
    fullName?: string;
    identityDocumentNumber?: string;
    phone?: string;
    email?: string;
    birthday?: string;
    acquisitionOther?: string;
  } | null>(null);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const resultMessagesRef = useRef<HTMLDivElement | null>(null);
  const modalErrorRef = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving]         = useState(false);

  // ── Server-side filtered + paged loader ────────────────────────────────────
  const loadPage = useCallback(
    async (f: FilterKey, q: string, pageNum: number, size: number) => {
      setError(null);
      try {
        const data = await listClientsPaged<Client>({
          ...pillFilterParams(f),
          q: q.trim() || undefined,
          page: pageNum,
          size,
        });
        setPageData(data);
      } catch {
        setError(t("femme.clients.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadPage(filter, listQuery, page, pageSize);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filter, listQuery, page, pageSize, reloadTick, loadPage]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  // Open "new client" from other flows (e.g. billing → create client)
  const [returnAfterCreate, setReturnAfterCreate] = useState<{
    path: string;
    tab?: "session" | "invoice" | "history" | "new";
  } | null>(null);
  useEffect(() => {
    const st = location.state as
      | {
          openCreateClient?: boolean;
          prefilledName?: string;
          returnTo?: string;
          returnTab?: "session" | "invoice" | "history" | "new";
          notice?: "updated" | "activated" | "deactivated";
        }
      | undefined;
    if (st?.notice) {
      // The client detail closes after saving / (de)activating and reports the outcome here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice(st.notice);
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if (st?.openCreateClient) {
      // Open the create-client modal pre-filled from router navigation state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFullName(st.prefilledName?.trim() ?? "");
      setPhone("");
      setEmail("");
      setIdentityDocumentType("RUC");
      setIdentityDocumentNumber("");
      setTaxpayerType("PERSONA_FISICA");
      setAddress("");
      setLocality(null);
      setFieldError(null);
      setSaveError(null);
      setNotice(null);
      setMoreOpen(false);
      setModalOpen(true);
      if (st.returnTo) {
        setReturnAfterCreate({ path: st.returnTo, tab: st.returnTab });
      } else {
        setReturnAfterCreate(null);
      }
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  // ── New client modal ────────────────────────────────────────────────────────
  function openNew() {
    setFullName("");
    setPhone("");
    setEmail("");
    setIdentityDocumentType("RUC");
    setIdentityDocumentNumber("");
    setTaxpayerType("PERSONA_FISICA");
    setAddress("");
    setLocality(null);
    setExtras(EMPTY_PROFILE_EXTRAS);
    setFieldError(null);
    setSaveError(null);
    setNotice(null);
    setMoreOpen(false);
    setModalOpen(true);
  }

  async function saveClient() {
    setFieldError(null);
    setSaveError(null);
    setNotice(null);
    const nextErr: NonNullable<typeof fieldError> = {};
    if (!fullName.trim()) nextErr.fullName = t("femme.clients.fullNameRequired");
    const isRucType = identityDocumentType === "RUC";
    const isInnominado = identityDocumentType === "INNOMINADO";
    const documentNumberTrim = isInnominado ? "" : identityDocumentNumber.trim();
    if (isRucType && documentNumberTrim && !validateRuc(documentNumberTrim)) {
      nextErr.identityDocumentNumber = t("femme.clients.rucInvalid");
    }
    if (phone.trim() && !isCompleteParaguayPhone(phone.trim()))
      nextErr.phone = t("femme.clients.phoneInvalid");
    if (email.trim() && !isValidEmail(email.trim()))
      nextErr.email = t("femme.clients.emailInvalid");
    const extrasErr = validateProfileExtras(extras, t);
    if (extrasErr.birthday) nextErr.birthday = extrasErr.birthday;
    if (extrasErr.other) nextErr.acquisitionOther = extrasErr.other;
    if (Object.keys(nextErr).length > 0) {
      setFieldError(nextErr);
      return;
    }
    setSaving(true);
    try {
      const created = await femmePostJson<Client>("/api/clients", {
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
      setModalOpen(false);
      if (returnAfterCreate) {
        const ret = returnAfterCreate;
        setReturnAfterCreate(null);
        navigate(ret.path, {
          state: {
            activeTab: ret.tab,
            selectedClient: {
              id: created.id,
              fullName: created.fullName,
              phone: created.phone,
              email: created.email,
              ruc: created.ruc,
              identityDocumentNumber: created.identityDocumentNumber,
              identityDocumentType: created.identityDocumentType,
            },
          },
        });
        return;
      }
      reload();
      setNotice("created");
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setSaving(false);
    }
  }

  // After saving, move the user to the result message so the outcome is seen right away.
  useEffect(() => {
    if (error) focusMessageBox(resultMessagesRef.current);
  }, [error]);

  useEffect(() => {
    if (saveError) focusMessageBox(modalErrorRef.current);
  }, [saveError]);

  // ── Deactivate / activate ───────────────────────────────────────────────────
  async function confirmDeactivateFromList() {
    if (!deactivateTarget) return;
    setNotice(null);
    try {
      await femmePostJson<Client>(`/api/clients/${deactivateTarget.id}/deactivate`, {});
      setDeactivateTarget(null);
      reload();
      setNotice("deactivated");
    } catch (e) {
      setError(translateApiError(e, t, "femme.clients.saveError"));
      setDeactivateTarget(null);
    }
  }

  async function activateClientRow(client: Client) {
    setNotice(null);
    try {
      await femmePostJson<Client>(`/api/clients/${client.id}/activate`, {});
      reload();
      setNotice("activated");
    } catch (e) {
      setError(translateApiError(e, t, "femme.clients.saveError"));
    }
  }

  // ── Filter pills + search: applied server-side ──────────────────────────────
  function handlePillChange(next: FilterKey) {
    setFilter(next);
    setPage(0);
  }

  function handleSearchChange(next: string) {
    setListQuery(next);
    setPage(0);
  }

  const pageClients = pageData?.content ?? [];
  const totalElements = pageData?.totalElements ?? 0;
  const totalPages = pageData?.totalPages ?? 0;
  const hasActiveFilters = filter !== "all" || listQuery.trim().length > 0;
  const showingFrom = totalElements === 0 ? 0 : page * pageSize + 1;
  const showingTo = Math.min((page + 1) * pageSize, totalElements);

  // Exports every client matching the current filters, not just the visible page
  async function exportFilteredCsv() {
    try {
      const all = await listClientsAll<Client>({
        ...pillFilterParams(filter),
        q: listQuery.trim() || undefined,
      });
      exportCsv(Array.isArray(all) ? all : []);
    } catch {
      setError(t("femme.clients.loadError"));
    }
  }

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "all",    label: t("femme.clients.filterAll")     },
    { key: "active", label: t("femme.clients.filterActive")  },
    { key: "new",    label: t("femme.clients.filterNew")     },
  ];

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.clients.loading")}</Text>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* ── Page header ── */}
      <div data-tour="clients-header" className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold text-ink">{t("femme.clients.title")}</h1>
        <div className="flex items-center gap-2">
          <Button data-tour="clients-new" data-testid="clients-new" type="button" className="min-h-11" onClick={openNew}>
            {t("femme.clients.newClient")}
          </Button>
          <KebabMenu
            id="clients-more"
            triggerAriaLabel={t("femme.clients.moreActions")}
            items={[
              {
                id: "export",
                label: t("femme.clients.export"),
                onSelect: () => void exportFilteredCsv(),
              },
            ]}
          />
        </div>
      </div>

      {/* ── Notices ── */}
      {error && (
        <div ref={resultMessagesRef} tabIndex={-1} className="mb-4 outline-none">
          <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
            {error}
          </Alert>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div data-tour="clients-search" className="mb-3">
        <SearchInput
          id="clients-inline-search"
          value={listQuery}
          onChange={handleSearchChange}
          placeholder={t("femme.clients.searchInlinePlaceholder")}
          resultCount={totalElements}
          totalCount={totalElements}
        />
      </div>
      <div
        data-tour="clients-filter-tabs"
        role="group"
        aria-label={t("femme.clients.filterGroup")}
        className="mb-4 flex flex-wrap gap-2"
      >
        {FILTERS.map(({ key, label }) => {
          const isActive = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handlePillChange(key)}
              aria-pressed={isActive}
              data-testid={`clients-filter-${key}`}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
                isActive
                  ? "border-primary bg-primary-lt text-primary"
                  : "border-line bg-surface text-ink hover:bg-bg"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── List ── */}
      <div
        data-tour="clients-list"
        data-testid="clients-list"
        className="overflow-hidden rounded-card border border-line bg-surface"
      >
        {pageClients.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm text-ink-3">
            <span>{hasActiveFilters ? t("femme.clients.emptySearch") : t("femme.clients.emptyTitle")}</span>
            {!hasActiveFilters && (
              <Button type="button" className="min-h-11" onClick={openNew}>
                {t("femme.clients.newClient")}
              </Button>
            )}
          </div>
        ) : (
          <ul className="flex flex-col px-1 sm:px-2">
            {pageClients.map((client) => (
              <li
                key={client.id}
                role="button"
                tabIndex={0}
                aria-label={t("femme.clients.openClient", { name: client.fullName })}
                data-testid={`client-row-${client.id}`}
                data-active={client.active ? "true" : "false"}
                onClick={() => navigate(`/app/clients/${client.id}`)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/app/clients/${client.id}`);
                  }
                }}
                className="flex min-h-14 cursor-pointer items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0 hover:bg-bg"
              >
                <span
                  aria-hidden="true"
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading font-extrabold text-primary ${
                    client.active ? "" : "opacity-60"
                  }`}
                >
                  {getInitials(client.fullName)}
                </span>
                <div className={`min-w-0 flex-1 ${client.active ? "" : "opacity-60"}`}>
                  <div className="break-words font-semibold text-ink">{client.fullName}</div>
                  <div className="break-words text-sm text-ink-3">
                    {[
                      client.phone || t("femme.clients.noPhone"),
                      client.lastVisitAt
                        ? t("femme.clients.lastVisit", { date: fmtDate(client.lastVisitAt, locale) })
                        : t("femme.clients.noVisits"),
                      client.active ? null : t("femme.status.INACTIVE"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Switch
                    className="min-h-11 min-w-11 justify-center"
                    checked={client.active}
                    aria-label={t("femme.clients.toggleAria", { name: client.fullName })}
                    data-testid={`client-switch-${client.id}`}
                    onChange={() =>
                      client.active ? setDeactivateTarget(client) : void activateClientRow(client)
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* ── Pagination footer ── */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{ borderTop: "var(--border-default)" }}
        >
          <PageSizeSelect
            value={pageSize}
            onChange={(s) => { setPageSize(s); setPage(0); }}
            label={t("femme.pagination.rowsPerPage")}
          />
          <Text variant="small" className="text-[var(--color-ink-3)]">
            {t("femme.pagination.showingRange", {
              from: showingFrom,
              to: showingTo,
              total: totalElements,
            })}
          </Text>
          <Pagination
            page={page + 1}
            pageCount={Math.max(1, totalPages)}
            onPageChange={(p) => setPage(p - 1)}
            previousLabel={t("femme.pagination.previous")}
            nextLabel={t("femme.pagination.next")}
          />
        </div>
      </div>

      {/* ── New client modal ── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t("femme.clients.addTitle")}
      >
        <div className="flex flex-col gap-4">
          {saveError && (
            <div ref={modalErrorRef} tabIndex={-1} className="outline-none">
              <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
                {saveError}
              </Alert>
            </div>
          )}

          <div>
            <Label htmlFor="client-fullname">{t("femme.clients.fullName")}</Label>
            <Input
              id="client-fullname"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              aria-invalid={fieldError?.fullName ? "true" : "false"}
              aria-describedby={fieldError?.fullName ? "client-fullname-err" : undefined}
            />
            <FieldValidationError id="client-fullname-err">
              {fieldError?.fullName}
            </FieldValidationError>
          </div>

          <div>
            <Label htmlFor="client-phone">{t("femme.clients.phone")}</Label>
            <Input
              id="client-phone"
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
              aria-describedby={fieldError?.phone ? "client-phone-err" : undefined}
            />
            <FieldValidationError id="client-phone-err">{fieldError?.phone}</FieldValidationError>
          </div>

          <button
            type="button"
            data-testid="client-more-toggle"
            aria-expanded={moreOpen}
            aria-controls="client-more-options"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex min-h-11 w-full items-center justify-between border-t border-line pt-2 text-left font-semibold text-ink"
          >
            {t("femme.clients.moreOptions")}
            <span aria-hidden="true" className={`transition-transform ${moreOpen ? "rotate-180" : ""}`}>
              ⌄
            </span>
          </button>

          {moreOpen && (
            <div id="client-more-options" className="flex flex-col gap-4">
              <div>
                <Label htmlFor="client-email">{t("femme.clients.email")}</Label>
                <Input
                  id="client-email"
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
                  aria-describedby={fieldError?.email ? "client-email-err" : undefined}
                />
                <FieldValidationError id="client-email-err">{fieldError?.email}</FieldValidationError>
              </div>

              <div>
                <Label htmlFor="client-identity-document-type">
                  {t("femme.clients.identityDocumentType")}
                </Label>
                <Select
                  id="client-identity-document-type"
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
                  <Label htmlFor="client-taxpayer-type">{t("femme.clients.taxpayerType")}</Label>
                  <Select
                    id="client-taxpayer-type"
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
                <Label htmlFor="client-identity-document-number">
                  {t("femme.clients.identityDocumentNumber")}
                </Label>
                <Input
                  id="client-identity-document-number"
                  value={identityDocumentNumber}
                  onChange={(e) => setIdentityDocumentNumber(e.target.value)}
                  placeholder={t("femme.clients.identityDocumentNumberPlaceholder")}
                  disabled={identityDocumentType === "INNOMINADO"}
                  aria-invalid={fieldError?.identityDocumentNumber ? "true" : "false"}
                  aria-describedby={
                    fieldError?.identityDocumentNumber ? "client-identity-document-number-err" : undefined
                  }
                />
                {identityDocumentType === "RUC" && (
                  <Text variant="muted" className="mt-1 text-sm">
                    {t("femme.clients.rucHint")}
                  </Text>
                )}
                <FieldValidationError id="client-identity-document-number-err">
                  {fieldError?.identityDocumentNumber}
                </FieldValidationError>
              </div>

              <div>
                <Label htmlFor="client-address">{t("femme.clients.address")}</Label>
                <Input
                  id="client-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t("femme.clients.addressPlaceholder")}
                />
              </div>

              <div>
                <Label htmlFor="client-locality">{t("femme.clients.locality")}</Label>
                <LocalityCombobox
                  id="client-locality"
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

              <ClientProfileExtrasFields
                idPrefix="client"
                value={extras}
                onChange={setExtras}
                birthdayError={fieldError?.birthday}
                otherError={fieldError?.acquisitionOther}
              />
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
              className="min-h-11"
            >
              {t("femme.clients.cancel")}
            </Button>
            <Button
              type="button"
              onClick={saveClient}
              disabled={saving}
              className="min-h-11"
            >
              {saving ? t("femme.clients.saving") : t("femme.clients.save")}
            </Button>
          </div>
        </div>
      </Modal>

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
          onConfirm={() => void confirmDeactivateFromList()}
        />
      ) : null}

      <Toast
        open={notice !== null}
        onOpenChange={(o) => {
          if (!o) setNotice(null);
        }}
        variant="success"
        duration={4000}
        data-testid="clients-toast"
      >
        {notice === "created"
          ? t("femme.clients.createSuccessBody")
          : notice === "updated"
            ? t("femme.clients.editSuccess")
            : notice === "activated"
            ? t("femme.clients.rowActivateSuccess")
            : t("femme.clients.rowDeactivateSuccess")}
      </Toast>
    </div>
  );
}
