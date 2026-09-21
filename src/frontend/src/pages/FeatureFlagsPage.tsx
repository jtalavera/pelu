import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Heading, Spinner, Switch, Text } from "@design-system";
import { femmeDeleteJson, femmeJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getDateLocale } from "../i18n/dateLocale";
import { useMe } from "../hooks/useMe";
import { TenantSearchField, type TenantSelection } from "../components/TenantSearchField";

type TenantFlagChange = {
  changedAt: string;
  changedByEmail: string;
  previousEnabled: boolean;
  newEnabled: boolean;
};

type TenantRow = {
  flagKey: string;
  description: string | null;
  globalEnabled: boolean;
  hasTier: boolean;
  tierEnabled: boolean | null;
  hasOverride: boolean;
  overrideEnabled: boolean | null;
  effectiveEnabled: boolean;
  lastChange: TenantFlagChange | null;
};

type SifenHomologationStatus = "PENDING" | "APPROVED";

type SifenHomologation = {
  status: SifenHomologationStatus;
  markedByEmail: string | null;
  markedAt: string | null;
};

const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

/**
 * HU-36: lives under `/platform/feature-flags` (mounted inside `PlatformShell`, gated to
 * `PLATFORM_ADMIN` by `PlatformAdminRoute`), not `/app/settings/feature-flags` — Platform Admin is
 * tenant-independent, so it manages an explicitly chosen tenant's flags via the "Tenant ID" form
 * below rather than an implicit preview tenant. Deliberately does not call `useFeatureFlagsState()`
 * (unlike before HU-36): that hook requires `FeatureFlagProvider`, mounted only inside `AppShell`
 * for a tenant-scoped session — `PlatformShell` skips it on purpose (see its own comment) since a
 * Platform Admin has no "current tenant" app session whose flags cache would need refreshing.
 */
