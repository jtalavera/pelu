import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  Spinner,
  Text,
} from "@design-system";
import { femmePostJson } from "../api/femmeClient";
import { listClientsAll, listClientsPaged, type ClientListFilterParams } from "../api/clients";
import type { PageResponse } from "../api/pagination";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { SearchInput } from "../components/ui/SearchInput";
import { StatusBadge } from "../components/StatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { getDateLocale } from "../i18n/dateLocale";
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
};

type FilterKey = "all" | "active" | "ruc" | "new";

function pillFilterParams(filter: FilterKey): ClientListFilterParams {
  if (filter === "active") return { active: true };
  if (filter === "ruc") return { withRuc: true };
  if (filter === "new") return { isNew: true };
  return {};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function avatarStyle(client: Client): { bg: string; color: string } {
  if (client.visitCount > 5) return { bg: "var(--color-rose-lt)",  color: "var(--color-rose-dk)"  };
  if (client.ruc)             return { bg: "var(--color-mauve-lt)", color: "var(--color-mauve-dk)" };
  return                             { bg: "var(--color-stone-md)", color: "var(--color-ink-2)"    };
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
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<Client | null>(null);

  // Modal state
  const [modalOpen, setModalOpen]   = useState(false);
  const [fullName, setFullName]     = useState("");
  const [phone, setPhone]           = useState("");
  const [email, setEmail]           = useState("");
  const [ruc, setRuc]               = useState("");
  const [fieldError, setFieldError] = useState<{
    fullName?: string;
    ruc?: string;
    phone?: string;
    email?: string;
  } | null>(null);
  const [saveError, setSaveError]   = useState<string | null>(null);
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
        }
      | undefined;
    if (st?.openCreateClient) {
      setFullName(st.prefilledName?.trim() ?? "");
      setPhone("");
      setEmail("");
      setRuc("");
      setFieldError(null);
      setSaveError(null);
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
    setRuc("");
    setFieldError(null);
    setSaveError(null);
    setModalOpen(true);
  }

  async function saveClient() {
    setFieldError(null);
    setSaveError(null);
    const nextErr: NonNullable<typeof fieldError> = {};
    if (!fullName.trim()) nextErr.fullName = t("femme.clients.fullNameRequired");
    if (ruc.trim() && !validateRuc(ruc)) nextErr.ruc = t("femme.clients.rucInvalid");
    if (phone.trim() && !isCompleteParaguayPhone(phone.trim()))
      nextErr.phone = t("femme.clients.phoneInvalid");
    if (email.trim() && !isValidEmail(email.trim()))
      nextErr.email = t("femme.clients.emailInvalid");
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
        ruc: ruc.trim() || null,
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
            },
          },
        });
        return;
      }
      reload();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setSaving(false);
    }
  }

  // ── Deactivate / activate ───────────────────────────────────────────────────
  async function confirmDeactivateFromList() {
    if (!deactivateTarget) return;
    try {
      await femmePostJson<Client>(`/api/clients/${deactivateTarget.id}/deactivate`, {});
      setDeactivateTarget(null);
      reload();
    } catch (e) {
      setError(translateApiError(e, t, "femme.clients.saveError"));
      setDeactivateTarget(null);
    }
  }

  async function activateClientRow(client: Client) {
    try {
      await femmePostJson<Client>(`/api/clients/${client.id}/activate`, {});
      reload();
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

  // ── Shared styles ───────────────────────────────────────────────────────────
  const primaryBtn: React.CSSProperties = {
    background: "var(--color-rose)",
    color: "var(--color-on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  const ghostBtn: React.CSSProperties = {
    background: "var(--color-white)",
    color: "var(--color-ink-2)",
    border: "var(--border-default)",
    borderRadius: "var(--radius-md)",
    padding: "7px 14px",
    fontSize: 12,
    cursor: "pointer",
  };

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "all",    label: t("femme.clients.filterAll")     },
    { key: "active", label: t("femme.clients.filterActive")  },
    { key: "ruc",    label: t("femme.clients.filterWithRuc") },
    { key: "new",    label: t("femme.clients.filterNew")     },
  ];

  const thStyle: React.CSSProperties = {
    padding: "9px 12px",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--color-ink-3)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "left",
    background: "var(--color-stone)",
    whiteSpace: "nowrap",
  };

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "40vh", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Spinner size="lg" />
        <Text>{t("femme.clients.loading")}</Text>
      </div>
    );
  }

  return (
    <div>
      {/* ── Page header ── */}
      <div
        data-tour="clients-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: "var(--color-ink)",
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {t("femme.clients.title")}
          </h1>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
            {t("femme.clients.subtitle", { count: totalElements })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" style={ghostBtn} onClick={() => void exportFilteredCsv()}>
            {t("femme.clients.export")}
          </button>
          <button data-tour="clients-new" type="button" style={primaryBtn} onClick={openNew}>
            {t("femme.clients.newClient")}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
          {error}
        </Alert>
      )}

      {/* ── Toolbar ── */}
      <div data-tour="clients-search" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <SearchInput
          id="clients-inline-search"
          value={listQuery}
          onChange={handleSearchChange}
          placeholder={t("femme.clients.searchInlinePlaceholder")}
          resultCount={totalElements}
          totalCount={totalElements}
        />

        {/* Filter pills */}
        <div data-tour="clients-filter-tabs" role="group" aria-label={t("femme.clients.filterAll")} style={{ display: "flex", gap: 6 }}>
          {FILTERS.map(({ key, label }) => {
            const isActive = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handlePillChange(key)}
                aria-pressed={isActive}
                style={{
                  padding: "5px 12px",
                  borderRadius: "var(--radius-pill)",
                  fontSize: 11,
                  cursor: "pointer",
                  border: isActive ? `1px solid var(--color-rose-md)` : "var(--border-default)",
                  background: isActive ? "var(--color-rose-lt)" : "var(--color-white)",
                  color: isActive ? "var(--color-rose-dk)" : "var(--color-ink-2)",
                  fontWeight: isActive ? 500 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Table ── */}
      <div
        data-tour="clients-list"
        style={{
          background: "var(--color-white)",
          borderRadius: "var(--radius-xl)",
          border: "var(--border-default)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ tableLayout: "fixed", width: "100%", borderCollapse: "collapse" }}>
            <colgroup>
              <col style={{ width: "27%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "9%"  }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "9%"  }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle}>{t("femme.clients.colClient")}</th>
                <th style={thStyle}>{t("femme.clients.colPhone")}</th>
                <th style={thStyle}>{t("femme.clients.ruc")}</th>
                <th style={thStyle}>{t("femme.clients.colVisits")}</th>
                <th style={thStyle}>{t("femme.clients.colLastVisit")}</th>
                <th style={thStyle}>{t("femme.clients.colStatus")}</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {pageClients.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: "24px 12px",
                      textAlign: "center",
                      fontSize: 12,
                      color: "var(--color-ink-3)",
                    }}
                  >
                    {hasActiveFilters ? t("femme.clients.emptySearch") : t("femme.clients.emptyTitle")}
                  </td>
                </tr>
              ) : (
                pageClients.map((client) => {
                  const av = avatarStyle(client);
                  const isHov = hoveredId === client.id;
                  const tdBg = isHov ? "var(--color-rose-lt)" : undefined;
                  const tdStyle: React.CSSProperties = {
                    padding: "10px 12px",
                    fontSize: 12,
                    color: "var(--color-ink)",
                    verticalAlign: "middle",
                    borderBottom: "0.5px solid var(--color-stone)",
                    background: tdBg,
                  };

                  return (
                    <tr
                      key={client.id}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHoveredId(client.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => navigate(`/app/clients/${client.id}`)}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "var(--radius-pill)",
                              background: av.bg,
                              color: av.color,
                              fontSize: 10,
                              fontWeight: 500,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {getInitials(client.fullName)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 500,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {client.fullName}
                            </div>
                            {client.email ? (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--color-ink-3)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {client.email}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                        {client.phone ?? "—"}
                      </td>

                      <td style={tdStyle}>
                        {client.ruc ? (
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 11,
                              color: "var(--color-ink-2)",
                            }}
                          >
                            {client.ruc}
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-ink-3)" }}>
                            {t("femme.clients.noRuc")}
                          </span>
                        )}
                      </td>

                      <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                        {t("femme.clients.visits", { count: client.visitCount })}
                      </td>

                      <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                        {client.lastVisitAt ? fmtDate(client.lastVisitAt, locale) : "—"}
                      </td>

                      <td style={tdStyle}>
                        <StatusBadge status={client.active ? "ACTIVE" : "INACTIVE"} />
                      </td>

                      <td
                        style={{ ...tdStyle, textAlign: "center" }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            justifyContent: "center",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <KebabMenu
                            id={`clients-row-${client.id}`}
                            triggerAriaLabel={t("femme.rowActions.trigger")}
                            items={
                              client.active
                                ? [
                                    {
                                      id: "edit-info",
                                      label: t("femme.rowActions.clients.editInfo"),
                                      onSelect: () =>
                                        navigate(`/app/clients/${client.id}`),
                                    },
                                    {
                                      id: "deactivate",
                                      label: t("femme.rowActions.clients.deactivate"),
                                      destructive: true,
                                      onSelect: () => setDeactivateTarget(client),
                                    },
                                  ]
                                : [
                                    {
                                      id: "edit-info",
                                      label: t("femme.rowActions.clients.editInfo"),
                                      onSelect: () =>
                                        navigate(`/app/clients/${client.id}`),
                                    },
                                    {
                                      id: "activate",
                                      label: t("femme.rowActions.clients.activate"),
                                      onSelect: () => void activateClientRow(client),
                                    },
                                  ]
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination footer ── */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
          style={{ background: "var(--color-stone)", borderTop: "var(--border-default)" }}
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
            <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
              {saveError}
            </Alert>
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
            <Label htmlFor="client-ruc">{t("femme.clients.ruc")}</Label>
            <Input
              id="client-ruc"
              value={ruc}
              onChange={(e) => setRuc(e.target.value)}
              placeholder="80000005-6"
              aria-invalid={fieldError?.ruc ? "true" : "false"}
              aria-describedby={fieldError?.ruc ? "client-ruc-err" : undefined}
            />
            <Text variant="muted" className="mt-1 text-sm">
              {t("femme.clients.rucHint")}
            </Text>
            <FieldValidationError id="client-ruc-err">{fieldError?.ruc}</FieldValidationError>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
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
    </div>
  );
}
