import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  fetchTenantStockStatus,
  requestTenantCatalogSync,
  type TenantStockStatus,
} from "../api/stock";

/**
 * HU-62: Stock block in the Platform Admin's tenant dialog — last catalog sync and a
 * "Sincronizar catálogo con Stock" button. Rendered only when the tenant has Stock.
 */
export function TenantStockSection({ tenantId, dateLocale }: { tenantId: number; dateLocale: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TenantStockStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchTenantStockStatus(tenantId));
    } catch {
      setStatus(null);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!status?.stockEnabled) return null;

  async function onSync() {
    setError(null);
    setRequested(false);
    setSyncing(true);
    try {
      setStatus(await requestTenantCatalogSync(tenantId));
      setRequested(true);
    } catch (e) {
      setError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSyncing(false);
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(dateLocale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(iso),
        )
      : t("femme.platform.tenants.stock.never");

  return (
    <div
      data-testid="tenant-stock-section"
      className="flex flex-col gap-2 rounded-[var(--radius-lg)]"
      style={{ background: "var(--color-stone)", padding: "10px 12px" }}
    >
      <Text variant="small" className="font-medium text-[var(--color-ink)]">
        {t("femme.platform.tenants.stock.title")}
      </Text>
      <Text variant="small" className="text-[var(--color-ink-3)]" data-testid="tenant-stock-last-sync">
        {t("femme.platform.tenants.stock.lastCatalogSync", { date: fmt(status.catalogSyncedAt) })}
      </Text>
      {status.failedEvents > 0 ? (
        <Text variant="small" className="text-red-600 dark:text-red-400" role="alert">
          {t("femme.platform.tenants.stock.failedEvents", { count: status.failedEvents })}
        </Text>
      ) : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          data-testid="tenant-stock-catalog-sync"
          disabled={syncing}
          onClick={() => void onSync()}
        >
          {syncing ? t("femme.platform.tenants.stock.syncing") : t("femme.platform.tenants.stock.syncCatalog")}
        </Button>
      </div>
      {requested ? (
        <Alert variant="success" data-testid="tenant-stock-sync-requested">
          {t("femme.platform.tenants.stock.syncRequested")}
        </Alert>
      ) : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
