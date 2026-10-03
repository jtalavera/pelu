import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Pagination, Select, Spinner, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  discardStockOutboxEvent,
  listStockOutbox,
  retryStockOutboxEvent,
  type StockOutboxPage,
  type StockOutboxRow,
} from "../api/stock";
import { TenantSearchField, type TenantSelection } from "../components/TenantSearchField";
import { useDateLocale } from "../i18n/dateLocale";

const PAGE_SIZE = 20;

type StatusFilter = "" | "PENDING" | "PROCESSING" | "FAILED" | "DONE" | "DISCARDED";

/**
 * HU-67: "Integración con Stock" — deliveries to control-stock that are pending or failed, with
 * salon, type, attempts and last error; failed ones can be retried or discarded.
 */
export default function PlatformStockIntegrationPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [tenant, setTenant] = useState<TenantSelection>(null);
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<StockOutboxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const tenantId = tenant?.tenant.id ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listStockOutbox({ tenantId, status: status || null, page, size: PAGE_SIZE }));
    } catch (e) {
      setError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setLoading(false);
    }
  }, [tenantId, status, page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(row: StockOutboxRow, action: "retry" | "discard") {
    setActionError(null);
    setBusyId(row.id);
    try {
      if (action === "retry") await retryStockOutboxEvent(row.id);
      else await discardStockOutboxEvent(row.id);
      await load();
    } catch (e) {
      setActionError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setBusyId(null);
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(dateLocale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(iso),
        )
      : "—";

  const th = "px-3 py-2 text-left text-[11px] font-medium uppercase text-[var(--color-ink-3)]";
  const td = "px-3 py-2 align-top text-[12px] text-[var(--color-ink)]";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div>
        <Heading as="h1">{t("femme.platform.stock.title")}</Heading>
        <Text variant="muted">{t("femme.platform.stock.lead")}</Text>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full min-w-0 sm:max-w-sm">
          <TenantSearchField
            id="stock-outbox-tenant"
            value={tenant}
            onChange={(sel) => {
              setTenant(sel);
              setPage(0);
            }}
            label={t("femme.platform.stock.filterTenant")}
          />
        </div>
        <div className="w-full sm:max-w-xs">
          <label htmlFor="stock-outbox-status" className="text-sm text-[var(--color-ink-2)]">
            {t("femme.platform.stock.filterStatus")}
          </label>
          <Select
            id="stock-outbox-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(0);
            }}
            className="mt-1 w-full"
          >
            <option value="">{t("femme.platform.stock.statusOpen")}</option>
            {(["PENDING", "PROCESSING", "FAILED", "DONE", "DISCARDED"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`femme.platform.stock.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="secondary" className="min-h-11" onClick={() => void load()}>
          {t("femme.platform.stock.refresh")}
        </Button>
      </div>

      {actionError ? <Alert variant="destructive">{actionError}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {loading && !data ? (
        <div className="flex items-center gap-2">
          <Spinner size="md" />
          <Text variant="muted">{t("femme.platform.loading")}</Text>
        </div>
      ) : data && data.content.length === 0 ? (
        <Text data-testid="stock-outbox-empty">{t("femme.platform.stock.empty")}</Text>
      ) : data ? (
        <div className="overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-stone-md)] bg-[var(--color-white)]">
          <table className="w-full min-w-[760px] border-collapse" data-testid="stock-outbox-table">
            <thead>
              <tr>
                <th className={th}>{t("femme.platform.stock.colTenant")}</th>
                <th className={th}>{t("femme.platform.stock.colType")}</th>
                <th className={th}>{t("femme.platform.stock.colStatus")}</th>
                <th className={th}>{t("femme.platform.stock.colAttempts")}</th>
                <th className={th}>{t("femme.platform.stock.colLastError")}</th>
                <th className={th}>{t("femme.platform.stock.colCreated")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {data.content.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`stock-outbox-row-${row.id}`}
                  className="border-t border-[var(--color-stone-md)]"
                >
                  <td className={td}>{row.tenantName}</td>
                  <td className={td}>{t(`femme.platform.stock.type.${row.eventType}`, row.eventType)}</td>
                  <td className={td} data-testid={`stock-outbox-status-${row.id}`}>
                    {t(`femme.platform.stock.status.${row.status}`, row.status)}
                  </td>
                  <td className={td}>{row.attemptCount}</td>
                  <td className={`${td} max-w-[260px] break-words font-mono text-[11px]`}>
                    {row.lastError ?? "—"}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{fmt(row.createdAt)}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {row.status === "FAILED" ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="min-h-11"
                          disabled={busyId === row.id}
                          data-testid={`stock-outbox-retry-${row.id}`}
                          onClick={() => void act(row, "retry")}
                        >
                          {t("femme.platform.stock.retry")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="min-h-11"
                          disabled={busyId === row.id}
                          data-testid={`stock-outbox-discard-${row.id}`}
                          onClick={() => void act(row, "discard")}
                        >
                          {t("femme.platform.stock.discard")}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.totalPages > 1 ? (
        <Pagination
          page={page + 1}
          pageCount={data.totalPages}
          onPageChange={(p) => setPage(p - 1)}
          previousLabel={t("femme.pagination.previous")}
          nextLabel={t("femme.pagination.next")}
        />
      ) : null}
    </div>
  );
}
