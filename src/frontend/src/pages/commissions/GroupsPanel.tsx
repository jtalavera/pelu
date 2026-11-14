import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, KebabMenu, Label, Modal, Select, Spinner, Text } from "@design-system";
import {
  assignGroups,
  assignUngroupedToGroup,
  createGroup,
  deleteGroup,
  getGroups,
  getUngrouped,
  renameGroup,
  type GroupView,
  type UngroupedService,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FieldValidationError } from "../../components/FieldValidationError";
import { ACTION_BUTTON } from "../../components/actionButtons";

/**
 * HU-COM-12 «Grupos»: commission groups (a service belongs to one at most), services still without
 * a group — with the group their name suggests — and a bulk assignment for products.
 */
export function GroupsPanel() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [ungrouped, setUngrouped] = useState<UngroupedService[]>([]);
  const [products, setProducts] = useState<UngroupedService[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; name: string } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<GroupView | null>(null);
  const [productGroup, setProductGroup] = useState("");

  const load = useCallback(async () => {
    try {
      const [g, s, p] = await Promise.all([getGroups(), getUngrouped("SERVICE"), getUngrouped("PRODUCT")]);
      setGroups(g);
      setUngrouped(s);
      setProducts(p);
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string | null) {
    setNotice(null);
    try {
      await action();
      setError(null);
      if (success) setNotice(success);
      await load();
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }

  async function saveGroup() {
    if (!editing) return;
    if (!editing.name.trim()) {
      setNameError(t("femme.commissions.groups.nameRequired"));
      return;
    }
    const { id, name } = editing;
    try {
      if (id === null) await createGroup(name);
      else await renameGroup(id, name);
      setEditing(null);
      setNotice(t(id === null ? "femme.commissions.groups.created" : "femme.commissions.groups.renamed"));
      await load();
    } catch (err) {
      setNameError(translateApiError(err, t));
    }
  }

  const assigned = (count: number) => t("femme.commissions.groups.assigned", { count });
  const withSuggestion = ungrouped.filter((s) => s.suggestion);

  if (!groups) return error ? <Alert variant="destructive">{error}</Alert> : <Spinner />;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="commission-groups">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.groups.intro")}</p>
      {notice && (
        <Alert variant="success" role="status" data-testid="groups-notice">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <section className="rounded-card border border-line bg-surface p-3 shadow-sm sm:p-4" data-testid="groups-ungrouped">
        <h3 className="font-heading text-base font-extrabold text-ink">
          {t("femme.commissions.groups.ungroupedTitle")}{" "}
          <span className="text-sm font-semibold text-ink-3">
            · {ungrouped.length} · {t("femme.commissions.groups.ungroupedHint")}
          </span>
        </h3>
        {ungrouped.length === 0 ? (
          <Text variant="muted" className="mt-2" data-testid="groups-ungrouped-empty">
            {t("femme.commissions.groups.ungroupedEmpty")}
          </Text>
        ) : (
          <>
            <ul className="mt-2">
              {ungrouped.map((s) => (
                <li
                  key={s.serviceId}
                  data-testid="groups-ungrouped-row"
                  className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0"
                >
                  <span className="min-w-0 flex-1 basis-40 break-words font-bold text-ink">{s.name}</span>
                  {s.suggestion && (
                    <span
                      data-testid="groups-suggestion"
                      className="inline-flex min-h-8 items-center rounded-full bg-warning-lt px-3 text-xs font-extrabold text-warning"
                    >
                      {t("femme.commissions.groups.suggested", { group: s.suggestion.groupName, reason: s.suggestion.reason })}
                    </span>
                  )}
                  {s.suggestion && (
                    <Button
                      type="button"
                      variant="secondary"
                      className={ACTION_BUTTON}
                      data-testid="groups-accept"
                      aria-label={t("femme.commissions.groups.acceptAria", { name: s.name })}
                      onClick={() =>
                        void run(
                          () => assignGroups([{ serviceId: s.serviceId, groupId: s.suggestion!.groupId }]),
                          assigned(1),
                        )
                      }
                    >
                      {t("femme.commissions.groups.accept")}
                    </Button>
                  )}
                  <Select
                    aria-label={t("femme.commissions.groups.chooseAria", { name: s.name })}
                    value=""
                    className="w-44"
                    data-testid="groups-choose"
                    onChange={(e) => {
                      const groupId = Number(e.target.value);
                      if (groupId) void run(() => assignGroups([{ serviceId: s.serviceId, groupId }]), assigned(1));
                    }}
                  >
                    <option value="">{t("femme.commissions.groups.chooseGroup")}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
            {withSuggestion.length > 0 && (
              <Button
                type="button"
                className={`${ACTION_BUTTON} mt-2`}
                data-testid="groups-accept-all"
                onClick={() =>
                  void run(
                    () =>
                      assignGroups(withSuggestion.map((s) => ({ serviceId: s.serviceId, groupId: s.suggestion!.groupId }))),
                    assigned(withSuggestion.length),
                  )
                }
              >
                {t("femme.commissions.groups.acceptAll")}
              </Button>
            )}
          </>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-base font-extrabold text-ink">
            {t("femme.commissions.groups.listTitle")} <span className="text-sm font-semibold text-ink-3">· {groups.length}</span>
          </h3>
          <Button
            type="button"
            variant="secondary"
            className={ACTION_BUTTON}
            data-testid="groups-new"
            onClick={() => {
              setNameError(null);
              setEditing({ id: null, name: "" });
            }}
          >
            {t("femme.commissions.groups.newGroup")}
          </Button>
        </div>
        {groups.length === 0 ? (
          <Text variant="muted" className="mt-2" data-testid="groups-empty">
            {t("femme.commissions.groups.empty")}
          </Text>
        ) : (
          <ul className="mt-2" data-testid="groups-list">
            {groups.map((g) => (
              <li
                key={g.id}
                data-testid="group-row"
                data-group-name={g.name}
                className="grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-3 border-t border-line py-2 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-extrabold text-ink">{g.name}</div>
                  <div className="truncate text-xs text-ink-3">{g.serviceNames.join(" · ")}</div>
                </div>
                <div className="text-right text-sm text-ink-2">
                  <div data-testid="group-services">{t("femme.commissions.groups.services", { count: g.serviceCount })}</div>
                  <div className="text-xs text-ink-3" data-testid="group-professionals">
                    {t("femme.commissions.groups.colProfessionals")}: {g.professionalsWithRule}
                  </div>
                </div>
                <KebabMenu
                  id={`group-actions-${g.id}`}
                  triggerAriaLabel={t("femme.commissions.groups.rowActions", { name: g.name })}
                  items={[
                    {
                      id: "rename",
                      label: t("femme.commissions.groups.rename"),
                      onSelect: () => {
                        setNameError(null);
                        setEditing({ id: g.id, name: g.name });
                      },
                    },
                    { id: "delete", label: t("femme.commissions.groups.delete"), onSelect: () => setToDelete(g) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-3 shadow-sm sm:p-4" data-testid="groups-products">
        <h3 className="font-heading text-base font-extrabold text-ink">{t("femme.commissions.groups.productsTitle")}</h3>
        {products.length === 0 ? (
          <Text variant="muted" className="mt-2">
            {t("femme.commissions.groups.productsNone")}
          </Text>
        ) : (
          <div className="mt-1 flex flex-col gap-2">
            <Text variant="small" className="text-ink-3">
              {t("femme.commissions.groups.productsDescription")} {t("femme.commissions.groups.productsCount", { count: products.length })}
            </Text>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="groups-products-group">{t("femme.commissions.groups.productsGroup")}</Label>
                <Select
                  id="groups-products-group"
                  className="w-56"
                  value={productGroup}
                  data-testid="groups-products-group"
                  onChange={(e) => setProductGroup(e.target.value)}
                >
                  <option value="">{t("femme.commissions.groups.chooseGroup")}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                className={ACTION_BUTTON}
                disabled={!productGroup}
                data-testid="groups-products-assign"
                onClick={() =>
                  void run(() => assignUngroupedToGroup(Number(productGroup), "PRODUCT"), assigned(products.length))
                }
              >
                {t("femme.commissions.groups.productsAssign")}
              </Button>
            </div>
          </div>
        )}
      </section>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t(editing?.id === null ? "femme.commissions.groups.newTitle" : "femme.commissions.groups.renameTitle")}
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setEditing(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} data-testid="groups-save" onClick={() => void saveGroup()}>
              {editing?.id === null ? t("femme.commissions.groups.create") : t("femme.commissions.common.save")}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void saveGroup();
          }}
        >
          <Label htmlFor="groups-name">{t("femme.commissions.groups.nameLabel")}</Label>
          <Input
            id="groups-name"
            value={editing?.name ?? ""}
            placeholder={t("femme.commissions.groups.namePlaceholder")}
            invalid={!!nameError}
            aria-describedby={nameError ? "groups-name-error" : undefined}
            data-testid="groups-name"
            onChange={(e) => {
              setNameError(null);
              setEditing((cur) => (cur ? { ...cur, name: e.target.value } : cur));
            }}
          />
          <FieldValidationError id="groups-name-error">{nameError}</FieldValidationError>
        </form>
      </Modal>

      <ConfirmDialog
        open={toDelete !== null}
        title={t("femme.commissions.groups.deleteTitle")}
        description={t("femme.commissions.groups.deleteDescription", { name: toDelete?.name ?? "" })}
        cancelLabel={t("femme.commissions.common.back")}
        confirmLabel={t("femme.commissions.groups.delete")}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          const id = toDelete.id;
          setToDelete(null);
          await run(() => deleteGroup(id), t("femme.commissions.groups.deleted"));
        }}
      />
    </div>
  );
}
