import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Heading, Spinner, Switch, Text } from "@design-system";
import { femmeJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useMe } from "../hooks/useMe";

type GlobalFlag = {
  flagKey: string;
  enabled: boolean;
  description: string | null;
};

/**
 * HU-49 AC-1: the Platform Admin sees and edits the platform-wide default (enabled/disabled) of
 * every feature flag. Lives under `/platform/global-feature-flags` (mounted inside `PlatformShell`,
 * gated to `PLATFORM_ADMIN` by `PlatformAdminRoute`). The per-tenant view (`FeatureFlagsPage`,
 * "Funcionalidades Tenants") shows this value read-only and links here to edit it.
 */
export default function PlatformGlobalFeatureFlagsPage() {
  const { t } = useTranslation();
  const { me } = useMe();
  const isPlatformAdmin = me?.role === "PLATFORM_ADMIN";

  const [flags, setFlags] = useState<GlobalFlag[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setLoadError(null);
    try {
      const data = await femmeJson<GlobalFlag[]>("/api/admin/feature-flags", { json: false });
      setFlags(data);
    } catch (e) {
      setFlags(null);
      setLoadError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    }
  }, [isPlatformAdmin, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setEnabled(flag: GlobalFlag, enabled: boolean) {
    setActionError(null);
    setBusyKey(flag.flagKey);
    try {
      await femmePutJson(`/api/admin/feature-flags/${encodeURIComponent(flag.flagKey)}`, {
        enabled,
        description: flag.description ?? undefined,
      });
      await load();
    } catch (e) {
      setActionError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setBusyKey(null);
    }
  }

  if (!isPlatformAdmin) {
    return (
      <div>
        <Heading as="h2" className="text-[var(--color-ink)]">
          {t("femme.globalFeatureFlags.title")}
        </Heading>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]" role="alert">
          {t("femme.globalFeatureFlags.forbidden")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-6">
        <Heading as="h2" className="text-[var(--color-ink)]">
          {t("femme.globalFeatureFlags.title")}
        </Heading>
        <Text variant="small" className="mt-1 text-[var(--color-ink-3)]">
          {t("femme.globalFeatureFlags.subtitle")}
        </Text>
      </div>

      {loadError ? (
        <Alert variant="destructive" className="mb-4" title={t("femme.globalFeatureFlags.errorTitle")}>
          {loadError}
        </Alert>
      ) : null}

      {actionError ? (
        <Alert
          variant="destructive"
          className="mb-4"
          title={t("femme.globalFeatureFlags.errorTitle")}
        >
          {actionError}
        </Alert>
      ) : null}

      {flags == null && !loadError ? (
        <div className="flex items-center gap-2 text-[var(--color-ink-2)]">
          <Spinner size="sm" />
          <Text variant="small">{t("femme.globalFeatureFlags.loading")}</Text>
        </div>
      ) : null}

      {flags != null ? (
        <ul className="flex flex-col gap-3" data-testid="global-feature-flags-list">
          {flags.map((flag) => {
            const busy = busyKey === flag.flagKey;
            return (
              <li
                key={flag.flagKey}
                data-testid={`global-flag-row-${flag.flagKey}`}
                className="flex items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-stone-md)] bg-[var(--color-white)] p-4 dark:border-slate-600 dark:bg-slate-900/30"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs font-medium text-[var(--color-ink)]">
                    {flag.flagKey}
                  </div>
                  {flag.description ? (
                    <p className="mt-1 text-sm text-[var(--color-ink-2)]">{flag.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm text-[var(--color-ink-2)]">
                    {flag.enabled
                      ? t("femme.globalFeatureFlags.stateOn")
                      : t("femme.globalFeatureFlags.stateOff")}
                  </span>
                  <Switch
                    checked={flag.enabled}
                    disabled={busy}
                    onChange={() => void setEnabled(flag, !flag.enabled)}
                    id={`global-flag-${flag.flagKey}`}
                    aria-label={t("femme.globalFeatureFlags.toggleAria", { key: flag.flagKey })}
                  />
                </div>
              </li>
            );
          })}
          {flags.length === 0 ? (
            <li className="text-sm text-[var(--color-ink-3)]">
              {t("femme.globalFeatureFlags.empty")}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
