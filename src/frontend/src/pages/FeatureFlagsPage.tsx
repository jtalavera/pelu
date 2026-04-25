import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Spinner, Switch, Text } from "@design-system";
import { femmeDeleteJson, femmeJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useFeatureFlagsState } from "../hooks/useFeatureFlags";
import { useMe } from "../hooks/useMe";

type TenantRow = {
  flagKey: string;
  description: string | null;
  globalEnabled: boolean;
  hasOverride: boolean;
  overrideEnabled: boolean | null;
};

export default function FeatureFlagsPage() {
  const { t } = useTranslation();
  const { me } = useMe();
  const { refetch: refetchFlags } = useFeatureFlagsState();
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isAdmin = me?.role === "ADMIN";
  const tenantId = me?.tenantId;

  const load = useCallback(async () => {
    if (!isAdmin || tenantId == null) return;
    setLoadError(null);
    try {
      const data = await femmeJson<TenantRow[]>(
        `/api/admin/feature-flags/tenants/${tenantId}`,
        { json: false },
      );
      setRows(data);
    } catch (e) {
      setRows(null);
      setLoadError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    }
  }, [isAdmin, t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setGlobalEnabled(flagKey: string, enabled: boolean, description: string | null) {
    if (tenantId == null) return;
    setActionError(null);
    setBusyKey(flagKey);
    try {
      await femmePutJson(`/api/admin/feature-flags/${encodeURIComponent(flagKey)}`, {
        enabled,
        description: description ?? undefined,
      });
      await load();
      await refetchFlags();
    } catch (e) {
      setActionError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setBusyKey(null);
    }
  }

  async function setTenantOverride(flagKey: string, enabled: boolean) {
    if (tenantId == null) return;
    setActionError(null);
    setBusyKey(flagKey);
    try {
      await femmePutJson(
        `/api/admin/feature-flags/tenants/${tenantId}/${encodeURIComponent(flagKey)}`,
        { enabled },
      );
      await load();
      await refetchFlags();
    } catch (e) {
      setActionError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setBusyKey(null);
    }
  }

  async function removeOverride(flagKey: string) {
    if (tenantId == null) return;
    setActionError(null);
    setBusyKey(flagKey);
    try {
      await femmeDeleteJson(
        `/api/admin/feature-flags/tenants/${tenantId}/${encodeURIComponent(flagKey)}`,
      );
      await load();
      await refetchFlags();
    } catch (e) {
      setActionError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setBusyKey(null);
    }
  }

  if (!isAdmin) {
    return (
      <div>
        <Heading as="h2" className="text-[var(--color-ink)]">
          {t("femme.featureFlags.title")}
        </Heading>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]" role="alert">
          {t("femme.featureFlags.forbidden")}
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <Alert variant="destructive" title={t("femme.featureFlags.errorTitle")}>
          {loadError}
        </Alert>
      </div>
    );
  }

  if (rows == null) {
    return (
      <div className="flex items-center gap-2 text-[var(--color-ink-2)]">
        <Spinner size="sm" />
        <Text variant="small">{t("femme.featureFlags.loading")}</Text>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-6">
        <Heading as="h2" className="text-[var(--color-ink)]">
          {t("femme.featureFlags.title")}
        </Heading>
        <Text variant="small" className="mt-1 text-[var(--color-ink-3)]">
          {t("femme.featureFlags.subtitle")}
        </Text>
      </div>

      {actionError ? (
        <Alert variant="destructive" className="mb-4" title={t("femme.featureFlags.errorTitle")}>
          {actionError}
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const effective =
            row.hasOverride && row.overrideEnabled != null
              ? row.overrideEnabled
              : row.globalEnabled;
          const busy = busyKey === row.flagKey;
          return (
            <li
              key={row.flagKey}
              className="rounded-[var(--radius-lg)] border border-[var(--color-stone-md)] bg-[var(--color-white)] p-4 dark:border-slate-600 dark:bg-slate-900/30"
            >
              <div className="mb-1 font-mono text-xs font-medium text-[var(--color-ink)]">
                {row.flagKey}
              </div>
              {row.description ? (
                <p className="mb-3 text-sm text-[var(--color-ink-2)]">{row.description}</p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                    {t("femme.featureFlags.globalDefault")}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Switch
                      checked={row.globalEnabled}
                      disabled={busy}
                      onChange={() =>
                        void setGlobalEnabled(row.flagKey, !row.globalEnabled, row.description)
                      }
                      id={`ff-global-${row.flagKey}`}
                      aria-label={t("femme.featureFlags.globalSwitchAria", { key: row.flagKey })}
                    />
                    <span className="text-sm text-[var(--color-ink-2)]">
                      {row.globalEnabled
                        ? t("femme.featureFlags.stateOn")
                        : t("femme.featureFlags.stateOff")}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                    {t("femme.featureFlags.thisTenant")}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {!row.hasOverride ? (
                      <span className="text-sm text-[var(--color-ink-2)]">
                        {t("femme.featureFlags.usingGlobal")}
                      </span>
                    ) : (
                      <span className="text-sm text-[var(--color-ink-2)]">
                        {row.overrideEnabled
                          ? t("femme.featureFlags.stateOn")
                          : t("femme.featureFlags.stateOff")}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={effective}
                        disabled={busy}
                        onChange={() => void setTenantOverride(row.flagKey, !effective)}
                        id={`ff-tenant-${row.flagKey}`}
                        aria-label={t("femme.featureFlags.tenantSwitchAria", { key: row.flagKey })}
                      />
                    </div>
                    {row.hasOverride ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void removeOverride(row.flagKey)}
                      >
                        {t("femme.featureFlags.resetToGlobal")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