export default function FeatureFlagsPage() {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);
  const { me } = useMe();
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [homologation, setHomologation] = useState<SifenHomologation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tenantSelection, setTenantSelection] = useState<TenantSelection>(null);
  const selectedTenant = tenantSelection?.tenant ?? null;
  const selectedTenantId = selectedTenant?.id ?? null;

  const isPlatformAdmin = me?.role === "PLATFORM_ADMIN";

  const load = useCallback(async () => {
    if (!isPlatformAdmin || selectedTenantId == null) return;
    setLoadError(null);
    try {
      const [data, homologationData] = await Promise.all([
        femmeJson<TenantRow[]>(`/api/admin/feature-flags/tenants/${selectedTenantId}`, {
          json: false,
        }),
        femmeJson<SifenHomologation>(
          `/api/admin/feature-flags/tenants/${selectedTenantId}/sifen-homologation`,
          { json: false },
        ),
      ]);
      setRows(data);
      setHomologation(homologationData);
    } catch (e) {
      setRows(null);
      setLoadError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    }
  }, [isPlatformAdmin, t, selectedTenantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function handleTenantSelect(selection: TenantSelection) {
    setRows(null);
    setHomologation(null);
    setLoadError(null);
    setTenantSelection(selection);
  }

  function handleChangeTenant() {
    setTenantSelection(null);
    setRows(null);
    setHomologation(null);
    setLoadError(null);
  }

  async function setHomologationStatus(status: SifenHomologationStatus) {
    if (selectedTenantId == null) return;
    setActionError(null);
    setBusyKey("sifen-homologation");
    try {
      const updated = await femmePutJson<SifenHomologation>(
        `/api/admin/feature-flags/tenants/${selectedTenantId}/sifen-homologation`,
        { status },
      );
      setHomologation(updated);
    } catch (e) {
      setActionError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setBusyKey(null);
    }
  }

  async function setTenantOverride(flagKey: string, enabled: boolean) {
    if (selectedTenantId == null) return;
    setActionError(null);
    setBusyKey(flagKey);
    try {
      await femmePutJson(
        `/api/admin/feature-flags/tenants/${selectedTenantId}/${encodeURIComponent(flagKey)}`,
        { enabled },
      );
      await load();
    } catch (e) {
      setActionError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setBusyKey(null);
    }
  }

  async function removeOverride(flagKey: string) {
    if (selectedTenantId == null) return;
    setActionError(null);
    setBusyKey(flagKey);
    try {
      await femmeDeleteJson(
        `/api/admin/feature-flags/tenants/${selectedTenantId}/${encodeURIComponent(flagKey)}`,
      );
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
          {t("femme.featureFlags.title")}
        </Heading>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]" role="alert">
          {t("femme.featureFlags.forbidden")}
        </p>
      </div>
    );
  }

  if (selectedTenantId == null) {
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
        <div className="max-w-sm">
          <TenantSearchField
            id="tenant-search-field"
            value={tenantSelection}
            onChange={handleTenantSelect}
          />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <Alert variant="destructive" title={t("femme.featureFlags.errorTitle")}>
          {loadError}
        </Alert>
        <Button type="button" size="sm" variant="outline" className="mt-4" onClick={handleChangeTenant}>
          {t("femme.featureFlags.changeTenant")}
        </Button>
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading as="h2" className="text-[var(--color-ink)]">
            {t("femme.featureFlags.title")}
          </Heading>
          <Text variant="small" className="mt-1 text-[var(--color-ink-3)]">
            {t("femme.featureFlags.subtitle")}
          </Text>
          <Text variant="small" className="mt-1 text-[var(--color-ink-3)]">
            {t("femme.featureFlags.managingTenant", { tenantName: selectedTenant?.name })}
          </Text>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={handleChangeTenant}>
          {t("femme.featureFlags.changeTenant")}
        </Button>
      </div>

      {actionError ? (
        <Alert variant="destructive" className="mb-4" title={t("femme.featureFlags.errorTitle")}>
          {actionError}
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          // HU-47 (conjunctive): the backend resolves `global AND tier AND tenant` and reports the
          // effective value plus each level's value; the "disabled by" note is derived here from
          // those level booleans (a missing tier/tenant row = ON / inherit).
          const effective = row.effectiveEnabled;
          const tenantValue = row.hasOverride ? (row.overrideEnabled ?? true) : true;
          const disabledBy: string[] = [];
          if (!row.globalEnabled) disabledBy.push(t("femme.featureFlags.levelGlobal"));
          if (row.hasTier && row.tierEnabled === false)
            disabledBy.push(t("femme.featureFlags.levelTier"));
          if (row.hasOverride && row.overrideEnabled === false)
            disabledBy.push(t("femme.featureFlags.levelOrganization"));
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

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                    {t("femme.featureFlags.globalDefault")}
                  </div>
                  {/* Read-only here — the global default is edited on its own page (Funcionalidades
                      Globales), same pattern as the tier value being edited on the Tiers page. */}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-[var(--color-ink-2)]">
                      {row.globalEnabled
                        ? t("femme.featureFlags.stateOn")
                        : t("femme.featureFlags.stateOff")}
                    </span>
                    <Link
                      to="/platform/global-feature-flags"
                      className="text-xs font-medium text-[var(--color-rose)] underline-offset-4 hover:underline"
                    >
                      {t("femme.featureFlags.globalEditLink")}
                    </Link>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                    {t("femme.featureFlags.tierDefault")}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {row.hasTier ? (
                      <span className="text-sm text-[var(--color-ink-2)]">
                        {row.tierEnabled
                          ? t("femme.featureFlags.stateOn")
                          : t("femme.featureFlags.stateOff")}
                      </span>
                    ) : (
                      <span className="text-sm text-[var(--color-ink-3)]">
                        {t("femme.featureFlags.tierNotDefined")}
                      </span>
                    )}
                    {selectedTenant?.tierId != null ? (
                      <Link
                        to={`/platform/tiers?open=${selectedTenant.tierId}`}
                        className="text-xs font-medium text-[var(--color-rose)] underline-offset-4 hover:underline"
                      >
                        {t("femme.featureFlags.tierDefaultEditLink", {
                          tierName: selectedTenant.tierName,
                        })}
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                    {t("femme.featureFlags.thisTenant")}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {!row.hasOverride ? (
                      <span className="text-sm text-[var(--color-ink-3)]">
                        {t("femme.featureFlags.usingInherited")}
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
                        checked={tenantValue}
                        disabled={busy}
                        onChange={() => void setTenantOverride(row.flagKey, !tenantValue)}
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

              <div
                className="mt-3 flex flex-wrap items-center gap-2"
                data-testid={`feature-flag-effective-${row.flagKey}`}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                  {t("femme.featureFlags.effectiveValue")}
                </span>
                <Badge variant={effective ? "success" : "secondary"}>
                  {effective ? t("femme.featureFlags.stateOn") : t("femme.featureFlags.stateOff")}
                </Badge>
                {!effective && disabledBy.length > 0 ? (
                  <span
                    className="text-xs text-[var(--color-ink-3)]"
                    data-testid={`feature-flag-disabled-by-${row.flagKey}`}
                  >
                    {t("femme.featureFlags.disabledBy", { levels: disabledBy.join(", ") })}
                  </span>
                ) : null}
              </div>

              {row.lastChange ? (
                <p
                  data-testid={`feature-flag-history-${row.flagKey}`}
                  className="mt-3 text-xs text-[var(--color-ink-3)]"
                >
                  {t("femme.featureFlags.lastChange", {
                    date: new Intl.DateTimeFormat(locale, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(row.lastChange.changedAt)),
                    email: row.lastChange.changedByEmail,
                    previous: row.lastChange.previousEnabled
                      ? t("femme.featureFlags.stateOn")
                      : t("femme.featureFlags.stateOff"),
                    next: row.lastChange.newEnabled
                      ? t("femme.featureFlags.stateOn")
                      : t("femme.featureFlags.stateOff"),
                  })}
                </p>
              ) : null}

              {row.flagKey === SIFEN_FLAG_KEY && homologation ? (
                <div className="mt-4 border-t border-[var(--color-stone-md)] pt-3 dark:border-slate-700">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                      {t("femme.featureFlags.sifenHomologation.title")}
                    </span>
                    <Badge variant={homologation.status === "APPROVED" ? "success" : "warning"}>
                      {t(
                        homologation.status === "APPROVED"
                          ? "femme.featureFlags.sifenHomologation.statusApproved"
                          : "femme.featureFlags.sifenHomologation.statusPending",
                      )}
                    </Badge>
                  </div>
                  <p className="mb-2 text-xs text-[var(--color-ink-3)]">
                    {homologation.markedByEmail && homologation.markedAt
                      ? t("femme.featureFlags.sifenHomologation.markedBy", {
                          status: t(
                            homologation.status === "APPROVED"
                              ? "femme.featureFlags.sifenHomologation.statusApproved"
                              : "femme.featureFlags.sifenHomologation.statusPending",
                          ),
                          email: homologation.markedByEmail,
                          date: new Intl.DateTimeFormat(locale, {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(homologation.markedAt)),
                        })
                      : t("femme.featureFlags.sifenHomologation.notMarked")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyKey === "sifen-homologation"}
                    onClick={() =>
                      void setHomologationStatus(
                        homologation.status === "APPROVED" ? "PENDING" : "APPROVED",
                      )
                    }
                  >
                    {t(
                      homologation.status === "APPROVED"
                        ? "femme.featureFlags.sifenHomologation.markPending"
                        : "femme.featureFlags.sifenHomologation.markApproved",
                    )}
                  </Button>
                  {homologation.status === "PENDING" ? (
                    <Alert variant="warning" className="mt-3">
                      {t("femme.featureFlags.sifenHomologation.pendingWarning")}
                    </Alert>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
