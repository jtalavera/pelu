import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Heading, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { Link } from "react-router-dom";
import { fetchStockOutboxSummary, type StockOutboxSummary } from "../api/stock";

type PlatformMe = { userId: number; email: string; role: string };

export default function PlatformDashboardPage() {
  const { t } = useTranslation();
  const [me, setMe] = useState<PlatformMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stockSummary, setStockSummary] = useState<StockOutboxSummary | null>(null);

  // HU-67: failed deliveries to Stock, at a glance.
  useEffect(() => {
    let cancelled = false;
    fetchStockOutboxSummary()
      .then((s) => {
        if (!cancelled) setStockSummary(s);
      })
      .catch(() => {
        if (!cancelled) setStockSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await femmeJson<PlatformMe>("/api/platform/me", { json: false });
        if (!cancelled) setMe(data);
      } catch (e) {
        if (!cancelled) setError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Heading as="h1">{t("femme.platform.dashboard.title")}</Heading>
      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="md" />
          <Text variant="muted">{t("femme.platform.loading")}</Text>
        </div>
      ) : error ? (
        <Alert variant="destructive">{error}</Alert>
      ) : (
        <>
          <Text>{t("femme.platform.dashboard.welcome", { email: me?.email ?? "" })}</Text>
          {stockSummary ? (
            <Alert
              variant={stockSummary.failed > 0 ? "destructive" : "default"}
              data-testid="platform-dashboard-stock-failed"
              title={t("femme.platform.dashboard.stockTitle")}
            >
              <span>{t("femme.platform.dashboard.stockFailed", { count: stockSummary.failed })}</span>{" "}
              <Link to="/platform/stock" className="underline">
                {t("femme.platform.dashboard.stockLink")}
              </Link>
            </Alert>
          ) : null}
          <Text variant="muted">{t("femme.platform.dashboard.comingSoon")}</Text>
        </>
      )}
    </div>
  );
}
