import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Spinner, Switch, Text } from "@design-system";
import {
  createPlatformTier,
  deletePlatformTier,
  listPlatformTiers,
  listTierFeatureFlags,
  setTierFeatureFlagIncluded,
  updatePlatformTier,
  type PlatformTier,
  type TierFeatureFlagRow,
} from "../api/platformTiers";
import { translateApiError, parseApiErrorMessage } from "../api/parseApiErrorMessage";
import { getDateLocale } from "../i18n/dateLocale";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";

type FormErrors = {
  name?: string;
} | null;

/**
 * HU-45 (Épica D — Tiers y Feature Flags): Platform Admin creates, edits, lists, and deletes
 * tiers — reusable packages of feature flags a tenant can be assigned (HU-46/HU-47/HU-48 build on
 * top of this, out of scope here). Pattern-matched on `PlatformTenantsPage` (closest CRUD analog
 * from the Platform Admin side), but simpler: no server-side search/pagination — tiers are a
 * small, Platform-Admin-curated catalog (same assumption as the existing global Feature Flags
 * listing), not a per-tenant growing list.
 */
export default function PlatformTiersPage() {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);
  const [searchParams, setSearchParams] = useSearchParams();

  const [tiers, setTiers] = useState<PlatformTier[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formErrors, setFormErrors] = useState<FormErrors>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  // HU-45 AC-2: editing an existing tier's name/description.
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PlatformTier | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editFormErrors, setEditFormErrors] = useState<FormErrors>(null);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  // HU-45 AC-3: delete with in-use protection.
  const [deleteTarget, setDeleteTarget] = useState<PlatformTier | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  // HU-46 AC-1: from the tier detail (this edit modal), the flag matrix the tier includes by
  // default. Loaded whenever the edit modal opens for a tier.
  const [editFlags, setEditFlags] = useState<TierFeatureFlagRow[] | null>(null);
  const [editFlagsLoading, setEditFlagsLoading] = useState(false);
  const [editFlagsError, setEditFlagsError] = useState<string | null>(null);
  const [flagBusyKey, setFlagBusyKey] = useState<string | null>(null);

  const loadTiers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listPlatformTiers();
      setTiers(data);
    } catch (err) {
      setLoadError(translateApiError(err, t, "femme.platform.tiers.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadTiers();
  }, [loadTiers]);

  // Deep link from the Feature Flags page's "Edit in {tier} →" link (?open=<tierId>) — once tiers
  // are loaded, jump straight to that tier's edit modal instead of leaving the user to find it in
  // the list themselves. The param is cleared right after so re-opening later starts clean.
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId || tiers == null) return;
    const target = tiers.find((tier) => String(tier.id) === openId);
    if (target) {
      openEdit(target);
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("open");
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiers, searchParams]);

  function openNew() {
    setName("");
    setDescription("");
    setFormErrors(null);
    setSaveError(null);
    setCreateSuccess(false);
    setEditSuccess(false);
    setDeleteSuccess(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function submitCreate() {
    setSaveError(null);
    const nameTrim = name.trim();
    const errs: NonNullable<FormErrors> = {};
    if (!nameTrim) {
      errs.name = t("femme.platform.tiers.form.nameRequired");
    }
    if (errs.name) {
      setFormErrors(errs);
      return;
    }
    setFormErrors(null);
    setSaving(true);
    try {
      await createPlatformTier({ name: nameTrim, description: description.trim() || null });
      setModalOpen(false);
      setCreateSuccess(true);
      void loadTiers();
    } catch (e) {
      const rawCode = parseApiErrorMessage(e);
      if (rawCode === "TIER_NAME_DUPLICATE") {
        setFormErrors({ name: t("femme.apiErrors.TIER_NAME_DUPLICATE") });
      } else if (rawCode === "TIER_NAME_REQUIRED") {
        setFormErrors({ name: t("femme.apiErrors.TIER_NAME_REQUIRED") });
      } else {
        setSaveError(translateApiError(e, t, "femme.platform.tiers.saveError"));
      }
    } finally {
      setSaving(false);
    }
  }

  function openEdit(tier: PlatformTier) {
    setEditingTier(tier);
    setEditName(tier.name);
    setEditDescription(tier.description ?? "");
    setEditFormErrors(null);
    setEditSaveError(null);
    setCreateSuccess(false);
    setEditSuccess(false);
    setDeleteSuccess(false);
    setEditModalOpen(true);
    void loadEditFlags(tier.id);
  }

  // HU-46 AC-1/AC-2: the tier's feature-flag matrix, loaded fresh every time the detail/edit modal
  // opens so it always reflects whatever was last persisted (also used to re-sync after a toggle).
  async function loadEditFlags(tierId: number) {
    setEditFlags(null);
    setEditFlagsError(null);
    setEditFlagsLoading(true);
    try {
      const data = await listTierFeatureFlags(tierId);
      setEditFlags(data);
    } catch (e) {
      setEditFlagsError(translateApiError(e, t, "femme.platform.tiers.flags.loadError"));
    } finally {
      setEditFlagsLoading(false);
    }
  }

  async function toggleTierFlag(flagKey: string, included: boolean) {
    if (!editingTier) return;
    setEditFlagsError(null);
    setFlagBusyKey(flagKey);
    try {
      await setTierFeatureFlagIncluded(editingTier.id, flagKey, included);
      await loadEditFlags(editingTier.id);
    } catch (e) {
      setEditFlagsError(translateApiError(e, t, "femme.platform.tiers.flags.saveError"));
    } finally {
      setFlagBusyKey(null);
    }
  }

  const onRowKeyOpenEdit = (tier: PlatformTier) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openEdit(tier);
    }
  };

  function closeEditModal() {
    setEditModalOpen(false);
    setEditingTier(null);
    setEditFlags(null);
    setEditFlagsError(null);
  }

  async function submitEdit() {
    if (!editingTier) {
      return;
    }
    setEditSaveError(null);
    const nameTrim = editName.trim();
    const errs: NonNullable<FormErrors> = {};
    if (!nameTrim) {
      errs.name = t("femme.platform.tiers.form.nameRequired");
    }
    if (errs.name) {
      setEditFormErrors(errs);
      return;
    }
    setEditFormErrors(null);
    setEditSaving(true);
    try {
      await updatePlatformTier(editingTier.id, {
        name: nameTrim,
        description: editDescription.trim() || null,
      });
      setEditModalOpen(false);
      setEditingTier(null);
      setEditSuccess(true);
      void loadTiers();
    } catch (e) {
      const rawCode = parseApiErrorMessage(e);
      if (rawCode === "TIER_NAME_DUPLICATE") {
        setEditFormErrors({ name: t("femme.apiErrors.TIER_NAME_DUPLICATE") });
      } else if (rawCode === "TIER_NAME_REQUIRED") {
        setEditFormErrors({ name: t("femme.apiErrors.TIER_NAME_REQUIRED") });
      } else {
        setEditSaveError(translateApiError(e, t, "femme.platform.tiers.editSaveError"));
      }
    } finally {
      setEditSaving(false);
    }
  }

  function openDeleteConfirm(tier: PlatformTier) {
    setDeleteError(null);
    setDeleteSuccess(false);
    setDeleteTarget(tier);
  }

  function closeDeleteConfirm() {
    setDeleteTarget(null);
  }

  // HU-45 AC-3: the backend is the authority on whether a tier is in use (defends against a tenant
  // being assigned between this listing's load and the delete click) — a rejection surfaces
  // TIER_IN_USE, translated here with the tenant count already known from the row, so no second
  // round-trip is needed to build a clear "N tenants use this tier" message.
  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    setDeleteError(null);
    setDeleteSaving(true);
    try {
      await deletePlatformTier(target.id);
      setDeleteTarget(null);
      setDeleteSuccess(true);
      void loadTiers();
    } catch (e) {
      const rawCode = parseApiErrorMessage(e);
      // HU-45 AC-3: close the confirm dialog either way — the rejection reason (with the tenant
      // count already known from the row) is shown on the page itself, same convention as every
      // other save/action error in this app.
      setDeleteTarget(null);
      if (rawCode === "TIER_IN_USE") {
        setDeleteError(
          t("femme.apiErrors.TIER_IN_USE", { count: target.tenantCount }),
        );
      } else {
        setDeleteError(translateApiError(e, t, "femme.platform.tiers.deleteError"));
      }
    } finally {
      setDeleteSaving(false);
    }
  }

  const content = tiers ?? [];

  if (loading && tiers === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.platform.tiers.loading")}</Text>
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
            {t("femme.platform.tiers.title")}
          </h1>
          <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
            {t("femme.platform.tiers.lead")}
          </div>
        </div>
        <Button type="button" onClick={openNew} className="min-h-11">
          {t("femme.platform.tiers.addNew")}
        </Button>
      </div>

      {(createSuccess || editSuccess || deleteSuccess || loadError) && (
        <div className="mb-4 flex flex-col gap-2">
          {createSuccess && (
            <Alert variant="success" style={{ fontSize: 12, padding: "8px 12px" }}>
              {t("femme.platform.tiers.createSuccess")}
            </Alert>
          )}
          {editSuccess && (
            <Alert variant="success" style={{ fontSize: 12, padding: "8px 12px" }}>
              {t("femme.platform.tiers.editSuccess")}
            </Alert>
          )}
          {deleteSuccess && (
            <Alert
              data-testid="tier-delete-success"
              variant="success"
              style={{ fontSize: 12, padding: "8px 12px" }}
            >
              {t("femme.platform.tiers.deleteSuccess")}
            </Alert>
          )}
          {loadError && (
            <Alert
              variant="destructive"
              title={t("femme.platform.tiers.errorTitle")}
              style={{ fontSize: 12, padding: "8px 12px" }}
            >
              {loadError}
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
              <col style={{ width: "20%" }} />
              <col style={{ width: "32%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "32%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle}>{t("femme.platform.tiers.colName")}</th>
                <th style={thStyle}>{t("femme.platform.tiers.colDescription")}</th>
                <th style={thStyle}>{t("femme.platform.tiers.colTenantCount")}</th>
                <th style={thStyle}>{t("femme.platform.tiers.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {content.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{ padding: "24px 12px", textAlign: "center", fontSize: 12, color: "var(--color-ink-3)" }}
                  >
                    {t("femme.platform.tiers.emptyBody")}
                  </td>
                </tr>
              ) : (
                content.map((tier) => (
                  <tr
                    key={tier.id}
                    data-testid={`platform-tier-row-${tier.id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={t("femme.platform.tiers.openEdit", { name: tier.name })}
                    onClick={() => openEdit(tier)}
                    onKeyDown={onRowKeyOpenEdit(tier)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{tier.name}</td>
                    <td
                      style={{
                        ...tdStyle,
                        color: tier.description ? "var(--color-ink)" : "var(--color-ink-3)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tier.description ?? "—"}
                    </td>
                    <td style={tdStyle} data-testid={`tier-tenant-count-${tier.id}`}>
                      {t("femme.platform.tiers.tenantCount", { count: tier.tenantCount })}
                    </td>
                    <td style={tdStyle}>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          style={{ padding: "4px 12px", fontSize: 12 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(tier);
                          }}
                        >
                          {t("femme.platform.tiers.featureFlagsAction")}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          className="min-h-11"
                          style={{ padding: "4px 12px", fontSize: 12 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeleteConfirm(tier);
                          }}
                        >
                          {t("femme.platform.tiers.deleteAction")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={t("femme.platform.tiers.addTitle")}>
        <div className="flex flex-col gap-4">
          {saveError ? (
            <Alert variant="destructive" title={t("femme.platform.tiers.errorTitle")}>
              {saveError}
            </Alert>
          ) : null}

          <div>
            <Label htmlFor="tier-name">{t("femme.platform.tiers.form.name")}</Label>
            <Input
              id="tier-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFormErrors((prev) => (prev ? { ...prev, name: undefined } : prev));
              }}
              placeholder={t("femme.platform.tiers.form.namePlaceholder")}
              aria-invalid={formErrors?.name ? "true" : "false"}
              aria-describedby={formErrors?.name ? "tier-name-err" : undefined}
            />
            <FieldValidationError id="tier-name-err">{formErrors?.name}</FieldValidationError>
          </div>

          <div>
            <Label htmlFor="tier-description">{t("femme.platform.tiers.form.description")}</Label>
            <Input
              id="tier-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("femme.platform.tiers.form.descriptionPlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={closeModal} className="min-h-11">
              {t("femme.platform.tiers.cancel")}
            </Button>
            <Button type="button" onClick={submitCreate} disabled={saving} className="min-h-11">
              {saving ? t("femme.platform.tiers.saving") : t("femme.platform.tiers.save")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={editModalOpen}
        onClose={closeEditModal}
        title={t("femme.platform.tiers.editTitle")}
      >
        <div className="flex flex-col gap-4">
          {editSaveError ? (
            <Alert variant="destructive" title={t("femme.platform.tiers.errorTitle")}>
              {editSaveError}
            </Alert>
          ) : null}

          <div>
            <Label htmlFor="tier-edit-name">{t("femme.platform.tiers.form.name")}</Label>
            <Input
              id="tier-edit-name"
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
                setEditFormErrors((prev) => (prev ? { ...prev, name: undefined } : prev));
              }}
              placeholder={t("femme.platform.tiers.form.namePlaceholder")}
              aria-invalid={editFormErrors?.name ? "true" : "false"}
              aria-describedby={editFormErrors?.name ? "tier-edit-name-err" : undefined}
            />
            <FieldValidationError id="tier-edit-name-err">
              {editFormErrors?.name}
            </FieldValidationError>
          </div>

          <div>
            <Label htmlFor="tier-edit-description">
              {t("femme.platform.tiers.form.description")}
            </Label>
            <Input
              id="tier-edit-description"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder={t("femme.platform.tiers.form.descriptionPlaceholder")}
            />
          </div>

          {editingTier ? (
            <Text
              variant="small"
              className="text-[var(--color-ink-3)]"
              data-testid="tier-edit-tenant-count"
            >
              {t("femme.platform.tiers.tenantCount", { count: editingTier.tenantCount })}
            </Text>
          ) : null}

          {/* HU-46 AC-1: from this tier's detail (the edit modal), the Platform Admin sees every
              existing feature flag and marks which ones this tier includes by default. */}
          <div className="border-t border-[var(--color-stone-md)] pt-4 dark:border-slate-700">
            <Text className="mb-1 font-medium text-[var(--color-ink)]">
              {t("femme.platform.tiers.flags.title")}
            </Text>
            <Text variant="small" className="mb-3 text-[var(--color-ink-3)]">
              {t("femme.platform.tiers.flags.lead")}
            </Text>

            {editFlagsError ? (
              <Alert
                variant="destructive"
                className="mb-3"
                title={t("femme.platform.tiers.errorTitle")}
              >
                {editFlagsError}
              </Alert>
            ) : null}

            {editFlagsLoading && editFlags === null ? (
              <div className="flex items-center gap-2 text-[var(--color-ink-3)]">
                <Spinner size="sm" />
                <Text variant="small">{t("femme.platform.tiers.flags.loading")}</Text>
              </div>
            ) : (
              <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto" data-testid="tier-flags-list">
                {(editFlags ?? []).map((row) => {
                  const busy = flagBusyKey === row.flagKey;
                  return (
                    <li
                      key={row.flagKey}
                      data-testid={`tier-flag-row-${row.flagKey}`}
                      className="flex items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-stone-md)] p-3 dark:border-slate-700"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-medium text-[var(--color-ink)]">
                          {row.flagKey}
                        </div>
                        {row.description ? (
                          <div className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                            {row.description}
                          </div>
                        ) : null}
                        {row.lastChange ? (
                          <div
                            data-testid={`tier-flag-history-${row.flagKey}`}
                            className="mt-1 text-[11px] text-[var(--color-ink-3)]"
                          >
                            {t("femme.platform.tiers.flags.lastChange", {
                              date: new Intl.DateTimeFormat(locale, {
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(row.lastChange.changedAt)),
                              email: row.lastChange.changedByEmail,
                              previous: row.lastChange.previousIncluded
                                ? t("femme.platform.tiers.flags.included")
                                : t("femme.platform.tiers.flags.notIncluded"),
                              next: row.lastChange.newIncluded
                                ? t("femme.platform.tiers.flags.included")
                                : t("femme.platform.tiers.flags.notIncluded"),
                            })}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Switch
                          checked={row.included}
                          disabled={busy}
                          onChange={() => void toggleTierFlag(row.flagKey, !row.included)}
                          id={`tier-flag-${row.flagKey}`}
                          aria-label={t("femme.platform.tiers.flags.toggleAria", {
                            key: row.flagKey,
                          })}
                        />
                      </div>
                    </li>
                  );
                })}
                {editFlags !== null && editFlags.length === 0 ? (
                  <li className="text-xs text-[var(--color-ink-3)]">
                    {t("femme.platform.tiers.flags.empty")}
                  </li>
                ) : null}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={closeEditModal} className="min-h-11">
              {t("femme.platform.tiers.cancel")}
            </Button>
            <Button type="button" onClick={submitEdit} disabled={editSaving} className="min-h-11">
              {editSaving
                ? t("femme.platform.tiers.saving")
                : t("femme.platform.tiers.saveChanges")}
            </Button>
          </div>
        </div>
      </Modal>

      {deleteTarget ? (
        <ConfirmDialog
          open={!!deleteTarget}
          title={t("femme.platform.tiers.deleteDialogTitle")}
          description={t("femme.platform.tiers.deleteDialogDescription", {
            name: deleteTarget.name,
          })}
          cancelLabel={t("femme.platform.tiers.cancel")}
          confirmLabel={
            deleteSaving
              ? t("femme.platform.tiers.deleting")
              : t("femme.platform.tiers.deleteAction")
          }
          confirmVariant="danger"
          onCancel={closeDeleteConfirm}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {deleteError ? (
        <div className="mt-4">
          <Alert
            data-testid="tier-delete-error"
            variant="destructive"
            title={t("femme.platform.tiers.errorTitle")}
            style={{ fontSize: 12, padding: "8px 12px" }}
          >
            {deleteError}
          </Alert>
        </div>
      ) : null}
    </div>
  );
}
