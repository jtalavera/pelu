import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  Label,
  Modal,
  PageSizeSelect,
  Pagination,
  Select,
  Spinner,
  Text,
} from "@design-system";
import {
  createTenant,
  listTenantsPaged,
  listTiers,
  type PlatformTenant,
  type TierOption,
} from "../api/platformTenants";
import { translateApiError, parseApiErrorMessage } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { StatusBadge } from "../components/StatusBadge";

type FormErrors = {
  name?: string;
  domain?: string;
  tier?: string;
} | null;

/**
 * HU-37 (Épica B — Gestión de Tenants): Platform Admin creates tenants and sees them appear
 * immediately in this listing (AC-6). Search/filtering is HU-39's scope, not this one — this page
 * is deliberately just a plain paged list + a "new tenant" form.
 */
export default function PlatformTenantsPage() {
  const { t } = useTranslation();

  const [pageError, setPageError] = useState<string | null>(null);

  const [tenantPageData, setTenantPageData] = useState<{
    content: PlatformTenant[];
    page: number;
    size: number;
    totalElements: number;
    totalPages: number;
  } | null>(null);
  const [tenantPageLoading, setTenantPageLoading] = useState(true);
  const [tenantPage, setTenantPage] = useState(0);
  const [tenantPageSize, setTenantPageSize] = useState(10);
  const [reloadTick, setReloadTick] = useState(0);

  const [tiers, setTiers] = useState<TierOption[]>([]);
  const [tiersLoadError, setTiersLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [tierId, setTierId] = useState<string>("");
  const [formErrors, setFormErrors] = useState<FormErrors>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  const loadTenants = useCallback(
    async (page: number, size: number) => {
      setTenantPageLoading(true);
      setPageError(null);
      try {
        const data = await listTenantsPaged({ page, size });
        setTenantPageData(data);
      } catch (err) {
        setPageError(translateApiError(err, t, "femme.platform.tenants.loadError"));
      } finally {
        setTenantPageLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadTenants(tenantPage, tenantPageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantPage, tenantPageSize, reloadTick, loadTenants]);

  useEffect(() => {
    (async () => {
      try {
        const data = await listTiers();
        setTiers(data);
      } catch (err) {
        setTiersLoadError(translateApiError(err, t, "femme.platform.tenants.tiersLoadError"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openNew() {
    setName("");
    setDomain("");
    setTierId("");
    setFormErrors(null);
    setSaveError(null);
    setCreateSuccess(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function submitCreate() {
    setSaveError(null);
    const nameTrim = name.trim();
    const domainTrim = domain.trim();
    const errs: NonNullable<FormErrors> = {};
    if (!nameTrim) {
      errs.name = t("femme.platform.tenants.form.nameRequired");
    }
    if (!tierId) {
      errs.tier = t("femme.platform.tenants.form.tierRequired");
    }
    if (errs.name || errs.tier) {
      setFormErrors(errs);
      return;
    }
    setFormErrors(null);
    setSaving(true);
    try {
      await createTenant({
        name: nameTrim,
        domain: domainTrim || null,
        tierId: tierId ? Number(tierId) : null,
      });
      setModalOpen(false);
      setCreateSuccess(true);
      setTenantPage(0);
      setReloadTick((n) => n + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      const rawCode = parseApiErrorMessage(e);
      if (rawCode === "TENANT_DOMAIN_DUPLICATE") {
        setFormErrors({ domain: t("femme.apiErrors.TENANT_DOMAIN_DUPLICATE") });
      } else if (rawCode === "TENANT_NAME_REQUIRED") {
        setFormErrors({ name: t("femme.apiErrors.TENANT_NAME_REQUIRED") });
      } else if (rawCode === "TENANT_TIER_REQUIRED" || rawCode === "TIER_NOT_FOUND") {
        setFormErrors({ tier: t(`femme.apiErrors.${rawCode}`) });
      } else {
        setSaveError(translateApiError(e, t, "femme.platform.tenants.saveError"));
      }
    } finally {
      setSaving(false);
    }
  }

  const content = tenantPageData?.content ?? [];
  const totalElements = tenantPageData?.totalElements ?? 0;
  const totalPages = tenantPageData?.totalPages ?? 1;
  const showingFrom = totalElements === 0 ? 0 : tenantPage * tenantPageSize + 1;
  const showingTo = Math.min((tenantPage + 1) * tenantPageSize, totalElements);

  if (tenantPageLoading && !tenantPageData) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.platform.tenants.loading")}</Text>
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: "9px 12px",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--color-ink-3)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "left",
    background: "var(--color-stone)",
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 12,
    color: "var(--color-ink)",
    verticalAlign: "middle",
    borderBottom: "0.5px solid var(--color-stone)",
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-[15px] font-medium leading-tight text-[var(--color-ink)]">
            {t("femme.platform.tenants.title")}
          </h1>
          <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
            {t("femme.platform.tenants.lead")}
          </div>
        </div>
        <Button type="button" onClick={openNew} className="min-h-11">
          {t("femme.platform.tenants.addNew")}
        </Button>
      </div>

      {(createSuccess || pageError) && (
        <div className="mb-4 flex flex-col gap-2">
          {createSuccess && (
            <Alert variant="success" style={{ fontSize: 12, padding: "8px 12px" }}>
              {t("femme.platform.tenants.createSuccess")}
            </Alert>
          )}
          {pageError && (
            <Alert
              variant="destructive"
              title={t("femme.platform.tenants.errorTitle")}
              style={{ fontSize: 12, padding: "8px 12px" }}
            >
              {pageError}
            </Alert>
          )}
        </div>
      )}

      <div
        className="overflow-hidden rounded-[var(--radius-xl)]"
        style={{ background: "var(--color-white)", border: "var(--border-default)" }}
      >
        <div className="overflow-x-auto">
          <table style={{ tableLayout: "fixed", width: "100%", borderCollapse: "collapse" }}>
            <colgroup>
              <col style={{ width: "34%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle}>{t("femme.platform.tenants.colName")}</th>
                <th style={thStyle}>{t("femme.platform.tenants.colDomain")}</th>
                <th style={thStyle}>{t("femme.platform.tenants.colTier")}</th>
                <th style={thStyle}>{t("femme.platform.tenants.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {totalElements === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{ padding: "24px 12px", textAlign: "center", fontSize: 12, color: "var(--color-ink-3)" }}
                  >
                    {t("femme.platform.tenants.emptyBody")}
                  </td>
                </tr>
              ) : (
                content.map((tenant) => (
                  <tr key={tenant.id} data-testid={`platform-tenant-row-${tenant.id}`}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{tenant.name}</td>
                    <td style={{ ...tdStyle, color: tenant.domain ? "var(--color-ink)" : "var(--color-ink-3)" }}>
                      {tenant.domain ?? "—"}
                    </td>
                    <td style={{ ...tdStyle, color: tenant.tierName ? "var(--color-ink)" : "var(--color-ink-3)" }}>
                      {tenant.tierName ?? "—"}
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={tenant.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{ borderTop: "var(--border-default)" }}
        >
          <PageSizeSelect
            value={tenantPageSize}
            onChange={(s) => {
              setTenantPageSize(s);
              setTenantPage(0);
            }}
            label={t("femme.pagination.rowsPerPage")}
          />
          <Text variant="small" className="text-[var(--color-ink-3)]">
            {t("femme.pagination.showingRange", { from: showingFrom, to: showingTo, total: totalElements })}
          </Text>
          <Pagination
            page={tenantPage + 1}
            pageCount={Math.max(1, totalPages)}
            onPageChange={(p) => setTenantPage(p - 1)}
            previousLabel={t("femme.pagination.previous")}
            nextLabel={t("femme.pagination.next")}
          />
        </div>
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={t("femme.platform.tenants.addTitle")}>
        <div className="flex flex-col gap-4">
          {saveError ? (
            <Alert variant="destructive" title={t("femme.platform.tenants.errorTitle")}>
              {saveError}
            </Alert>
          ) : null}
          {tiersLoadError ? <Alert variant="destructive">{tiersLoadError}</Alert> : null}

          <div>
            <Label htmlFor="tenant-name">{t("femme.platform.tenants.form.name")}</Label>
            <Input
              id="tenant-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFormErrors((prev) => (prev ? { ...prev, name: undefined } : prev));
              }}
              placeholder={t("femme.platform.tenants.form.namePlaceholder")}
              aria-invalid={formErrors?.name ? "true" : "false"}
              aria-describedby={formErrors?.name ? "tenant-name-err" : undefined}
            />
            <FieldValidationError id="tenant-name-err">{formErrors?.name}</FieldValidationError>
          </div>

          <div>
            <Label htmlFor="tenant-domain">{t("femme.platform.tenants.form.domain")}</Label>
            <Input
              id="tenant-domain"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setFormErrors((prev) => (prev ? { ...prev, domain: undefined } : prev));
              }}
              placeholder={t("femme.platform.tenants.form.domainPlaceholder")}
              aria-invalid={formErrors?.domain ? "true" : "false"}
              aria-describedby={formErrors?.domain ? "tenant-domain-err" : undefined}
            />
            <FieldValidationError id="tenant-domain-err">{formErrors?.domain}</FieldValidationError>
          </div>

          <div>
            <Label htmlFor="tenant-tier">{t("femme.platform.tenants.form.tier")}</Label>
            <Select
              id="tenant-tier"
              value={tierId}
              onChange={(e) => {
                setTierId(e.target.value);
                setFormErrors((prev) => (prev ? { ...prev, tier: undefined } : prev));
              }}
              invalid={!!formErrors?.tier}
              aria-invalid={formErrors?.tier ? "true" : "false"}
              aria-describedby={formErrors?.tier ? "tenant-tier-err" : undefined}
            >
              <option value="">{t("femme.platform.tenants.form.tierPlaceholder")}</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
            </Select>
            <FieldValidationError id="tenant-tier-err">{formErrors?.tier}</FieldValidationError>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={closeModal} className="min-h-11">
              {t("femme.platform.tenants.cancel")}
            </Button>
            <Button type="button" onClick={submitCreate} disabled={saving} className="min-h-11">
              {saving ? t("femme.platform.tenants.saving") : t("femme.platform.tenants.save")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
