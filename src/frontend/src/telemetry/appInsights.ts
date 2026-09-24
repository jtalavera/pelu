import { APP_VERSION } from "../lib/appVersion";

/** `cloud_RoleName` that tells frontend telemetry apart from the backend's ("femme-backend"). */
export const FRONTEND_ROLE_NAME = "femme-frontend";

/**
 * Issue #268: browser RUM into the same Application Insights resource the backend's Java agent
 * reports to. Page views (incl. SPA route changes), unhandled exceptions and fetch/XHR timings are
 * captured automatically; W3C `traceparent` headers on API calls stitch each browser action into
 * the backend's distributed trace. Core Web Vitals (LCP, CLS, INP) are sent as custom metrics.
 *
 * No-op — and the SDK is never downloaded — unless `VITE_APPINSIGHTS_CONNECTION_STRING` was set at
 * build time (CI deploys only; local dev, Vitest and Playwright leave it unset). The connection
 * string is an ingestion endpoint, not a secret.
 *
 * @returns whether telemetry was started
 */
export async function initTelemetry(
  connectionString: string | undefined = import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING,
): Promise<boolean> {
  if (!connectionString?.trim()) {
    return false;
  }
  const [{ ApplicationInsights, DistributedTracingModes }, { onCLS, onINP, onLCP }] =
    await Promise.all([import("@microsoft/applicationinsights-web"), import("web-vitals")]);

  const appInsights = new ApplicationInsights({
    config: {
      connectionString,
      distributedTracingMode: DistributedTracingModes.W3C,
      enableCorsCorrelation: true,
      enableAutoRouteTracking: true,
      enableRequestHeaderTracking: false,
      enableResponseHeaderTracking: false,
      disableFetchTracking: false,
    },
  });
  appInsights.loadAppInsights();
  appInsights.addTelemetryInitializer((item) => {
    item.tags = item.tags ?? {};
    item.tags["ai.cloud.role"] = FRONTEND_ROLE_NAME;
    item.data = { ...item.data, appVersion: APP_VERSION };
  });
  // The initial page view; later ones come from enableAutoRouteTracking (history API changes).
  appInsights.trackPageView();

  const reportVital = (metric: { name: string; value: number; rating: string }) =>
    appInsights.trackMetric(
      { name: `webvitals.${metric.name.toLowerCase()}`, average: metric.value },
      { rating: metric.rating },
    );
  onLCP(reportVital);
  onCLS(reportVital);
  onINP(reportVital);
  return true;
}
