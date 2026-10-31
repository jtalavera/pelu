import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, KebabMenu, Label, MultiSelect, PageSizeSelect, Pagination, Text } from "@design-system";
import { getEntries, type EntryFilters, type EntryView } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ReassignDialog } from "./ReassignDialog";
import { SettlementStatusBadge, firstOfMonthYmd, formatPercent, todayYmd, useProfessionals } from "./common";

const initials = (name: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Every commission movement, with «Cambiar profesional» on the live ones. */
export function MovementsTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const professionals = useProfessionals();
  const [from, setFrom] = useState(firstOfMonthYmd());
  const [to, setTo] = useState(todayYmd());
  const [professionalIds, setProfessionalIds] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [entries, setEntries] = useState<EntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toReassign, setToReassign] = useState<EntryView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);

  const load = useCallback(
    async (filters?: EntryFilters) => {
      try {
        setEntries(await getEntries(filters ?? { from, to, professionalIds }));
        setError(null);
      } catch (err) {
        setError(translateApiError(err, t));
      }
    },
    [from, to, professionalIds, t],
  );

  /** Back to the defaults (this month, every professional, no text) and search again. */
  function clearFilters() {
    const defaults = { from: firstOfMonthYmd(), to: todayYmd(), professionalIds: [] as number[] };
    setFrom(defaults.from);
    setTo(defaults.to);
    setProfessionalIds(defaults.professionalIds);
    setQuery("");
    setAppliedQuery("");
    setPage(0);
    void load(defaults);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    const list = entries ?? [];
    if (!q) return list;
    return list.filter(
      (e) => (e.invoiceNumber ?? "").toLowerCase().includes(q) || (e.itemName ?? "").toLowerCase().includes(q),
    );
  }, [entries, appliedQuery]);

  function movementLabel(e: EntryView): string {
    if (e.sourceType === "INVOICE_LINE") return t("femme.commissions.movements.type.LINE");
    if (e.sourceType === "REVERSAL") return t(`femme.commissions.reason.${e.reasonCode ?? "VOID"}`);
    return t(`femme.commissions.reason.${e.reasonCode ?? "MANUAL_ADJUSTMENT"}`);
  }

  const pageItems = visible.slice(page * size, (page + 1) * size);
  const totalPages = Math.max(1, Math.ceil(visible.length / size));

  return (
    <div className="flex flex-col gap-3" data-testid="commission-movements">
      <form
        className="flex flex-col gap-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQuery(query);
          setPage(0);
          void load();
        }}
      >
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="mov-query" className="sr-only">
              {t("femme.commissions.movements.search")}
            </Label>
            <Input
              id="mov-query"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("femme.commissions.movements.searchPlaceholder")}
            />
          </div>
          <Button type="submit" className="min-h-11" data-testid="movements-search">
            {t("femme.commissions.common.search")}
          </Button>
        </div>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="movements-filters"
          data-testid="movements-filters-toggle"
          onClick={() => setFiltersOpen((o) => !o)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink"
        >
          {t("femme.commissions.movements.filtersToggle")}
          <span aria-hidden className={`text-ink-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
        {filtersOpen && (
          <div id="movements-filters" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="mov-from">{t("femme.commissions.common.from")}</Label>
                <LocalizedDateInput id="mov-from" value={from} onChange={setFrom} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="mov-to">{t("femme.commissions.common.to")}</Label>
                <LocalizedDateInput id="mov-to" value={to} onChange={setTo} />
              </div>
            </div>
            <MultiSelect
              id="mov-professional"
              label={t("femme.commissions.common.professionals")}
              value={professionalIds}
              onChange={setProfessionalIds}
              options={professionals.map((p) => ({ value: p.id, label: p.fullName }))}
              placeholder={t("femme.commissions.common.allProfessionals")}
              filterPlaceholder={t("femme.commissions.common.filterProfessionals")}
              noResultsText={t("femme.commissions.common.noProfessionals")}
              summaryTemplate={t("femme.commissions.common.professionalsSelected")}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11">
                {t("femme.commissions.common.search")}
              </Button>
              <Button type="button" variant="secondary" className="min-h-11" onClick={clearFilters} data-testid="movements-clear-filters">
                {t("femme.commissions.common.clearFilters")}
              </Button>
            </div>
          </div>
        )}
      </form>
      <Text variant="small" className="text-ink-3">
        {t("femme.commissions.movements.hint")}
      </Text>
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="rounded-card border border-line bg-surface shadow-sm" data-testid="movements-table">
        {entries && visible.length === 0 ? (
          <Text variant="muted" className="p-4">
            {t("femme.commissions.movements.empty")}
          </Text>
        ) : (
          <ul>
            {pageItems.map((e) => (
              <li
                key={e.id}
                data-testid="movement-row"
                className="grid min-h-14 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-3 py-2 first:border-t-0"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-full bg-primary-lt text-xs font-heading font-extrabold text-primary"
                >
                  {initials(e.professionalName)}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">
                    {e.itemName ?? e.note} · {e.professionalName}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-sm text-ink-3">
                    <span>
                      {formatParaguayDateTime(e.accrualAt, dateLocale)}
                      {e.invoiceNumber ? ` · ${e.invoiceNumber}` : ""} · {movementLabel(e)} · {formatPercent(e.percentApplied)}
                    </span>
                    <SettlementStatusBadge status={e.settlementStatus} />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`text-right font-heading font-extrabold tabular-nums ${e.commissionAmount < 0 ? "text-danger" : "text-ink"}`}
                  >
                    {formatGuaraniesGs(e.commissionAmount)}
                  </span>
                  {e.reassignable ? (
                    <KebabMenu
                      id={`movement-${e.id}`}
                      triggerAriaLabel={t("femme.commissions.movements.rowActions")}
                      items={[
                        {
                          id: "reassign",
                          label: t("femme.commissions.reassign.action"),
                          onSelect: () => setToReassign(e),
                        },
                      ]}
                    />
                  ) : (
                    <span className="w-11" aria-hidden />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {visible.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-3">
            <PageSizeSelect
              value={size}
              onChange={(s) => {
                setSize(s);
                setPage(0);
              }}
              label={t("femme.pagination.rowsPerPage")}
            />
            <Text variant="small" className="text-ink-3">
              {t("femme.pagination.showingRange", {
                from: page * size + 1,
                to: Math.min((page + 1) * size, visible.length),
                total: visible.length,
              })}
            </Text>
            <Pagination
              page={page + 1}
              pageCount={totalPages}
              onPageChange={(p) => setPage(p - 1)}
              previousLabel={t("femme.pagination.previous")}
              nextLabel={t("femme.pagination.next")}
            />
          </div>
        )}
      </div>
      <ReassignDialog
        entry={toReassign}
        onClose={() => setToReassign(null)}
        onDone={() => {
          setToReassign(null);
          setNotice(t("femme.commissions.reassign.done"));
          void load();
        }}
      />
    </div>
  );
}
