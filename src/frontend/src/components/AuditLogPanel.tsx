import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, PageSizeSelect, Pagination, Select, Spinner, Text } from "@design-system";
import { listAuditLog, type AuditLogRow } from "../api/audit";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useDateLocale } from "../i18n/dateLocale";

/** Resources the "Qué" filter offers (the first literal segment of the audited endpoints). */
const SALON_RESOURCES = [
  "appointments",
  "business-profile",
  "cash-sessions",
  "clients",
  "fiscal-stamps",
  "invoices",
  "me",
  "professionals",
  "propinas",
  "service-categories",
  "service-records",
  "services",
  "sifen",
  "taxes",
] as const;
const PLATFORM_ONLY_RESOURCES = ["feature-flags", "stock", "tenants", "tiers"] as const;

const VERB_BY_METHOD: Record<string, string> = {
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

/**
 * Issue #284: the audit trail ("quién hizo qué"), newest first. Two modes, one component:
 *  - **salon** (default): the administrator's own salon only (`GET /api/audit`);
 *  - **platform**: the root user's view across every salon, with the salon in each row
 *    (`GET /api/platform/audit`).
 * Each row reads as a sentence — "<user> · <what> · #<record> · <when>" — and never shows a
 * request body (none is stored).
 */
export function AuditLogPanel({ platform = false }: { platform?: boolean }) {
  const { t, i18n } = useTranslation();
  const dateLocale = useDateLocale();

  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalElements, setTotalElements] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Applied filters (what the last search used) vs. the form's draft values.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [applied, setApplied] = useState({ from: "", to: "", resource: "", q: "" });
  const [draft, setDraft] = useState({ from: "", to: "", resource: "", q: "" });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAuditLog({ platform, ...applied, page, size: pageSize });
      setRows(res.content);
      setTotalElements(res.totalElements);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(translateApiError(err, t, "femme.audit.loadError"));
    } finally {
      setLoading(false);
    }
  }, [platform, applied, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setRangeError(t("femme.audit.rangeInvalid"));
      return;
    }
    setRangeError(null);
    setPage(0);
    setApplied({ ...draft });
  }

  function onClear() {
    const empty = { from: "", to: "", resource: "", q: "" };
    setRangeError(null);
    setDraft(empty);
    setApplied(empty);
    setPage(0);
  }

  function actionLabel(row: AuditLogRow): string {
    const opKey = row.operation ? `femme.audit.operations.${row.resource}_${row.operation}` : null;
    if (opKey && i18n.exists(opKey)) return t(opKey);
    const verb = t(`femme.audit.verbs.${VERB_BY_METHOD[row.httpMethod] ?? "update"}`);
    const resource = t(`femme.audit.resources.${row.resource}`, { defaultValue: row.resource });
    return row.operation
      ? `${verb} ${resource} · ${row.operation}`
      : `${verb} ${resource}`;
  }

  function fmtDateTime(iso: string): string {
    try {
      return new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      );
    } catch {
      return iso;
    }
  }

  const resources = platform ? [...SALON_RESOURCES, ...PLATFORM_ONLY_RESOURCES] : SALON_RESOURCES;
  const showingFrom = totalElements === 0 ? 0 : page * pageSize + 1;
  const showingTo = Math.min(totalElements, (page + 1) * pageSize);

  return (
    <div className="flex flex-col gap-3" data-testid="audit-log-panel">
      <form role="search" onSubmit={onSearch} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="audit-user" className="sr-only">
              {t("femme.audit.filterUser")}
            </Label>
            <Input
              id="audit-user"
              type="search"
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              placeholder={t("femme.audit.filterUserPlaceholder")}
            />
          </div>
          <Button type="submit" className="min-h-11" data-testid="audit-search">
            {t("femme.audit.search")}
          </Button>
        </div>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="audit-filters"
          data-testid="audit-filters-toggle"
          onClick={() => setFiltersOpen((o) => !o)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink"
        >
          {t("femme.audit.filtersToggle")}
          <span aria-hidden className={`text-ink-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
        {filtersOpen ? (
          <div id="audit-filters" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="audit-from">{t("femme.audit.filterFrom")}</Label>
                <Input
                  id="audit-from"
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  invalid={!!rangeError}
                  aria-describedby={rangeError ? "audit-range-err" : undefined}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="audit-to">{t("femme.audit.filterTo")}</Label>
                <Input
                  id="audit-to"
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  invalid={!!rangeError}
                  aria-describedby={rangeError ? "audit-range-err" : undefined}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="audit-resource">{t("femme.audit.filterResource")}</Label>
              <Select
                id="audit-resource"
                value={draft.resource}
                onChange={(e) => setDraft((d) => ({ ...d, resource: e.target.value }))}
              >
                <option value="">{t("femme.audit.filterResourceAll")}</option>
                {resources.map((r) => (
                  <option key={r} value={r}>
                    {t(`femme.audit.resources.${r}`, { defaultValue: r })}
                  </option>
                ))}
              </Select>
            </div>
            {rangeError ? (
              <p id="audit-range-err" role="alert" className="text-sm font-medium text-danger">
                {rangeError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" className="min-h-11">
                {t("femme.audit.search")}
              </Button>
              <Button type="button" variant="ghost" className="min-h-11" onClick={onClear}>
                {t("femme.audit.clear")}
              </Button>
            </div>
          </div>
        ) : null}
      </form>

      {error ? (
        <Alert variant="destructive" title={t("femme.audit.errorTitle")}>
          {error}
        </Alert>
      ) : null}

      <div className="rounded-card border border-line bg-surface shadow-sm">
        {loading ? (
          <div className="flex items-center gap-3 p-4">
            <Spinner size="md" />
            <Text>{t("femme.audit.loading")}</Text>
          </div>
        ) : rows.length === 0 ? (
          <Text variant="muted" className="p-4" data-testid="audit-empty">
            {t("femme.audit.empty")}
          </Text>
        ) : (
          <ul data-testid="audit-table">
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid="audit-row"
                data-resource={row.resource}
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2.5 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-ink" data-testid="audit-row-action">
                    {actionLabel(row)}
                  </div>
                  <div className="text-sm text-ink-3">
                    {platform ? `${row.tenantName ?? t("femme.audit.platformScope")} · ` : ""}
                    <span data-testid="audit-row-user">{row.userEmail ?? "—"}</span>
                    {row.userRole
                      ? ` (${t(`femme.audit.roles.${row.userRole}`, { defaultValue: row.userRole })})`
                      : ""}
                    {" · "}
                    {fmtDateTime(row.createdAt)}
                  </div>
                </div>
                <span className="text-sm tabular-nums text-ink-3">{row.entityId ? `#${row.entityId}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <PageSizeSelect
            value={pageSize}
            onChange={(s) => {
              setPageSize(s);
              setPage(0);
            }}
            label={t("femme.pagination.rowsPerPage")}
          />
          <Text variant="small" className="text-ink-3">
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
    </div>
  );
}
