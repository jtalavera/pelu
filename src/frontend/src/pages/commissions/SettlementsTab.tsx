import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert, Button, Card, Label, Modal, MultiSelect, PageSizeSelect, Pagination, Select, Text } from "@design-system";
import {
  checkSettlementGeneration,
  downloadCommissionFile,
  generateSettlements,
  listSettlements,
  settlementsCsvPath,
  type GenerateSettlementsBody,
  type PagedSettlements,
  type SettlementGenerationCheck,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate } from "../../lib/paraguayDateTime";
import { useDateLocale } from "../../i18n/dateLocale";
import { SettlementStatusBadge, TableWrap, firstOfMonthYmd, tdClass, thClass, todayYmd, useProfessionals } from "./common";

/** HU-COM-06: generate per-period settlements and list them (paginated, filterable). */
export function SettlementsTab() {
  const { t, i18n } = useTranslation();
  const dateLocale = useDateLocale();
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

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const body: GenerateSettlementsBody = { periodFrom: genFrom, periodTo: genTo, professionalIds: genProfessionals };
    setGenerating(true);
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

  return (
    <div className="flex flex-col gap-4" data-testid="commission-settlements">
      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-base font-medium">{t("femme.commissions.settlements.generateTitle")}</h3>
        <form onSubmit={(e) => void generate(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="settle-from">{t("femme.commissions.common.from")}</Label>
            <LocalizedDateInput id="settle-from" value={genFrom} onChange={setGenFrom} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="settle-to">{t("femme.commissions.common.to")}</Label>
            <LocalizedDateInput id="settle-to" value={genTo} onChange={setGenTo} />
          </div>
          <MultiSelect
            id="settle-professional"
            className="min-w-[14rem]"
            label={t("femme.commissions.common.professionals")}
            value={genProfessionals}
            onChange={setGenProfessionals}
            options={professionalOptions}
            placeholder={t("femme.commissions.common.allProfessionals")}
            filterPlaceholder={t("femme.commissions.common.filterProfessionals")}
            noResultsText={t("femme.commissions.common.noProfessionals")}
            summaryTemplate={t("femme.commissions.common.professionalsSelected")}
          />
          <Button type="submit" disabled={generating} data-testid="commission-generate-settlements">
            {t("femme.commissions.settlements.generate")}
          </Button>
        </form>
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.settlements.generateHint")}
        </Text>
      </Card>
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <MultiSelect
          id="settle-filter-professional"
          className="min-w-[14rem]"
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="settle-filter-status">{t("femme.commissions.common.status")}</Label>
          <Select
            id="settle-filter-status"
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t("femme.commissions.common.allStatuses")}</option>
            {["DRAFT", "APPROVED", "PAID", "VOIDED"].map((s) => (
              <option key={s} value={s}>
                {t(`femme.commissions.settlementStatus.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={filterProfessionals.length === 0 && !filterStatus}
          onClick={clearFilters}
          data-testid="settlements-clear-filters"
        >
          {t("femme.commissions.common.clearFilters")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void downloadCommissionFile(
              settlementsCsvPath({ status: filterStatus, professionalIds: filterProfessionals }, i18n.language),
              "liquidaciones.csv",
            ).catch((err) =>
              setError(translateApiError(err, t)),
            )
          }
        >
          {t("femme.commissions.common.exportCsv")}
        </Button>
      </div>

      {data && data.items.length === 0 ? (
        <Text variant="muted">{t("femme.commissions.settlements.empty")}</Text>
      ) : (
        <TableWrap testId="commission-settlements-table">
          <thead>
            <tr>
              <th className={thClass}>#</th>
              <th className={thClass}>{t("femme.commissions.common.professional")}</th>
              <th className={thClass}>{t("femme.commissions.settlements.period")}</th>
              <th className={thClass}>{t("femme.commissions.common.status")}</th>
              <th className={`${thClass} text-right`}>{t("femme.commissions.common.total")}</th>
              <th className={thClass} />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id} className="border-t" data-testid="commission-settlement-row">
                <td className={tdClass}>{s.id}</td>
                <td className={tdClass}>{s.professionalName}</td>
                <td className={tdClass}>
                  {formatParaguayDate(s.periodFrom + "T12:00:00", dateLocale)} – {formatParaguayDate(s.periodTo + "T12:00:00", dateLocale)}
                </td>
                <td className={tdClass}>
                  <SettlementStatusBadge status={s.status} />
                </td>
                <td className={`${tdClass} text-right`}>{formatGuaraniesGs(s.totalAmount)}</td>
                <td className={tdClass}>
                  <Link className="underline" to={`/app/commissions/settlements/${s.id}`}>
                    {t("femme.commissions.settlements.open")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageSizeSelect
            value={size}
            onChange={(s) => {
              setSize(s);
              setPage(0);
            }}
            label={t("femme.pagination.rowsPerPage")}
          />
          <Text variant="small" className="text-[var(--color-ink-3)]">
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
