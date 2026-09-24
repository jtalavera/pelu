import { beforeEach, describe, expect, it, vi } from "vitest";

const loadAppInsights = vi.fn();
const addTelemetryInitializer = vi.fn();
const trackPageView = vi.fn();
const constructorConfigs: unknown[] = [];

vi.mock("@microsoft/applicationinsights-web", () => ({
  DistributedTracingModes: { W3C: 2 },
  ApplicationInsights: class {
    constructor(options: { config: unknown }) {
      constructorConfigs.push(options.config);
    }
    loadAppInsights = loadAppInsights;
    addTelemetryInitializer = addTelemetryInitializer;
    trackPageView = trackPageView;
    trackMetric = vi.fn();
  },
}));

vi.mock("web-vitals", () => ({ onCLS: vi.fn(), onINP: vi.fn(), onLCP: vi.fn() }));

import { FRONTEND_ROLE_NAME, initTelemetry } from "./appInsights";

describe("initTelemetry (issue #268)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorConfigs.length = 0;
  });

  it("does nothing when no connection string is configured", async () => {
    expect(await initTelemetry(undefined)).toBe(false);
    expect(await initTelemetry("   ")).toBe(false);
    expect(constructorConfigs).toHaveLength(0);
    expect(loadAppInsights).not.toHaveBeenCalled();
  });

  it("starts App Insights with W3C correlation and tags telemetry as the frontend role", async () => {
    expect(await initTelemetry("InstrumentationKey=abc;IngestionEndpoint=https://x/")).toBe(true);

    expect(constructorConfigs[0]).toMatchObject({
      connectionString: "InstrumentationKey=abc;IngestionEndpoint=https://x/",
      distributedTracingMode: 2,
      enableCorsCorrelation: true,
      enableAutoRouteTracking: true,
    });
    expect(loadAppInsights).toHaveBeenCalledOnce();
    expect(trackPageView).toHaveBeenCalledOnce();

    const initializer = addTelemetryInitializer.mock.calls[0][0] as (item: {
      tags?: Record<string, string>;
      data?: Record<string, unknown>;
    }) => void;
    const item: { tags?: Record<string, string>; data?: Record<string, unknown> } = {};
    initializer(item);
    expect(item.tags?.["ai.cloud.role"]).toBe(FRONTEND_ROLE_NAME);
    expect(item.data).toHaveProperty("appVersion");
  });
});
