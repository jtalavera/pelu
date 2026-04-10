import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { StatusBadge } from "../components/StatusBadge";
import { getDateLocale } from "../i18n/dateLocale";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const PARAGUAY_RUC_PATTERN = /^\d+-\d+$/;

function validateRuc(ruc: string): boolean {
  return PARAGUAY_RUC_PATTERN.test(ruc.trim());
}

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

const PAGE_SIZE = 20;

// ── Search icon ───────────────────────────────────────────────────────────────

const SearchIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

// ── Main component ────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = getDateLocale(i18n);

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [clients, setClients]   = useState<Client[]>([]);

  const [q, setQ]               = useState("");
  const [filter, setFilter]     = useState<FilterKey>("all");
  const [page, setPage]         = useState(1);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // Modal state
  const [modalOpen, setModalOpen]   = useState(false);
  const [fullName, setFullName]     = useState("");
  const [phone, setPhone]           = useState("");
  const [email, setEmail]           = useState("");
  const [ruc, setRuc]               = useState("");
  const [fieldError, setFieldError] = useState<{ fullName?: string; ruc?: string } | null>(null);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);

  // ── Load all ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await femmeJson<Client[]>("/api/clients");
      setClients(Array.isArray(data) ? data : []);
    } catch {
      setError(t("femme.clients.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Debounced keystroke search ───────────────────────────────────────────────
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      setPage(1);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (q.trim()) qs.set("q", q.trim());
        const data = await femmeJson<Client[]>(`/api/clients?${qs.toString()}`);
        setClients(Array.isArray(data) ? data : []);
      } catch {
        setError(t("femme.clients.loadError"));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [q, t]);

  // Existing search submit handler (kept for Enter-key form support)
  async function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      const data = await femmeJson<Client[]>(`/api/clients?${qs.toString()}`);
      setClients(Array.isArray(data) ? data : []);
    } catch {
      setError(t("femme.clients.loadError"));
    }
  }

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [filter]);

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
    if (Object.keys(nextErr).length > 0) {
      setFieldError(nextErr);
      return;
    }
    setSaving(true);
    try {
      await femmePostJson<Client>("/api/clients", {
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        ruc: ruc.trim() || null,
      });
      setModalOpen(false);
      await load();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setSaving(false);
    }
  }

  // ── Deactivate ──────────────────────────────────────────────────────────────
  async function deactivateClient(client: Client) {
    if (!window.confirm(t("femme.clients.deactivateConfirm", { name: client.fullName }))) return;
    try {
      await femmePostJson<Client>(`/api/clients/${client.id}/deactivate`, {});
      await load();
    } catch (e) {
      setError(translateApiError(e, t, "femme.clients.saveError"));
    }
  }

  // ── Filtered + paginated ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = clients;
    if (filter === "active") list = list.filter((c) => c.active);
    if (filter === "ruc")    list = list.filter((c) => !!c.ruc);
    if (filter === "new") {
      const now = new Date();
      list = list.filter((c) => {
        if (c.createdAt) {
          const d = new Date(c.createdAt);
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        }
        return c.visitCount === 0;
      });
    }
    return list;
  }, [clients, filter]);

  const totalPages   = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage     = Math.min(page, totalPages);
  const pageClients  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const fromIdx      = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const toIdx        = Math.min(safePage * PAGE_SIZE, filtered.length);

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
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-ink)" }}>
            {t("femme.clients.title")}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
            {t("femme.clients.subtitle", { count: clients.length })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" style={ghostBtn} onClick={() => exportCsv(filtered)}>
            {t("femme.clients.export")}
          </button>
          <button type="button" style={primaryBtn} onClick={openNew}>
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
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {/* Inline search */}
        <form
          onSubmit={onSearchSubmit}
          style={{ position: "relative", flex: 1, maxWidth: 280 }}
          role="search"
        >
          <Label htmlFor="client-q" className="sr-only">
            {t("femme.clients.search.label")}
          </Label>
          <span
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-ink-3)",
              pointerEvents: "none",
              display: "flex",
            }}
          >
            <SearchIcon />
          </span>
          <input
            id="client-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("femme.clients.search.placeholder")}
            aria-label={t("femme.clients.search.label")}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "7px 10px 7px 32px",
              border: "var(--border-default)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
              background: "var(--color-stone)",
              color: "var(--color-ink)",
              outline: "none",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-rose)"; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = ""; }}
          />
        </form>

        {/* Filter pills */}
        <div role="group" aria-label={t("femme.clients.filterAll")} style={{ display: "flex", gap: 6 }}>
          {FILTERS.map(({ key, label }) => {
            const isActive = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
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
                    {t("femme.clients.emptySearch")}
                  </td>
                </tr>
              ) : (
                pageClients.map((client) => {
                  const av       = avatarStyle(client);
                  const isHov    = hoveredId === client.id;
                  const tdBg     = isHov ? "var(--color-rose-lt)" : undefined;
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
                      {/* Client name + email */}
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
                            {client.email && (
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
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                        {client.phone ?? "—"}
                      </td>

                      {/* RUC */}
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

                      {/* Visits */}
                      <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                        {client.visitCount}
                      </td>

                      {/* Last visit */}
                      <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                        {client.lastVisitAt ? fmtDate(client.lastVisitAt, locale) : "—"}
                      </td>

                      {/* Status */}
                      <td style={tdStyle}>
                        <StatusBadge status={client.active ? "ACTIVE" : "INACTIVE"} />
                      </td>

                      {/* Actions */}
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/app/clients/${client.id}`);
                            }}
                            style={{
                              padding: "4px 10px",
                              borderRadius: "var(--radius-sm)",
                              fontSize: 11,
                              border: "0.5px solid var(--color-rose-md)",
                              background: "transparent",
                              color: "var(--color-rose)",
                              cursor: "pointer",
                            }}
                          >
                            {t("femme.clients.viewBtn")}
                          </button>
                          {client.active && isHov && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deactivateClient(client);
                              }}
                              aria-label={t("femme.clients.deactivate")}
                              style={{
                                padding: "4px 6px",
                                borderRadius: "var(--radius-sm)",
                                fontSize: 11,
                                border: "0.5px solid var(--color-stone-md)",
                                background: "transparent",
                                color: "var(--color-ink-3)",
                                cursor: "pointer",
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {filtered.length > 0 && (
          <div
            style={{
              background: "var(--color-stone)",
              borderTop: "var(--border-default)",
              padding: "9px 12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--color-ink-3)" }}>
              {t("femme.clients.paginationInfo", {
                from: fromIdx,
                to: toIdx,
                total: filtered.length,
              })}
            </span>

            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button
                type="button"
                disabled={safePage === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "3px 9px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 11,
                  border: "var(--border-default)",
                  background: "var(--color-white)",
                  color: "var(--color-ink-2)",
                  cursor: safePage === 1 ? "default" : "pointer",
                  opacity: safePage === 1 ? 0.4 : 1,
                }}
              >
                {t("femme.clients.prevPage")}
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  style={{
                    padding: "3px 9px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 11,
                    border: p === safePage ? "1px solid var(--color-rose)" : "var(--border-default)",
                    background: p === safePage ? "var(--color-rose)" : "var(--color-white)",
                    color: p === safePage ? "var(--color-on-primary)" : "var(--color-ink-2)",
                    cursor: "pointer",
                    fontWeight: p === safePage ? 500 : 400,
                    minWidth: 28,
                  }}
                >
                  {p}
                </button>
              ))}

              <button
                type="button"
                disabled={safePage === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "3px 9px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 11,
                  border: "var(--border-default)",
                  background: "var(--color-white)",
                  color: "var(--color-ink-2)",
                  cursor: safePage === totalPages ? "default" : "pointer",
                  opacity: safePage === totalPages ? 0.4 : 1,
                }}
              >
                {t("femme.clients.nextPage")}
              </button>
            </div>
          </div>
        )}
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
            />
          </div>

          <div>
            <Label htmlFor="client-email">{t("femme.clients.email")}</Label>
            <Input
              id="client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
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
    </div>
  );
}
