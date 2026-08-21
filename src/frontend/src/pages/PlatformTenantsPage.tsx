import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
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
  createTenantAdmin,
  listTenantAdmins,
  listTenantsPaged,
  listTiers,
  updateTenant,
  updateTenantStatus,
  updateTenantUserStatus,
  type PlatformTenant,
  type TenantStatus,
  type TenantUser,
  type TierOption,
} from "../api/platformTenants";
import { translateApiError, parseApiErrorMessage } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";
import { StatusBadge } from "../components/StatusBadge";
import { useDateLocale } from "../i18n/dateLocale";

type FormErrors = {
  name?: string;
  domain?: string;
  tier?: string;
} | null;

/**
 * HU-37/HU-39 (Épica B — Gestión de Tenants): Platform Admin creates tenants and sees them appear
 * immediately in this listing (AC-6), and can search the (paged, server-side) listing by name or
 * domain (HU-39 AC-2). The search box follows the app's "form onSubmit + type=submit button"
 * convention so Enter triggers search the same as clicking the button, with no duplicate
 * `onKeyDown` handler.
 */
export default function PlatformTenantsPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();

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

  // HU-39 AC-2: searchInput is the live text in the field; searchQuery is what's actually applied
  // server-side, committed only on form submit (Enter or the Search button) — no live/onChange
  // filtering, no duplicate onKeyDown handler.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

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

  // HU-38: edit an existing tenant. Reuses the same PlatformTenant row data already held in
  // tenantPageData — no separate GET-by-id endpoint needed to prefill the form.
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<PlatformTenant | null>(null);
  const [editName, setEditName] = useState("");
  const [editDomain, setEditDomain] = useState("");
  const [editTierId, setEditTierId] = useState<string>("");
  const [editFormErrors, setEditFormErrors] = useState<FormErrors>(null);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  // HU-40: suspend/reactivate a tenant from within the edit dialog ("detalle del tenant").
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);
  const [statusActionSaving, setStatusActionSaving] = useState(false);
  const [statusActionError, setStatusActionError] = useState<string | null>(null);
  const [suspendSuccess, setSuspendSuccess] = useState(false);
  const [reactivateSuccess, setReactivateSuccess] = useState(false);

  // HU-41: invite a tenant ADMIN user from within the tenant's detail (the edit dialog).
  const [adminEmail, setAdminEmail] = useState("");
  const [adminFormError, setAdminFormError] = useState<string | null>(null);
  const [adminSaveError, setAdminSaveError] = useState<string | null>(null);
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminInviteSuccessEmail, setAdminInviteSuccessEmail] = useState<string | null>(null);

  // HU-42 AC-3: list of every user (admins and professionals with access) assigned to the tenant
  // currently open in the edit dialog — proves AC-1 (no cap on admins) has actual, visible effect.
  const [tenantUsers, setTenantUsers] = useState<TenantUser[] | null>(null);
  const [tenantUsersLoading, setTenantUsersLoading] = useState(false);
  const [tenantUsersError, setTenantUsersError] = useState<string | null>(null);

  // HU-43 AC-1/AC-3: deactivate/reactivate a single user of the tenant currently open in the edit
  // dialog, from a per-row action in the user list above.
  const [userStatusTarget, setUserStatusTarget] = useState<TenantUser | null>(null);
  const [userStatusSaving, setUserStatusSaving] = useState(false);
  const [userStatusError, setUserStatusError] = useState<string | null>(null);
  const [userStatusSuccessMessage, setUserStatusSuccessMessage] = useState<string | null>(null);

  const loadTenants = useCallback(
    async (page: number, size: number, q: string) => {
      setTenantPageLoading(true);
      setPageError(null);
      try {
        const data = await listTenantsPaged({ page, size, q });
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
    void loadTenants(tenantPage, tenantPageSize, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantPage, tenantPageSize, searchQuery, reloadTick, loadTenants]);

  // HU-39 AC-2: submitting the search form (Enter or the Search button) commits the query and
  // resets to page 0, same as changing a filter pill elsewhere in the app.
  function handleSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTenantPage(0);
    setSearchQuery(searchInput.trim());
  }

  function handleSearchClear() {
    setSearchInput("");
    setTenantPage(0);
    setSearchQuery("");
  }

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
    setEditSuccess(false);
    setSuspendSuccess(false);
    setReactivateSuccess(false);
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

  // HU-42 AC-3: (re)loads the list of every user assigned to a tenant — called when the edit
  // dialog opens and again after a successful admin invite so the new admin appears immediately.
  const loadTenantUsers = useCallback(
    async (tenantId: number) => {
      setTenantUsersLoading(true);
      setTenantUsersError(null);
      try {
        const users = await listTenantAdmins(tenantId);
        setTenantUsers(users);
      } catch (err) {
        setTenantUsersError(
          translateApiError(err, t, "femme.platform.tenants.admins.listError"),
        );
      } finally {
        setTenantUsersLoading(false);
      }
    },
    [t],
  );

  // HU-38 AC-1: opens the edit form prefilled with this tenant's current name/domain/tier.
  function openEdit(tenant: PlatformTenant) {
    setEditingTenant(tenant);
    setEditName(tenant.name);
    setEditDomain(tenant.domain ?? "");
    setEditTierId(tenant.tierId != null ? String(tenant.tierId) : "");
    setEditFormErrors(null);
    setEditSaveError(null);
    setCreateSuccess(false);
    setEditSuccess(false);
    setSuspendSuccess(false);
    setReactivateSuccess(false);
    setStatusActionError(null);
    setAdminEmail("");
    setAdminFormError(null);
    setAdminSaveError(null);
    setAdminInviteSuccessEmail(null);
    setTenantUsers(null);
    setTenantUsersError(null);
    setUserStatusTarget(null);
    setUserStatusError(null);
    setUserStatusSuccessMessage(null);
    setEditModalOpen(true);
    void loadTenantUsers(tenant.id);
  }

  const onRowKeyOpenEdit =
    (tenant: PlatformTenant) => (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openEdit(tenant);
      }
    };

  function closeEditModal() {
    setEditModalOpen(false);
    setEditingTenant(null);
  }

  // HU-38 AC-1/AC-2/AC-3/AC-5: same field-level validations as create; on success the listing is
  // reloaded so the edited row (and, if the tier changed, its refreshed audit line) is visible
  // immediately and survives a page reload (persisted server-side).
  async function submitEdit() {
    if (!editingTenant) {
      return;
    }
    setEditSaveError(null);
    const nameTrim = editName.trim();
    const domainTrim = editDomain.trim();
    const errs: NonNullable<FormErrors> = {};
    if (!nameTrim) {
      errs.name = t("femme.platform.tenants.form.nameRequired");
    }
    if (!editTierId) {
      errs.tier = t("femme.platform.tenants.form.tierRequired");
    }
    if (errs.name || errs.tier) {
      setEditFormErrors(errs);
      return;
    }
    setEditFormErrors(null);
    setEditSaving(true);
    try {
      await updateTenant(editingTenant.id, {
        name: nameTrim,
        domain: domainTrim || null,
        tierId: editTierId ? Number(editTierId) : null,
      });
      setEditModalOpen(false);
      setEditingTenant(null);
      setEditSuccess(true);
      setReloadTick((n) => n + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      const rawCode = parseApiErrorMessage(e);
      if (rawCode === "TENANT_DOMAIN_DUPLICATE") {
        setEditFormErrors({ domain: t("femme.apiErrors.TENANT_DOMAIN_DUPLICATE") });
      } else if (rawCode === "TENANT_NAME_REQUIRED") {
        setEditFormErrors({ name: t("femme.apiErrors.TENANT_NAME_REQUIRED") });
      } else if (rawCode === "TENANT_TIER_REQUIRED" || rawCode === "TIER_NOT_FOUND") {
        setEditFormErrors({ tier: t(`femme.apiErrors.${rawCode}`) });
      } else {
        setEditSaveError(translateApiError(e, t, "femme.platform.tenants.editSaveError"));
      }
    } finally {
      setEditSaving(false);
    }
  }

  // HU-40 AC-1/AC-4: opens the confirmation dialog for the opposite action of the tenant's current
  // status (Suspend when Active, Reactivate when Suspended).
  function openStatusConfirm() {
    setStatusActionError(null);
    setStatusConfirmOpen(true);
  }

  function closeStatusConfirm() {
    setStatusConfirmOpen(false);
  }

  // HU-40 AC-1/AC-4: flips the tenant's status; on success, refreshes the listing (so the new
  // status is visible there too, AC-6) and shows a distinct success message for each direction.
  async function confirmStatusChange() {
    if (!editingTenant) {
      return;
    }
    const nextStatus: TenantStatus =
      editingTenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setStatusActionError(null);
    setStatusActionSaving(true);
    try {
      await updateTenantStatus(editingTenant.id, nextStatus);
      setStatusConfirmOpen(false);
      setEditModalOpen(false);
      setEditingTenant(null);
      setCreateSuccess(false);
      setEditSuccess(false);
      setSuspendSuccess(nextStatus === "SUSPENDED");
      setReactivateSuccess(nextStatus === "ACTIVE");
      setReloadTick((n) => n + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setStatusActionError(
        translateApiError(e, t, "femme.platform.tenants.statusActionError"),
      );
    } finally {
      setStatusActionSaving(false);
    }
  }

  // HU-43 AC-1/AC-3: opens the confirmation dialog for the opposite action of this user's current
  // status (Deactivate when enabled, Reactivate when disabled).
  function openUserStatusConfirm(user: TenantUser) {
    setUserStatusError(null);
    setUserStatusSuccessMessage(null);
    setUserStatusTarget(user);
  }

  function closeUserStatusConfirm() {
    setUserStatusTarget(null);
  }

  // HU-43 AC-1/AC-2/AC-3/AC-4/AC-5: flips one user's enabled flag; on success, refreshes the user
  // list (so the new status is visible there immediately) and shows a distinct success message for
  // each direction. Blocking login (AC-2) and invalidating an open session (AC-4) are enforced by
  // the backend the moment the flag flips — nothing else here is required to make that true.
  async function confirmUserStatusChange() {
    if (!editingTenant || !userStatusTarget) {
      return;
    }
    const target = userStatusTarget;
    const nextEnabled = !target.enabled;
    setUserStatusError(null);
    setUserStatusSaving(true);
    try {
      await updateTenantUserStatus(editingTenant.id, target.userId, nextEnabled);
      setUserStatusTarget(null);
      setUserStatusSuccessMessage(
        t(
          nextEnabled
            ? "femme.platform.tenants.admins.reactivateSuccess"
            : "femme.platform.tenants.admins.deactivateSuccess",
          { email: target.email },
        ),
      );
      void loadTenantUsers(editingTenant.id);
    } catch (e) {
      setUserStatusError(
        translateApiError(e, t, "femme.platform.tenants.admins.statusActionError"),
      );
    } finally {
      setUserStatusSaving(false);
    }
  }

  // HU-41 AC-1/AC-2/AC-3/AC-4/AC-6: invite a tenant ADMIN user for the tenant currently open in
  // the edit dialog. The Platform Admin never sees or sets a password (AC-2) — only the email.
  async function submitCreateAdmin() {
    if (!editingTenant) {
      return;
    }
    setAdminSaveError(null);
    const emailTrim = adminEmail.trim();
    if (!emailTrim) {
      setAdminFormError(t("femme.platform.tenants.admins.emailRequired"));
      return;
    }
    setAdminFormError(null);
    setAdminInviteSuccessEmail(null);
    setAdminSaving(true);
    try {
      const result = await createTenantAdmin(editingTenant.id, emailTrim);
      setAdminEmail("");
      setAdminInviteSuccessEmail(result.email);
      // HU-42 AC-1/AC-3: refresh the listing so the newly invited admin appears immediately —
      // proving the invite flow can be repeated with no artificial cap.
      void loadTenantUsers(editingTenant.id);
    } catch (e) {
      const rawCode = parseApiErrorMessage(e);
      if (rawCode === "TENANT_ADMIN_EMAIL_DUPLICATE") {
        setAdminFormError(t("femme.apiErrors.TENANT_ADMIN_EMAIL_DUPLICATE"));
      } else if (rawCode === "TENANT_ADMIN_EMAIL_REQUIRED" || rawCode === "INVALID_REQUEST") {
        setAdminFormError(t("femme.platform.tenants.admins.emailRequired"));
      } else {
        setAdminSaveError(translateApiError(e, t, "femme.platform.tenants.admins.inviteError"));
      }
    } finally {
      setAdminSaving(false);
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

      {/* HU-39 AC-2: form onSubmit + type="submit" button so Enter and the button trigger the
          same search; no separate onKeyDown handler (see CLAUDE.md "Search fields"). */}
      <form role="search" onSubmit={handleSearchSubmit} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1" style={{ maxWidth: 320 }}>
          <Label htmlFor="platform-tenants-search">{t("femme.platform.tenants.searchLabel")}</Label>
          <Input
            id="platform-tenants-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("femme.platform.tenants.searchPlaceholder")}
          />
        </div>
        <Button type="submit" variant="secondary" className="min-h-11">
          {t("femme.platform.tenants.searchButton")}
        </Button>
        {searchQuery ? (
          <Button type="button" variant="ghost" onClick={handleSearchClear} className="min-h-11">
            {t("femme.platform.tenants.searchClear")}
          </Button>
        ) : null}
      </form>

      {(createSuccess || editSuccess || suspendSuccess || reactivateSuccess || pageError) && (
        <div className="mb-4 flex flex-col gap-2">
          {createSuccess && (
            <Alert variant="success" style={{ fontSize: 12, padding: "8px 12px" }}>
              {t("femme.platform.tenants.createSuccess")}
            </Alert>
          )}
          {editSuccess && (
            <Alert variant="success" style={{ fontSize: 12, padding: "8px 12px" }}>
              {t("femme.platform.tenants.editSuccess")}
            </Alert>
          )}
          {suspendSuccess && (
            <Alert variant="success" style={{ fontSize: 12, padding: "8px 12px" }}>
              {t("femme.platform.tenants.suspendSuccess")}
            </Alert>
          )}
          {reactivateSuccess && (
            <Alert variant="success" style={{ fontSize: 12, padding: "8px 12px" }}>
              {t("femme.platform.tenants.reactivateSuccess")}
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
                    {searchQuery
                      ? t("femme.platform.tenants.emptySearchBody", { query: searchQuery })
                      : t("femme.platform.tenants.emptyBody")}
                  </td>
                </tr>
              ) : (
                content.map((tenant) => (
                  <tr
                    key={tenant.id}
                    data-testid={`platform-tenant-row-${tenant.id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={t("femme.platform.tenants.openEdit", { name: tenant.name })}
                    onClick={() => openEdit(tenant)}
                    onKeyDown={onRowKeyOpenEdit(tenant)}
                    style={{ cursor: "pointer" }}
                  >
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

      <Modal
        open={editModalOpen}
        onClose={closeEditModal}
        title={t("femme.platform.tenants.editTitle")}
      >
        <div className="flex flex-col gap-4">
          {editSaveError ? (
            <Alert variant="destructive" title={t("femme.platform.tenants.errorTitle")}>
              {editSaveError}
            </Alert>
          ) : null}
          {tiersLoadError ? <Alert variant="destructive">{tiersLoadError}</Alert> : null}

          <div>
            <Label htmlFor="tenant-edit-name">{t("femme.platform.tenants.form.name")}</Label>
            <Input
              id="tenant-edit-name"
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
                setEditFormErrors((prev) => (prev ? { ...prev, name: undefined } : prev));
              }}
              placeholder={t("femme.platform.tenants.form.namePlaceholder")}
              aria-invalid={editFormErrors?.name ? "true" : "false"}
              aria-describedby={editFormErrors?.name ? "tenant-edit-name-err" : undefined}
            />
            <FieldValidationError id="tenant-edit-name-err">
              {editFormErrors?.name}
            </FieldValidationError>
          </div>

          <div>
            <Label htmlFor="tenant-edit-domain">{t("femme.platform.tenants.form.domain")}</Label>
            <Input
              id="tenant-edit-domain"
              value={editDomain}
              onChange={(e) => {
                setEditDomain(e.target.value);
                setEditFormErrors((prev) => (prev ? { ...prev, domain: undefined } : prev));
              }}
              placeholder={t("femme.platform.tenants.form.domainPlaceholder")}
              aria-invalid={editFormErrors?.domain ? "true" : "false"}
              aria-describedby={editFormErrors?.domain ? "tenant-edit-domain-err" : undefined}
            />
            <FieldValidationError id="tenant-edit-domain-err">
              {editFormErrors?.domain}
            </FieldValidationError>
          </div>

          <div>
            <Label htmlFor="tenant-edit-tier">{t("femme.platform.tenants.form.tierEdit")}</Label>
            <Select
              id="tenant-edit-tier"
              value={editTierId}
              onChange={(e) => {
                setEditTierId(e.target.value);
                setEditFormErrors((prev) => (prev ? { ...prev, tier: undefined } : prev));
              }}
              invalid={!!editFormErrors?.tier}
              aria-invalid={editFormErrors?.tier ? "true" : "false"}
              aria-describedby={editFormErrors?.tier ? "tenant-edit-tier-err" : undefined}
            >
              <option value="">{t("femme.platform.tenants.form.tierPlaceholder")}</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
            </Select>
            <FieldValidationError id="tenant-edit-tier-err">
              {editFormErrors?.tier}
            </FieldValidationError>
          </div>

          {editingTenant?.lastTierChange ? (
            <p
              data-testid="tenant-edit-last-tier-change"
              className="text-xs text-[var(--color-ink-3)]"
            >
              {t("femme.platform.tenants.lastTierChange", {
                date: new Intl.DateTimeFormat(dateLocale, {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(editingTenant.lastTierChange.changedAt)),
                email: editingTenant.lastTierChange.changedByEmail,
                previous: editingTenant.lastTierChange.previousTierName ?? "—",
                next: editingTenant.lastTierChange.newTierName ?? "—",
              })}
            </p>
          ) : null}

          {/* HU-40 AC-1/AC-4/AC-6: current status + suspend/reactivate action, visible from the
              tenant's "detail" (this edit dialog — there's no separate detail page yet). */}
          {editingTenant ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)]"
              style={{ background: "var(--color-stone)", padding: "10px 12px" }}
            >
              <div className="flex items-center gap-2">
                <Text variant="small" className="text-[var(--color-ink-3)]">
                  {t("femme.platform.tenants.detailStatusLabel")}
                </Text>
                <StatusBadge status={editingTenant.status} />
              </div>
              <Button
                type="button"
                variant={editingTenant.status === "ACTIVE" ? "danger" : "primary"}
                className="min-h-11"
                onClick={openStatusConfirm}
              >
                {editingTenant.status === "ACTIVE"
                  ? t("femme.platform.tenants.suspendAction")
                  : t("femme.platform.tenants.reactivateAction")}
              </Button>
            </div>
          ) : null}
          {statusActionError ? (
            <Alert variant="destructive" title={t("femme.platform.tenants.errorTitle")}>
              {statusActionError}
            </Alert>
          ) : null}
          {editingTenant?.lastStatusChange ? (
            <p
              data-testid="tenant-edit-last-status-change"
              className="text-xs text-[var(--color-ink-3)]"
            >
              {t("femme.platform.tenants.lastStatusChange", {
                date: new Intl.DateTimeFormat(dateLocale, {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(editingTenant.lastStatusChange.changedAt)),
                email: editingTenant.lastStatusChange.changedByEmail,
                previous: t(`femme.status.${editingTenant.lastStatusChange.previousStatus}`),
                next: t(`femme.status.${editingTenant.lastStatusChange.newStatus}`),
              })}
            </p>
          ) : null}

          {/* HU-41 AC-1/AC-2/AC-3/AC-4/AC-6: invite a tenant ADMIN user for this tenant, from its
              detail (this edit dialog). No password is ever requested or shown here (AC-2) — the
              invited user sets one at activation. */}
          {editingTenant ? (
            <div
              className="flex flex-col gap-3 rounded-[var(--radius-lg)]"
              style={{ background: "var(--color-stone)", padding: "10px 12px" }}
            >
              <div>
                <Text variant="small" className="font-medium text-[var(--color-ink)]">
                  {t("femme.platform.tenants.admins.sectionTitle")}
                </Text>
                <Text variant="small" className="text-[var(--color-ink-3)]">
                  {t("femme.platform.tenants.admins.sectionLead")}
                </Text>
              </div>

              {/* HU-42 AC-3: every user (admins and professionals with access) currently assigned
                  to this tenant — proves AC-1 (no cap on admins) with a visible, growing list. */}
              <div data-testid="tenant-users-list" className="flex flex-col gap-1.5">
                {tenantUsersLoading ? (
                  <Text variant="small" className="text-[var(--color-ink-3)]">
                    {t("femme.platform.tenants.admins.listLoading")}
                  </Text>
                ) : tenantUsersError ? (
                  <Alert
                    variant="destructive"
                    style={{ fontSize: 12, padding: "8px 12px" }}
                  >
                    {tenantUsersError}
                  </Alert>
                ) : tenantUsers && tenantUsers.length > 0 ? (
                  tenantUsers.map((u) => (
                    <div
                      key={u.userId}
                      data-testid={`tenant-user-row-${u.userId}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)]"
                      style={{ background: "var(--color-white)", padding: "6px 10px" }}
                    >
                      <Text variant="small" className="min-w-0 truncate text-[var(--color-ink)]">
                        {u.email}
                      </Text>
                      <div className="flex items-center gap-2">
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            padding: "2px 8px",
                            borderRadius: "var(--radius-pill)",
                            background:
                              u.role === "ADMIN" ? "var(--color-mauve-lt)" : "var(--color-stone)",
                            color:
                              u.role === "ADMIN"
                                ? "var(--color-mauve-dk)"
                                : "var(--color-ink-2)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {u.role === "ADMIN"
                            ? t("femme.platform.tenants.admins.roleAdmin")
                            : t("femme.platform.tenants.admins.roleProfessional")}
                        </span>
                        <span
                          data-testid={`tenant-user-status-${u.userId}`}
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            padding: "2px 8px",
                            borderRadius: "var(--radius-pill)",
                            background: u.enabled
                              ? "var(--color-success-lt)"
                              : u.activated
                                ? "var(--color-danger-lt)"
                                : "var(--color-warning-lt)",
                            color: u.enabled
                              ? "var(--color-success)"
                              : u.activated
                                ? "var(--color-danger)"
                                : "var(--color-warning)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {u.enabled
                            ? t("femme.platform.tenants.admins.statusActive")
                            : u.activated
                              ? t("femme.platform.tenants.admins.statusDisabled")
                              : t("femme.platform.tenants.admins.statusPendingActivation")}
                        </span>
                        {/* HU-43 AC-1/AC-3: deactivate or reactivate this one user, without
                            affecting the rest of the tenant's users. */}
                        <Button
                          type="button"
                          variant={u.enabled ? "danger" : "secondary"}
                          className="min-h-11"
                          style={{ padding: "4px 12px", fontSize: 12 }}
                          onClick={() => openUserStatusConfirm(u)}
                        >
                          {u.enabled
                            ? t("femme.platform.tenants.admins.deactivateAction")
                            : t("femme.platform.tenants.admins.reactivateAction")}
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <Text variant="small" className="text-[var(--color-ink-3)]">
                    {t("femme.platform.tenants.admins.listEmpty")}
                  </Text>
                )}
              </div>

              {userStatusSuccessMessage ? (
                <Alert
                  data-testid="tenant-user-status-success"
                  variant="success"
                  style={{ fontSize: 12, padding: "8px 12px" }}
                >
                  {userStatusSuccessMessage}
                </Alert>
              ) : null}
              {userStatusError ? (
                <Alert
                  variant="destructive"
                  title={t("femme.platform.tenants.errorTitle")}
                  style={{ fontSize: 12, padding: "8px 12px" }}
                >
                  {userStatusError}
                </Alert>
              ) : null}
              {adminInviteSuccessEmail ? (
                <Alert variant="success" style={{ fontSize: 12, padding: "8px 12px" }}>
                  {t("femme.platform.tenants.admins.inviteSuccess", {
                    email: adminInviteSuccessEmail,
                  })}
                </Alert>
              ) : null}
              {adminSaveError ? (
                <Alert
                  variant="destructive"
                  title={t("femme.platform.tenants.errorTitle")}
                  style={{ fontSize: 12, padding: "8px 12px" }}
                >
                  {adminSaveError}
                </Alert>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Label htmlFor="tenant-admin-email">
                    {t("femme.platform.tenants.admins.emailLabel")}
                  </Label>
                  <Input
                    id="tenant-admin-email"
                    type="email"
                    value={adminEmail}
                    onChange={(e) => {
                      setAdminEmail(e.target.value);
                      setAdminFormError(null);
                    }}
                    placeholder={t("femme.platform.tenants.admins.emailPlaceholder")}
                    aria-invalid={adminFormError ? "true" : "false"}
                    aria-describedby={adminFormError ? "tenant-admin-email-err" : undefined}
                  />
                  <FieldValidationError id="tenant-admin-email-err">
                    {adminFormError}
                  </FieldValidationError>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => void submitCreateAdmin()}
                  disabled={adminSaving}
                >
                  {adminSaving
                    ? t("femme.platform.tenants.admins.inviting")
                    : t("femme.platform.tenants.admins.inviteButton")}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={closeEditModal} className="min-h-11">
              {t("femme.platform.tenants.cancel")}
            </Button>
            <Button type="button" onClick={submitEdit} disabled={editSaving} className="min-h-11">
              {editSaving
                ? t("femme.platform.tenants.saving")
                : t("femme.platform.tenants.saveChanges")}
            </Button>
          </div>
        </div>
      </Modal>

      {editingTenant ? (
        <ConfirmDialog
          open={statusConfirmOpen}
          title={
            editingTenant.status === "ACTIVE"
              ? t("femme.platform.tenants.suspendDialogTitle")
              : t("femme.platform.tenants.reactivateDialogTitle")
          }
          description={
            editingTenant.status === "ACTIVE"
              ? t("femme.platform.tenants.suspendDialogDescription", {
                  name: editingTenant.name,
                })
              : t("femme.platform.tenants.reactivateDialogDescription", {
                  name: editingTenant.name,
                })
          }
          cancelLabel={t("femme.platform.tenants.cancel")}
          confirmLabel={
            statusActionSaving
              ? t("femme.platform.tenants.saving")
              : editingTenant.status === "ACTIVE"
                ? t("femme.platform.tenants.suspendAction")
                : t("femme.platform.tenants.reactivateAction")
          }
          confirmVariant={editingTenant.status === "ACTIVE" ? "danger" : "primary"}
          onCancel={closeStatusConfirm}
          onConfirm={() => void confirmStatusChange()}
        />
      ) : null}

      {/* HU-43 AC-1/AC-3: confirm deactivating or reactivating a single tenant user. */}
      {userStatusTarget ? (
        <ConfirmDialog
          open={!!userStatusTarget}
          title={
            userStatusTarget.enabled
              ? t("femme.platform.tenants.admins.deactivateDialogTitle")
              : t("femme.platform.tenants.admins.reactivateDialogTitle")
          }
          description={
            userStatusTarget.enabled
              ? t("femme.platform.tenants.admins.deactivateDialogDescription", {
                  email: userStatusTarget.email,
                })
              : t("femme.platform.tenants.admins.reactivateDialogDescription", {
                  email: userStatusTarget.email,
                })
          }
          cancelLabel={t("femme.platform.tenants.cancel")}
          confirmLabel={
            userStatusSaving
              ? t("femme.platform.tenants.admins.statusActionSaving")
              : userStatusTarget.enabled
                ? t("femme.platform.tenants.admins.deactivateAction")
                : t("femme.platform.tenants.admins.reactivateAction")
          }
          confirmVariant={userStatusTarget.enabled ? "danger" : "primary"}
          onCancel={closeUserStatusConfirm}
          onConfirm={() => void confirmUserStatusChange()}
        />
      ) : null}
    </div>
  );
}
