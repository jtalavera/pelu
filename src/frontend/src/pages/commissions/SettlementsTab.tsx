import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Label, Modal, MultiSelect, PageSizeSelect, Pagination, Text } from "@design-system";
import {
  checkSettlementGeneration,
  downloadCommissionFile,
  getSettings,
  generateSettlements,
  listSettlements,
  settlementsCsvPath,
  type GenerateSettlementsBody,
  type PagedSettlements,
  type SettingsResponse,
  type SettlementGenerationCheck,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate } from "../../lib/paraguayDateTime";
import { useDateLocale } from "../../i18n/dateLocale";
import { SettlementStatusBadge, firstOfMonthYmd, todayYmd, useProfessionals } from "./common";

const STATUS_CHIPS = ["", "DRAFT", "APPROVED", "PAID", "VOIDED"] as const;

const initials = (name: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** HU-COM-06: generate per-period settlements and list them (paginated, filterable). */
export function SettlementsTab({ actionSlot }: { actionSlot: HTMLElement | null }) {
  const { t, i18n } = useTranslation();
  const dateLocale = useDateLocale();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const professionals = useProfessionals();
  const [genFrom, setGenFrom] = useState(firstOfMonthYmd());
  const [genTo, setGenTo] = useState(todayYmd());
  const [genProfessionals, setGenProfessionals] = useState<number[]>([]);
  const [filterProfessionals, setFilterProfessionals] = useState<number[]>([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [data, setData] = useState<PagedSettlements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Generation blocked by existing settlements: the user picks «only the rest» or «none». */
  const [conflict, setConflict] = useState<{ body: GenerateSettlementsBody; check: SettlementGenerationCheck } | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);
  const professionalOptions = professionals.map((p) => ({ value: p.id, label: p.fullName }));

  const load = useCallback(async () => {
    try {
      setData(
        await listSettlements({
          professionalIds: filterProfessionals,
          status: filterStatus,
          page,
          size,
        }),
      );
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [filterProfessionals, filterStatus, page, size, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        // Pre-fill the dialog with the current settlement period (falls back to month-to-date).
        if (s.currentPeriod.from && s.currentPeriod.to) {
          setGenFrom(s.currentPeriod.from);
          setGenTo(s.currentPeriod.to);
        }
      })
      .catch(() => setSettings(null));
  }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const body: GenerateSettlementsBody = { periodFrom: genFrom, periodTo: genTo, professionalIds: genProfessionals };
    setGenerating(true);
    setGenerateOpen(false);
    try {
      // Someone already settled in the period (e.g. a Paid one) → ask instead of failing for everyone.
      const check = await checkSettlementGeneration(body);
      if (check.conflicts.length > 0) {
        setConflict({ body, check });
        return;
      }
      await runGeneration(body);
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setGenerating(false);
    }
  }

  async function runGeneration(body: GenerateSettlementsBody) {
    const created = await generateSettlements(body);
    setNotice(
      created.length === 0
        ? t("femme.commissions.settlements.noneGenerated")
        : t("femme.commissions.settlements.generated", { count: created.length }),
    );
    setPage(0);
    await load();
  }

  async function generateRemaining() {
    if (!conflict) return;
    const body = { ...conflict.body, skipOverlapping: true };
    setConflict(null);
    setGenerating(true);
    try {
      await runGeneration(body);
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setGenerating(false);
    }
  }

  function clearFilters() {
    setFilterProfessionals([]);
    setFilterStatus("");
    setPage(0);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const periodRange = settings?.currentPeriod.from && settings.currentPeriod.to
    ? `${formatParaguayDate(settings.currentPeriod.from + "T12:00:00", dateLocale)} – ${formatParaguayDate(settings.currentPeriod.to + "T12:00:00", dateLocale)}`
    : null;

  return (
    <div className="flex flex-col gap-3" data-testid="commission-settlements">
      {actionSlot &&
        createPortal(
          <Button
            type="button"
            className="min-h-11"
            disabled={generating}
            onClick={() => setGenerateOpen(true)}
            data-testid="commission-generate-open"
          >
            {t("femme.commissions.settlements.generateTitle")}
          </Button>,
          actionSlot,
        )}
      {settings && (
        <p className="px-0.5 text-sm text-ink-3" data-testid="settlements-period-line">
          {t("femme.commissions.settlements.periodLine", {
            periodicity: t(`femme.commissions.periodicity.${settings.periodicity}`),
            range: periodRange ?? "—",
          })}
        </p>
      )}
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("femme.commissions.common.status")}>
        {STATUS_CHIPS.map((s) => (
          <button
            key={s || "ALL"}
            type="button"
            aria-pressed={filterStatus === s}
            data-testid={`settlements-chip-${s || "ALL"}`}
            onClick={() => {
              setFilterStatus(s);
              setPage(0);
            }}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
              filterStatus === s ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink hover:bg-bg"
            }`}
          >
            {s ? t(`femme.commissions.settlementStatus.${s}`) : t("femme.commissions.common.allStatuses")}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-expanded={filtersOpen}
        aria-controls="settlements-filters"
        data-testid="settlements-filters-toggle"
        onClick={() => setFiltersOpen((o) => !o)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink"
      >
        {t("femme.commissions.settlements.filtersToggle")}
        <span aria-hidden className={`text-ink-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {filtersOpen && (
        <div id="settlements-filters" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <MultiSelect
            id="settle-filter-professional"
            label={t("femme.commissions.common.professionals")}
            value={filterProfessionals}
            onChange={(ids) => {
              setFilterProfessionals(ids);
              setPage(0);
            }}
            options={professionalOptions}
            placeholder={t("femme.commissions.common.allProfessionals")}
            filterPlaceholder={t("femme.commissions.common.filterProfessionals")}
            noResultsText={t("femme.commissions.common.noProfessionals")}
            summaryTemplate={t("femme.commissions.common.professionalsSelected")}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={filterProfessionals.length === 0 && !filterStatus}
              onClick={clearFilters}
              data-testid="settlements-clear-filters"
            >
              {t("femme.commissions.common.clearFilters")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() =>
                void downloadCommissionFile(
                  settlementsCsvPath({ status: filterStatus, professionalIds: filterProfessionals }, i18n.language),
                  "liquidaciones.csv",
                ).catch((err) => setError(translateApiError(err, t)))
              }
            >
              {t("femme.commissions.common.exportCsv")}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-card border border-line bg-surface shadow-sm">
        {data && data.items.length === 0 ? (
          <Text variant="muted" className="p-4">
            {t("femme.commissions.settlements.empty")}
          </Text>
        ) : (
          <ul data-testid="commission-settlements-table">
            {data?.items.map((s) => (
              <li
                key={s.id}
                role="button"
                tabIndex={0}
                data-testid="commission-settlement-row"
                aria-label={t("femme.commissions.settlements.openAria", { id: s.id, name: s.professionalName ?? "" })}
                onClick={() => navigate(`/app/commissions/settlements/${s.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/app/commissions/settlements/${s.id}`);
                  }
                }}
                className="grid min-h-14 cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-3 py-2 first:border-t-0 hover:bg-bg"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-full bg-primary-lt text-xs font-heading font-extrabold text-primary"
                >
                  {initials(s.professionalName)}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{s.professionalName}</div>
                  <div className="flex flex-wrap items-center gap-x-2 text-sm text-ink-3">
                    <span>
                      #{s.id} · {formatParaguayDate(s.periodFrom + "T12:00:00", dateLocale)} –{" "}
                      {formatParaguayDate(s.periodTo + "T12:00:00", dateLocale)}
                    </span>
                    <SettlementStatusBadge status={s.status} />
                  </div>
                </div>
                <span className="text-right font-heading font-extrabold tabular-nums text-ink">
                  {formatGuaraniesGs(s.totalAmount)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 0 && (
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
                to: Math.min((page + 1) * size, data.total),
                total: data.total,
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

      <Modal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        title={t("femme.commissions.settlements.generateTitle")}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={() => setGenerateOpen(false)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="submit"
              form="settlements-generate-form"
              className="min-h-11 w-full sm:w-auto"
              disabled={generating}
              data-testid="commission-generate-settlements"
            >
              {t("femme.commissions.settlements.generate")}
            </Button>
          </>
        }
      >
        <form id="settlements-generate-form" onSubmit={(e) => void generate(e)} className="flex flex-col gap-3">
          <Text variant="small" className="text-ink-3">
            {t("femme.commissions.settlements.generateHint")}
          </Text>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="settle-from">{t("femme.commissions.common.from")}</Label>
              <LocalizedDateInput id="settle-from" value={genFrom} onChange={setGenFrom} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="settle-to">{t("femme.commissions.common.to")}</Label>
              <LocalizedDateInput id="settle-to" value={genTo} onChange={setGenTo} />
            </div>
          </div>
          <MultiSelect
            id="settle-professional"
            label={t("femme.commissions.common.professionals")}
            value={genProfessionals}
            onChange={setGenProfessionals}
            options={professionalOptions}
            placeholder={t("femme.commissions.common.allProfessionals")}
            filterPlaceholder={t("femme.commissions.common.filterProfessionals")}
            noResultsText={t("femme.commissions.common.noProfessionals")}
            summaryTemplate={t("femme.commissions.common.professionalsSelected")}
          />
        </form>
      </Modal>
      <Modal
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title={t("femme.commissions.settlements.conflict.title")}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => setConflict(null)}
              data-testid="settlements-conflict-none"
            >
              {t("femme.commissions.settlements.conflict.none")}
            </Button>
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              disabled={!conflict || conflict.check.generatable === 0}
              onClick={() => void generateRemaining()}
              data-testid="settlements-conflict-remaining"
            >
              {t("femme.commissions.settlements.conflict.remaining", { count: conflict?.check.generatable ?? 0 })}
            </Button>
          </>
        }
      >
        {conflict && (
          <div className="flex flex-col gap-3" data-testid="settlements-conflict">
            <Text>{t("femme.commissions.settlements.conflict.intro")}</Text>
            <ul className="flex flex-col divide-y rounded-md border text-sm">
              {conflict.check.conflicts.map((c) => (
                <li
                  key={c.professionalId}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  data-testid="settlements-conflict-row"
                >
                  <span className="min-w-0 break-words font-medium">{c.professionalName}</span>
                  <span className="flex items-center gap-2 text-xs text-[var(--color-ink-3)]">
                    #{c.settlementId} · {formatParaguayDate(c.periodFrom + "T12:00:00", dateLocale)} –{" "}
                    {formatParaguayDate(c.periodTo + "T12:00:00", dateLocale)}
                    <SettlementStatusBadge status={c.status} />
                  </span>
                </li>
              ))}
            </ul>
            <Text variant="small" className="text-[var(--color-ink-3)]">
              {conflict.check.generatable === 0
                ? t("femme.commissions.settlements.conflict.nothingElse")
                : t("femme.commissions.settlements.conflict.question", { count: conflict.check.generatable })}
            </Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
