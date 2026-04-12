import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { SearchInput } from "../components/ui/SearchInput";
import { InlineEditActions } from "../components/ui/InlineEditActions";
import { useFilteredList } from "../hooks/useFilteredList";
import { useInlineEdit } from "../hooks/useInlineEdit";
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

// ── Main component ────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const locale = getDateLocale(i18n);

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [clients, setClients]   = useState<Client[]>([]);

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

  // Open "new client" from other flows (e.g. billing → create client)
  useEffect(() => {
    const st = location.state as
      | { openCreateClient?: boolean; prefilledName?: string }
      | undefined;
    if (st?.openCreateClient) {
      setFullName(st.prefilledName?.trim() ?? "");
      setPhone("");
      setEmail("");
      setRuc("");
      setFieldError(null);
      setSaveError(null);
      setModalOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

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

  // ── Filter pills + real-time search (client-side) + paginated ───────────────
  const filteredByPills = useMemo(() => {
    let list = clients;
    if (filter === "active") list = list.filter((c) => c.active);
    if (filter === "ruc") list = list.filter((c) => !!c.ruc);
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

  const { query: listQuery, setQuery: setListQuery, filtered: searchFiltered, highlight } =
    useFilteredList<Client>({
      items: filteredByPills,
      fields: ["fullName", "phone", "email", "ruc"],
    });

  useEffect(() => {
    setPage(1);
  }, [listQuery]);

  const handleInlineSave = useCallback(
    async (client: Client) => {
      const rucTrim = (client.ruc ?? "").trim();
      if (rucTrim && !validateRuc(rucTrim)) {
        throw new Error("INVALID_RUC");
      }
      await femmePutJson<Client>(`/api/clients/${client.id}`, {
        fullName: String(client.fullName ?? "").trim(),
        phone: client.phone?.trim() || null,
        email: client.email?.trim() || null,
        ruc: rucTrim || null,
      });
      await load();
    },
    [load],
  );

  const {
    editingData,
    saving: inlineSaving,
    saveError: inlineSaveError,
    startEdit,
    cancelEdit,
    updateField,
    saveEdit,
    isEditing,
  } = useInlineEdit<Client>({
    onSave: handleInlineSave,
    saveErrorMessage: t("femme.inlineEdit.saveError"),
  });

  const totalPages = Math.max(1, Math.ceil(searchFiltered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageClients = searchFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const fromIdx = searchFiltered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const toIdx = Math.min(safePage * PAGE_SIZE, searchFiltered.length);

  const inputEditStyle: React.CSSProperties = {
    padding: "6px 9px",
    border: "1px solid var(--color-rose-md)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    color: "var(--color-ink)",
    background: "var(--color-white)",
    outline: "none",
    width: "100%",
    minWidth: 80,
  };

  const keySaveCancel = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveEdit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

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
          <button type="button" style={ghostBtn} onClick={() => exportCsv(searchFiltered)}>
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
        <SearchInput
          id="clients-inline-search"
          value={listQuery}
          onChange={setListQuery}
          placeholder={t("femme.clients.searchInlinePlaceholder")}
          resultCount={searchFiltered.length}
          totalCount={filteredByPills.length}
        />

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
                  const rowEditing = isEditing(client.id);
                  const ed = rowEditing
                    ? ({ ...client, ...editingData } as Client)
                    : client;

                  if (rowEditing) {
                    return (
                      <tr
                        key={client.id}
                        style={{
                          background: "var(--color-rose-lt)",
                          outline: "1.5px solid var(--color-rose-md)",
                          outlineOffset: -1,
                        }}
                      >
                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <input
                              value={ed.fullName ?? ""}
                              onChange={(e) => updateField("fullName", e.target.value)}
                              onKeyDown={keySaveCancel}
                              placeholder={t("femme.clients.fullName")}
                              style={inputEditStyle}
                              aria-label={t("femme.clients.fullName")}
                            />
                            <input
                              value={ed.email ?? ""}
                              onChange={(e) => updateField("email", e.target.value || null)}
                              onKeyDown={keySaveCancel}
                              type="email"
                              placeholder={t("femme.clients.email")}
                              style={inputEditStyle}
                              aria-label={t("femme.clients.email")}
                            />
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <input
                            value={ed.phone ?? ""}
                            onChange={(e) => updateField("phone", e.target.value || null)}
                            onKeyDown={keySaveCancel}
                            placeholder={t("femme.clients.phone")}
                            style={inputEditStyle}
                            aria-label={t("femme.clients.phone")}
                          />
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <input
                            value={ed.ruc ?? ""}
                            onChange={(e) => updateField("ruc", e.target.value || null)}
                            onKeyDown={keySaveCancel}
                            placeholder="80000005-6"
                            style={{ ...inputEditStyle, fontFamily: "monospace" }}
                            aria-label={t("femme.clients.ruc")}
                          />
                        </td>
                        <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                          {client.visitCount}
                        </td>
                        <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                          {client.lastVisitAt ? fmtDate(client.lastVisitAt, locale) : "—"}
                        </td>
                        <td style={tdStyle}>
                          <StatusBadge status={client.active ? "ACTIVE" : "INACTIVE"} />
                        </td>
                        <td colSpan={1} style={{ padding: "8px 12px", textAlign: "right" }}>
                          <InlineEditActions
                            isEditing
                            saving={inlineSaving}
                            saveError={inlineSaveError}
                            onEdit={() => {}}
                            onSave={() => void saveEdit()}
                            onCancel={cancelEdit}
                          />
                        </td>
                      </tr>
                    );
                  }

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
                              {highlight(client.fullName) as ReactNode}
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
                                {highlight(client.email) as ReactNode}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                        {client.phone ? (highlight(client.phone) as ReactNode) : "—"}
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
                            {highlight(client.ruc) as ReactNode}
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-ink-3)" }}>
                            {t("femme.clients.noRuc")}
                          </span>
                        )}
                      </td>

                      <td style={{ ...tdStyle, color: "var(--color-ink-2)" }}>
                        {client.visitCount}
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
                          <InlineEditActions
                            isEditing={false}
                            saving={false}
                            saveError={null}
                            onEdit={() => startEdit(client)}
                            onSave={() => void saveEdit()}
                            onCancel={cancelEdit}
                            onDeactivate={() => void deactivateClient(client)}
                            isActive={client.active}
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

        {/* ── Pagination ── */}
        {searchFiltered.length > 0 && (
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
                total: searchFiltered.length,
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
