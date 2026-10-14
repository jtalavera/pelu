import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert, Button, Card, Label, PageSizeSelect, Pagination, Select, Text } from "@design-system";
import {
  downloadCommissionFile,
  generateSettlements,
  listSettlements,
  settlementsCsvPath,
  type PagedSettlements,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate } from "../../lib/paraguayDateTime";
import { useDateLocale } from "../../i18n/dateLocale";
import { SettlementStatusBadge, TableWrap, firstOfMonthYmd, tdClass, thClass, todayYmd, useProfessionals } from "./common";

/** HU-COM-06: generate per-period settlements and list them (paginated, filterable). */
export function SettlementsTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const professionals = useProfessionals();
  const [genFrom, setGenFrom] = useState(firstOfMonthYmd());
  const [genTo, setGenTo] = useState(todayYmd());
  const [genProfessional, setGenProfessional] = useState("");
  const [filterProfessional, setFilterProfessional] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [data, setData] = useState<PagedSettlements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(
        await listSettlements({
          professionalId: filterProfessional ? Number(filterProfessional) : null,
          status: filterStatus,
          page,
          size,
        }),
      );
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [filterProfessional, filterStatus, page, size, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await generateSettlements({
        periodFrom: genFrom,
        periodTo: genTo,
        professionalIds: genProfessional ? [Number(genProfessional)] : [],
      });
      setNotice(
        created.length === 0
          ? t("femme.commissions.settlements.noneGenerated")
          : t("femme.commissions.settlements.generated", { count: created.length }),
      );
      setPage(0);
      await load();
    } catch (err) {
      setError(translateApiError(err, t));
    }
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
          <div className="flex min-w-[12rem] flex-col gap-1">
            <Label htmlFor="settle-professional">{t("femme.commissions.common.professional")}</Label>
            <Select id="settle-professional" value={genProfessional} onChange={(e) => setGenProfessional(e.target.value)}>
              <option value="">{t("femme.commissions.common.allProfessionals")}</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" data-testid="commission-generate-settlements">
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
        <div className="flex min-w-[12rem] flex-col gap-1">
          <Label htmlFor="settle-filter-professional">{t("femme.commissions.common.professional")}</Label>
          <Select
            id="settle-filter-professional"
            value={filterProfessional}
            onChange={(e) => {
              setFilterProfessional(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t("femme.commissions.common.allProfessionals")}</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        </div>
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
          onClick={() =>
            void downloadCommissionFile(settlementsCsvPath(filterStatus), "liquidaciones.csv").catch((err) =>
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
    </div>
  );
}
