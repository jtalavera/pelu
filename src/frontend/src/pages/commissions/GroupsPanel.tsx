import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, KebabMenu, Label, Modal, Select, Spinner, Text } from "@design-system";
import {
  assignGroups,
  createGroup,
  deleteGroup,
  getGroupServices,
  getGroups,
  renameGroup,
  type GroupServiceRow,
  type GroupView,
  type ItemKind,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FieldValidationError } from "../../components/FieldValidationError";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { formatGuaraniesGs } from "../../lib/formatMoney";

type Scope = "UNGROUPED" | "GROUPED" | "ALL";
const NEW_GROUP = "__new__";
/** Rows drawn at once (the rest appears with «Show more»), and how long an assigned row stays marked. */
const PAGE = 50;
const RECENT_MS = 1600;

/** Case- and accent-insensitive text ("pestanas" finds "Pestañas"). */
const normalize = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * HU-COM-14 «Grupos»: every catalog item with its commission group, a search and filters to find
 * one, assignment one by one or in bulk (with the name suggestions), and group management —
 * including creating a group on the spot and assigning the selected items to it.
 */
export function GroupsPanel() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ItemKind>("SERVICE");
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [items, setItems] = useState<Record<ItemKind, GroupServiceRow[]>>({ SERVICE: [], PRODUCT: [] });
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope | null>(null);
  const [groupFilter, setGroupFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkGroup, setBulkGroup] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; name: string; assignSelected: boolean } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<GroupView | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Rows just assigned: they stay where they are for a moment, marked, instead of jumping out of the filter. */
  const [recent, setRecent] = useState<Record<number, string>>({});
  /** Rows whose change is being saved (shown dimmed until the server answers). */
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE);
  /** Saves in flight: a refresh that started before them must not overwrite what is on screen. */
  const inFlight = useRef(0);
  const mutation = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const load = useCallback(async () => {
    const mine = mutation.current;
    try {
      const [g, s, p] = await Promise.all([getGroups(), getGroupServices("SERVICE"), getGroupServices("PRODUCT")]);
      // Something changed (or is being saved) while this was loading: the next refresh is the right one.
      if (mine !== mutation.current || inFlight.current > 0) return;
      setGroups(g);
      setItems({ SERVICE: s, PRODUCT: p });
      setScope((cur) => cur ?? (s.some((x) => x.groupId === null) ? "UNGROUPED" : "ALL"));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = items[kind];
  const counts = useMemo(
    () => ({
      UNGROUPED: rows.filter((r) => r.groupId === null).length,
      GROUPED: rows.filter((r) => r.groupId !== null).length,
      ALL: rows.length,
    }),
    [rows],
  );
  const needle = normalize(query.trim());
  // A new search or filter starts again from the first page of rows.
  const filterKey = `${kind}|${scope}|${groupFilter}|${needle}`;
  const [seenKey, setSeenKey] = useState(filterKey);
  if (seenKey !== filterKey) {
    setSeenKey(filterKey);
    setVisibleCount(PAGE);
  }
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (recent[r.serviceId]) return true;
        if (groupFilter) return String(r.groupId) === groupFilter;
        if (scope === "UNGROUPED") return r.groupId === null;
        if (scope === "GROUPED") return r.groupId !== null;
        return true;
      }).filter((r) => !needle || normalize(r.name).includes(needle)),
    [rows, scope, groupFilter, needle, recent],
  );
  const suggestible = filtered.filter((r) => r.suggestion);
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.serviceId));

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

  const assignedText = (count: number) =>
    t(kind === "PRODUCT" ? "femme.commissions.groups.assignedProducts" : "femme.commissions.groups.assigned", { count });

  /**
   * Assigns the items (null group = removes them from their group). The screen changes right away
   * and the server confirms in the background; if it refuses, the real state is read again.
   */
  async function assignMany(pairs: { serviceId: number; groupId: number | null }[], success: string, extraGroups?: GroupView[]) {
    if (pairs.length === 0) return;
    setNotice(null);
    const ids = pairs.map((x) => x.serviceId);
    const names = new Map((extraGroups ?? groups ?? []).concat(groups ?? []).map((g) => [g.id, g.name]));
    const target = new Map(pairs.map((x) => [x.serviceId, x.groupId]));
    mutation.current += 1;
    inFlight.current += 1;
    const before = new Map<number, number | null>();
    setItems((cur) => {
      const next = { ...cur };
      for (const k of ["SERVICE", "PRODUCT"] as const) {
        next[k] = cur[k].map((r) => {
          if (!target.has(r.serviceId)) return r;
          before.set(r.serviceId, r.groupId);
          const groupId = target.get(r.serviceId) ?? null;
          return { ...r, groupId, groupName: groupId === null ? null : (names.get(groupId) ?? null), suggestion: null };
        });
      }
      return next;
    });
    setGroups((cur) =>
      cur
        ? cur.map((g) => {
            let delta = 0;
            for (const [id, to] of target) {
              if (before.get(id) === g.id && to !== g.id) delta -= 1;
              if (to === g.id && before.get(id) !== g.id) delta += 1;
            }
            return delta === 0 ? g : { ...g, serviceCount: Math.max(0, g.serviceCount + delta) };
          })
        : cur,
    );
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setRecent((cur) => ({ ...cur, ...Object.fromEntries(pairs.map((x) => [x.serviceId, x.groupId === null ? "-" : (names.get(x.groupId) ?? "")])) }));
    setSaving((cur) => new Set([...cur, ...ids]));
    timers.current.push(
      window.setTimeout(() => {
        setRecent((cur) => {
          const next = { ...cur };
          ids.forEach((id) => delete next[id]);
          return next;
        });
      }, RECENT_MS),
    );
    try {
      await assignGroups(pairs);
      setError(null);
      setNotice(success);
    } catch (err) {
      setError(translateApiError(err, t));
      setRecent((cur) => {
        const next = { ...cur };
        ids.forEach((id) => delete next[id]);
        return next;
      });
    } finally {
      inFlight.current -= 1;
      setSaving((cur) => {
        const next = new Set(cur);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      // Reads the real state (counts, suggestions of the ones taken out of a group) without blocking.
      mutation.current += 1;
      void load();
    }
  }

  const assign = (ids: number[], groupId: number | null) =>
    assignMany(
      ids.map((serviceId) => ({ serviceId, groupId })),
      groupId === null ? t("femme.commissions.groups.removed", { count: ids.length }) : assignedText(ids.length),
    );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openNewGroup() {
    setNameError(null);
    setEditing({ id: null, name: "", assignSelected: selected.size > 0 });
  }

  async function saveGroup() {
    if (!editing) return;
    if (!editing.name.trim()) {
      setNameError(t("femme.commissions.groups.nameRequired"));
      return;
    }
    const { id, name, assignSelected } = editing;
    try {
      if (id === null) {
        const made = await createGroup(name);
        const created: GroupView = { ...made, serviceCount: made.serviceCount ?? 0, serviceNames: made.serviceNames ?? [], professionalsWithRule: made.professionalsWithRule ?? 0 };
        const ids = [...selected];
        setGroups((cur) => (cur ? [...cur, created].sort((x, y) => x.name.localeCompare(y.name)) : cur));
        if (assignSelected && ids.length > 0) {
          setEditing(null);
          setBulkGroup("");
          void assignMany(
            ids.map((serviceId) => ({ serviceId, groupId: created.id })),
            t("femme.commissions.groups.createdAndAssigned"),
            [created],
          );
          return;
        }
        setNotice(t("femme.commissions.groups.created"));
      } else {
        await renameGroup(id, name);
        setNotice(t("femme.commissions.groups.renamed"));
      }
      setEditing(null);
      await load();
    } catch (err) {
      setNameError(translateApiError(err, t));
    }
  }

  function showGroup(g: GroupView) {
    setGroupFilter(String(g.id));
    setScope("ALL");
    setKind("SERVICE");
    listRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  if (!groups) return error ? <Alert variant="destructive">{error}</Alert> : <Spinner />;

  const chip = (value: Scope) => (
    <button
      key={value}
      type="button"
      aria-pressed={!groupFilter && scope === value}
      data-testid={`groups-scope-${value}`}
      onClick={() => {
        setScope(value);
        setGroupFilter("");
      }}
      className={`min-h-9 rounded-full border px-3.5 text-[13px] font-bold ${
        !groupFilter && scope === value ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink hover:bg-bg"
      }`}
    >
      {t(`femme.commissions.groups.scope${value}`, { count: counts[value] })}
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="commission-groups">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 max-w-xl px-0.5 text-sm text-ink-3">{t("femme.commissions.groups.intro")}</p>
        <Button type="button" className={ACTION_BUTTON} data-testid="groups-new" onClick={openNewGroup}>
          {t("femme.commissions.groups.newGroup")}
        </Button>
      </div>
      {notice && (
        <Alert variant="success" role="status" data-testid="groups-notice">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <section ref={listRef} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-sm sm:p-4" data-testid="groups-items">
        <div
          role="group"
          aria-label={t("femme.commissions.groups.kindAria")}
          className="grid max-w-xs grid-cols-2 gap-1 rounded-2xl bg-primary-lt p-1"
        >
          {(["SERVICE", "PRODUCT"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              data-testid={`groups-kind-${k}`}
              onClick={() => {
                setKind(k);
                setSelected(new Set());
                setGroupFilter("");
              }}
              className="min-h-10 rounded-[10px] bg-transparent text-sm font-bold text-ink-2 aria-pressed:bg-surface aria-pressed:text-primary aria-pressed:shadow-[0_1px_2px_rgba(10,31,51,0.12)]"
            >
              {t(`femme.commissions.groups.kind${k}`, { count: items[k].length })}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form role="search" onSubmit={(e) => e.preventDefault()} className="flex min-w-0 flex-1 basis-64 items-center gap-1">
            <Label htmlFor="groups-search" className="sr-only">
              {t(kind === "PRODUCT" ? "femme.commissions.groups.searchProductLabel" : "femme.commissions.groups.searchServiceLabel")}
            </Label>
            <Input
              id="groups-search"
              type="search"
              value={query}
              placeholder={t("femme.commissions.groups.searchPlaceholder")}
              data-testid="groups-search"
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" variant="secondary" className={ACTION_BUTTON} data-testid="groups-search-submit">
              {t("femme.commissions.groups.searchSubmit")}
            </Button>
          </form>
          <Select
            aria-label={t("femme.commissions.groups.groupFilter")}
            value={groupFilter}
            className="w-52"
            data-testid="groups-group-filter"
            onChange={(e) => {
              setGroupFilter(e.target.value);
              if (e.target.value) setScope("ALL");
            }}
          >
            <option value="">{t("femme.commissions.groups.groupFilterAll")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>

        <div role="group" aria-label={t("femme.commissions.groups.scopeAria")} className="flex flex-wrap gap-2">
          {(["UNGROUPED", "GROUPED", "ALL"] as const).map(chip)}
        </div>

        {filtered.length === 0 ? (
          <Text variant="muted" data-testid="groups-no-matches">
            {t("femme.commissions.groups.noMatches")}
          </Text>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2 text-sm text-ink-3">
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--color-primary)]"
                  checked={allSelected}
                  data-testid="groups-select-all"
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (allSelected) filtered.forEach((r) => next.delete(r.serviceId));
                      else filtered.forEach((r) => next.add(r.serviceId));
                      return next;
                    })
                  }
                />
                {t("femme.commissions.groups.selectAllMatches", { count: filtered.length })}
              </label>
              {suggestible.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  className={`${ACTION_BUTTON} ml-auto`}
                  data-testid="groups-accept-all"
                  onClick={() =>
                    void assignMany(
                      suggestible.map((r) => ({ serviceId: r.serviceId, groupId: r.suggestion!.groupId })),
                      assignedText(suggestible.length),
                    )
                  }
                >
                  {t("femme.commissions.groups.acceptSuggestions", { count: suggestible.length })}
                </Button>
              )}
            </div>
            <ul data-testid="groups-rows">
              {filtered.slice(0, visibleCount).map((r) => (
                <li
                  key={r.serviceId}
                  data-testid="groups-row"
                  data-name={r.name}
                  data-state={saving.has(r.serviceId) ? "saving" : recent[r.serviceId] ? "assigned" : undefined}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-1 py-2 transition-colors duration-300 ${
                    recent[r.serviceId] ? "bg-success-lt" : selected.has(r.serviceId) ? "bg-primary-lt/40" : ""
                  } ${saving.has(r.serviceId) ? "opacity-70" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
                    checked={selected.has(r.serviceId)}
                    aria-label={t("femme.commissions.groups.selectRow", { name: r.name })}
                    data-testid="groups-row-check"
                    onChange={() => toggle(r.serviceId)}
                  />
                  <div className="min-w-0 flex-1 basis-44">
                    <div className="break-words font-extrabold text-ink">{r.name}</div>
                    <div className="text-xs text-ink-3">
                      {[r.categoryName, r.price !== null ? formatGuaraniesGs(r.price) : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span
                    data-testid="groups-row-chip"
                    className={`inline-flex min-h-[30px] items-center rounded-full px-3 text-xs font-extrabold ${
                      r.groupName ? "bg-primary-lt text-primary" : "bg-warning-lt text-warning"
                    }`}
                  >
                    {recent[r.serviceId] ? "✓ " : ""}
                    {r.groupName ?? t("femme.commissions.groups.noGroup")}
                  </span>
                  {r.suggestion && (
                    <>
                      <span
                        data-testid="groups-suggestion"
                        className="inline-flex min-h-8 items-center rounded-full bg-warning-lt px-3 text-xs font-extrabold text-warning"
                      >
                        {t("femme.commissions.groups.suggested", { group: r.suggestion.groupName, reason: r.suggestion.reason })}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        className={ACTION_BUTTON}
                        data-testid="groups-accept"
                        disabled={saving.has(r.serviceId)}
                        aria-label={t("femme.commissions.groups.acceptAria", { name: r.name })}
                        onClick={() => void assign([r.serviceId], r.suggestion!.groupId)}
                      >
                        {t("femme.commissions.groups.accept")}
                      </Button>
                    </>
                  )}
                  <Select
                    aria-label={t("femme.commissions.groups.chooseAria", { name: r.name })}
                    value={r.groupId === null ? "" : String(r.groupId)}
                    className="w-44"
                    disabled={saving.has(r.serviceId)}
                    data-testid="groups-row-select"
                    onChange={(e) => {
                      const v = e.target.value;
                      void assign([r.serviceId], v === "" ? null : Number(v));
                    }}
                  >
                    <option value="">
                      {t(r.groupId === null ? "femme.commissions.groups.chooseGroupUngrouped" : "femme.commissions.groups.removeFromGroup")}
                    </option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
            {filtered.length > visibleCount && (
              <Button
                type="button"
                variant="secondary"
                className={`${ACTION_BUTTON} mt-2 w-full`}
                data-testid="groups-show-more"
                onClick={() => setVisibleCount((n) => n + PAGE)}
              >
                {t("femme.commissions.groups.showMore", { count: filtered.length - visibleCount })}
              </Button>
            )}
          </>
        )}

        {selected.size > 0 && (
          <div
            data-testid="groups-bulk-bar"
            className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-surface shadow-lg"
          >
            <b className="text-sm" data-testid="groups-selected">
              {t("femme.commissions.groups.selected", { count: selected.size })}
            </b>
            <span className="text-sm">{t("femme.commissions.groups.assignTo")}</span>
            <Select
              aria-label={t("femme.commissions.groups.assignTo")}
              value={bulkGroup}
              className="w-52 text-ink"
              data-testid="groups-bulk-select"
              onChange={(e) => {
                const v = e.target.value;
                if (v === NEW_GROUP) {
                  setBulkGroup("");
                  openNewGroup();
                } else setBulkGroup(v);
              }}
            >
              <option value="">{t("femme.commissions.groups.assignChoose")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value={NEW_GROUP}>{t("femme.commissions.groups.createGroupOption")}</option>
            </Select>
            <Button
              type="button"
              className={ACTION_BUTTON}
              disabled={!bulkGroup}
              data-testid="groups-bulk-assign"
              onClick={() => void assign([...selected], Number(bulkGroup)).then(() => setBulkGroup(""))}
            >
              {t("femme.commissions.groups.assign")}
            </Button>
            <button
              type="button"
              className="ml-auto min-h-11 px-2 text-sm font-bold text-primary-lt"
              data-testid="groups-bulk-clear"
              onClick={() => setSelected(new Set())}
            >
              {t("femme.commissions.groups.clearSelection")}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-3 shadow-sm sm:p-4">
        <h3 className="font-heading text-base font-extrabold text-ink">
          {t("femme.commissions.groups.listTitle")}{" "}
          <span className="text-sm font-semibold text-ink-3">
            · {groups.length} · {t("femme.commissions.groups.listHint")}
          </span>
        </h3>
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
                className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2 border-t border-line first:border-t-0"
              >
                <button
                  type="button"
                  data-testid="group-open"
                  aria-label={t("femme.commissions.groups.showItems", { name: g.name })}
                  onClick={() => showGroup(g)}
                  className="grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-extrabold text-ink">{g.name}</span>
                    <span className="block truncate text-xs text-ink-3">{g.serviceNames.join(" · ")}</span>
                  </span>
                  <span className="text-right text-sm text-ink-2">
                    <span className="block" data-testid="group-services">
                      {t("femme.commissions.groups.services", { count: g.serviceCount })}
                    </span>
                    <span className="block text-xs text-ink-3" data-testid="group-professionals">
                      {t("femme.commissions.groups.colProfessionals")}: {g.professionalsWithRule}
                    </span>
                  </span>
                </button>
                <KebabMenu
                  id={`group-actions-${g.id}`}
                  triggerAriaLabel={t("femme.commissions.groups.rowActions", { name: g.name })}
                  items={[
                    {
                      id: "rename",
                      label: t("femme.commissions.groups.rename"),
                      onSelect: () => {
                        setNameError(null);
                        setEditing({ id: g.id, name: g.name, assignSelected: false });
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
              {editing?.id !== null
                ? t("femme.commissions.common.save")
                : editing?.assignSelected
                  ? t("femme.commissions.groups.createAndAssign")
                  : t("femme.commissions.groups.create")}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveGroup();
          }}
        >
          <div className="flex flex-col gap-1">
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
          </div>
          {editing?.id === null && selected.size > 0 && (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-primary bg-primary-lt p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-[var(--color-primary)]"
                checked={editing.assignSelected}
                data-testid="groups-assign-selected"
                onChange={(e) => setEditing((cur) => (cur ? { ...cur, assignSelected: e.target.checked } : cur))}
              />
              <b>{t("femme.commissions.groups.assignSelected", { count: selected.size })}</b>
            </label>
          )}
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
          if (groupFilter === String(id)) setGroupFilter("");
          await run(() => deleteGroup(id), t("femme.commissions.groups.deleted"));
        }}
      />
    </div>
  );
}
