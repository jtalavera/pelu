import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
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
import { useOverview } from "./overview";
import { formatPercent } from "./common";

type Item = GroupServiceRow & { kind: ItemKind };
type Scope = "UNGROUPED" | "GROUPED" | "ALL";

const NEW_GROUP = "__new__";
/** Rows drawn at once (the rest appears with «Show more»), and how long an assigned row stays marked. */
const PAGE = 50;
const RECENT_MS = 1600;
const NONE = "none";

/** Case- and accent-insensitive text ("pestanas" finds "Pestañas"). */
const normalize = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** How many items (and which, first ones by name) each group has, from the rows on screen. */
function withMembers(groups: GroupView[], items: Item[]): GroupView[] {
  const members = new Map<number, string[]>();
  for (const r of items) {
    if (r.groupId !== null) members.set(r.groupId, [...(members.get(r.groupId) ?? []), r.name]);
  }
  return groups.map((g) => {
    const names = (members.get(g.id) ?? []).sort((a, b) => a.localeCompare(b));
    return { ...g, serviceCount: names.length, serviceNames: names.slice(0, 6) };
  });
}

/**
 * HU-COM-16 «Grupos y servicios»: the groups on the left (with «Sin grupo» always on top) and the
 * services of the chosen group on the right; a search that finds a group or a service and says where
 * it is; assignment one by one, in bulk, by name suggestion, or from «Add services»; and group
 * management. Assigning changes the screen at once and the server confirms in the background.
 */
export function GroupsWorkspace() {
  const { t } = useTranslation();
  const { refresh: refreshOverview } = useOverview();
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [items, setItems] = useState<Record<ItemKind, GroupServiceRow[]>>({ SERVICE: [], PRODUCT: [] });
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkGroup, setBulkGroup] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; name: string; assignSelected: boolean } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<GroupView | null>(null);
  const [adding, setAdding] = useState(false);
  /** Rows just assigned (value: the view they were in): they stay put, marked, instead of jumping out. */
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
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const all: Item[] = useMemo(
    () =>
      [...items.SERVICE.map((r) => ({ ...r, kind: "SERVICE" as const })), ...items.PRODUCT.map((r) => ({ ...r, kind: "PRODUCT" as const }))].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    [items],
  );
  const shownGroups = useMemo(() => (groups ? withMembers(groups, all) : null), [groups, all]);
  const ungrouped = useMemo(() => all.filter((r) => r.groupId === null), [all]);

  // Which view is open: «Sin grupo» ("none") or a group id. On a phone nothing is open until one is chosen.
  const explicit = params.get("group");
  const known = explicit === NONE || (explicit !== null && !!shownGroups?.some((g) => String(g.id) === explicit));
  const fallback = ungrouped.length > 0 ? NONE : shownGroups?.[0] ? String(shownGroups[0].id) : null;
  const current = known ? explicit : fallback;
  const group = current && current !== NONE ? (shownGroups?.find((g) => String(g.id) === current) ?? null) : null;

  const needle = normalize(query.trim());
  const searching = needle !== "";
  const viewKey = searching ? "search" : (current ?? "");

  function openView(key: string | null) {
    setSelected(new Set());
    setBulkGroup("");
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (key === null) next.delete("group");
        else next.set("group", key);
        next.delete("q");
        return next;
      },
      { replace: true },
    );
    setQuery("");
    setVisibleCount(PAGE);
  }

  // The rows of the current view (the search wins over the open group).
  const viewRows = useMemo(() => {
    const base = searching
      ? all.filter((r) => normalize(r.name).includes(needle))
      : current === NONE
        ? all.filter((r) => r.groupId === null)
        : current
          ? all.filter((r) => String(r.groupId) === current)
          : [];
    // A row that was just assigned from this view stays where it was for a moment.
    const keep = all.filter((r) => recent[r.serviceId] === viewKey && !base.some((b) => b.serviceId === r.serviceId));
    return [...base, ...keep].sort((a, b) => a.name.localeCompare(b.name));
  }, [all, searching, needle, current, recent, viewKey]);
  const matchingGroups = useMemo(
    () => (searching ? (shownGroups ?? []).filter((g) => normalize(g.name).includes(needle)) : []),
    [searching, shownGroups, needle],
  );
  const suggestible = viewRows.filter((r) => r.suggestion);
  const allSelected = viewRows.length > 0 && viewRows.every((r) => selected.has(r.serviceId));

  // A new search or view starts again from the first page of rows.
  const pageKey = `${viewKey}|${needle}`;
  const [seenKey, setSeenKey] = useState(pageKey);
  if (seenKey !== pageKey) {
    setSeenKey(pageKey);
    setVisibleCount(PAGE);
  }

  const assignedText = (rows: Item[]) => {
    const products = rows.length > 0 && rows.every((r) => r.kind === "PRODUCT");
    return t(products ? "femme.commissions.groups.assignedProducts" : "femme.commissions.groups.assigned", { count: rows.length });
  };

  /**
   * Assigns the items (null group = removes them from their group). The screen changes right away and
   * the server confirms in the background; the answer carries each item as the list shows it, so
   * nothing is read again unless the server refused (then the real state is read to undo what was shown).
   */
  async function assignMany(
    pairs: { serviceId: number; groupId: number | null }[],
    success: string,
    extraGroups?: GroupView[],
  ) {
    if (pairs.length === 0) return;
    setNotice(null);
    const ids = pairs.map((x) => x.serviceId);
    const names = new Map([...(extraGroups ?? []), ...(groups ?? [])].map((g) => [g.id, g.name]));
    const target = new Map(pairs.map((x) => [x.serviceId, x.groupId]));
    mutation.current += 1;
    inFlight.current += 1;
    setItems((cur) => {
      const next = { ...cur };
      for (const k of ["SERVICE", "PRODUCT"] as const) {
        next[k] = cur[k].map((r) => {
          if (!target.has(r.serviceId)) return r;
          const groupId = target.get(r.serviceId) ?? null;
          return { ...r, groupId, groupName: groupId === null ? null : (names.get(groupId) ?? null), suggestion: null };
        });
      }
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setRecent((cur) => ({ ...cur, ...Object.fromEntries(ids.map((id) => [id, viewKey])) }));
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
    let failed = false;
    try {
      const res = await assignGroups(pairs);
      const fresh = new Map((res.rows ?? []).map((r) => [r.serviceId, r]));
      if (fresh.size > 0) {
        setItems((cur) => ({
          SERVICE: cur.SERVICE.map((r) => fresh.get(r.serviceId) ?? r),
          PRODUCT: cur.PRODUCT.map((r) => fresh.get(r.serviceId) ?? r),
        }));
      }
      setError(null);
      setNotice(success);
      void refreshOverview();
    } catch (err) {
      failed = true;
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
      if (failed) {
        mutation.current += 1;
        void load();
      }
    }
  }

  const assign = (rows: Item[], groupId: number | null) =>
    assignMany(
      rows.map((r) => ({ serviceId: r.serviceId, groupId })),
      groupId === null ? t("femme.commissions.groups.removed", { count: rows.length }) : assignedText(rows),
    );
  const itemsOf = (ids: number[]) => all.filter((r) => ids.includes(r.serviceId));

  async function run(action: () => Promise<unknown>, success: string | null) {
    setNotice(null);
    try {
      await action();
      setError(null);
      if (success) setNotice(success);
      mutation.current += 1;
      await load();
      void refreshOverview();
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }

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
        const created: GroupView = {
          ...made,
          serviceCount: made.serviceCount ?? 0,
          serviceNames: made.serviceNames ?? [],
          percent: made.percent ?? null,
        };
        const ids = [...selected];
        setGroups((cur) => (cur ? [...cur, created].sort((x, y) => x.name.localeCompare(y.name)) : cur));
        setEditing(null);
        setBulkGroup("");
        void refreshOverview();
        if (assignSelected && ids.length > 0) {
          void assignMany(
            ids.map((serviceId) => ({ serviceId, groupId: created.id })),
            t("femme.commissions.groups.createdAndAssigned"),
            [created],
          );
          openView(String(created.id));
          return;
        }
        setNotice(t("femme.commissions.groups.created"));
        openView(String(created.id));
        return;
      }
      await renameGroup(id, name);
      setNotice(t("femme.commissions.groups.renamed"));
      setEditing(null);
      mutation.current += 1;
      await load();
    } catch (err) {
      setNameError(translateApiError(err, t));
    }
  }

  if (!groups || !shownGroups) return error ? <Alert variant="destructive">{error}</Alert> : <Spinner />;

  const itemRow = (r: Item) => {
    const isSaving = saving.has(r.serviceId);
    const state = isSaving ? "saving" : recent[r.serviceId] ? "assigned" : undefined;
    return (
      <li
        key={`${r.kind}-${r.serviceId}`}
        data-testid="groups-row"
        data-name={r.name}
        data-state={state}
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-1 py-2 transition-colors duration-300 ${
          recent[r.serviceId] ? "bg-success-lt" : selected.has(r.serviceId) ? "bg-primary-lt/40" : ""
        } ${isSaving ? "opacity-70" : ""}`}
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
            {[r.kind === "PRODUCT" ? t("femme.commissions.workspace.product") : null, r.categoryName, r.price !== null ? formatGuaraniesGs(r.price) : null]
              .filter(Boolean)
              .join(" · ")}
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
            <span data-testid="groups-suggestion" className="inline-flex min-h-8 items-center rounded-full bg-warning-lt px-3 text-xs font-extrabold text-warning">
              {t("femme.commissions.groups.suggested", { group: r.suggestion.groupName, reason: r.suggestion.reason })}
            </span>
            <Button
              type="button"
              variant="secondary"
              className={ACTION_BUTTON}
              data-testid="groups-accept"
              disabled={isSaving}
              aria-label={t("femme.commissions.groups.acceptAria", { name: r.name })}
              onClick={() => void assign([r], r.suggestion!.groupId)}
            >
              {t("femme.commissions.groups.accept")}
            </Button>
          </>
        )}
        <Select
          aria-label={t("femme.commissions.groups.chooseAria", { name: r.name })}
          value={r.groupId === null ? "" : String(r.groupId)}
          className="w-44"
          disabled={isSaving}
          data-testid="groups-row-select"
          onChange={(e) => {
            const v = e.target.value;
            void assign([r], v === "" ? null : Number(v));
          }}
        >
          <option value="">{t(r.groupId === null ? "femme.commissions.groups.chooseGroupUngrouped" : "femme.commissions.groups.removeFromGroup")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </li>
    );
  };

  const rowsToShow = viewRows.slice(0, visibleCount);
  const toolbar = viewRows.length > 0 && (
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--color-primary)]"
          checked={allSelected}
          data-testid="groups-select-all"
          onChange={() =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (allSelected) viewRows.forEach((r) => next.delete(r.serviceId));
              else viewRows.forEach((r) => next.add(r.serviceId));
              return next;
            })
          }
        />
        {t("femme.commissions.groups.selectAllMatches", { count: viewRows.length })}
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
              assignedText(suggestible),
            )
          }
        >
          {t("femme.commissions.groups.acceptSuggestions", { count: suggestible.length })}
        </Button>
      )}
    </div>
  );
  const showMore = viewRows.length > visibleCount && (
    <Button type="button" variant="secondary" className={`${ACTION_BUTTON} mt-2 w-full`} data-testid="groups-show-more" onClick={() => setVisibleCount((n) => n + PAGE)}>
      {t("femme.commissions.groups.showMore", { count: viewRows.length - visibleCount })}
    </Button>
  );

  // ── Left: the groups ─────────────────────────────────────────────────────────────────────────
  const groupButton = (key: string, children: React.ReactNode, on: boolean, testId: string, extra?: Record<string, string>) => (
    <button
      type="button"
      key={key}
      data-testid={testId}
      aria-current={on ? "true" : undefined}
      onClick={() => openView(key)}
      {...extra}
      className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border-2 px-3.5 py-2 text-left ${
        on ? "border-primary bg-primary-lt" : "border-transparent hover:bg-bg"
      }`}
    >
      {children}
    </button>
  );
  const listPane = (
    <aside
      aria-label={t("femme.commissions.groups.listTitle")}
      className={`${explicit !== null && !searching ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col gap-1 rounded-card border border-line bg-surface p-2.5 shadow-sm md:w-72`}
    >
      <button
        type="button"
        data-testid="group-none"
        aria-current={current === NONE ? "true" : undefined}
        onClick={() => openView(NONE)}
        className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 px-3.5 py-2 text-left ${
          current === NONE ? "border-warning bg-warning-lt" : "border-line bg-warning-lt/60 hover:bg-warning-lt"
        }`}
      >
        <span className="min-w-0">
          <b className="block font-extrabold text-warning">{t("femme.commissions.groups.noGroup")}</b>
          <span className="text-xs text-warning">{t("femme.commissions.workspace.noGroupSub")}</span>
        </span>
        <span data-testid="group-none-count" className="inline-flex size-[30px] items-center justify-center rounded-full bg-warning text-sm font-extrabold text-surface">
          {ungrouped.length}
        </span>
      </button>
      <div className="mx-1.5 my-1.5 h-px bg-line" aria-hidden />
      {shownGroups.length === 0 ? (
        <Text variant="muted" className="px-2 py-2" data-testid="groups-empty">
          {t("femme.commissions.groups.empty")}
        </Text>
      ) : (
        <ul data-testid="groups-list" className="flex flex-col gap-1">
          {shownGroups.map((g) => (
            <li key={g.id}>
              {groupButton(
                String(g.id),
                <>
                  <span className="min-w-0">
                    <b className={`block truncate font-extrabold ${current === String(g.id) ? "text-primary" : "text-ink"}`}>{g.name}</b>
                    <span className="block truncate text-xs text-ink-3">{g.serviceNames.join(" · ")}</span>
                  </span>
                  <span className="text-sm font-extrabold text-ink-2" data-testid="group-row-count">
                    {g.serviceCount}
                  </span>
                </>,
                current === String(g.id),
                "group-row",
                { "data-group-name": g.name },
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" data-testid="groups-new-inline" onClick={openNewGroup} className="flex min-h-12 items-center px-3.5 text-sm font-extrabold text-primary">
        {t("femme.commissions.workspace.createGroupInline")}
      </button>
    </aside>
  );

  // ── Right: the open group (or «Sin grupo») ───────────────────────────────────────────────────
  const detailPane = (
    <section
      aria-label={group ? group.name : t("femme.commissions.groups.noGroup")}
      className={`${explicit !== null || searching ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5`}
      data-testid="groups-detail"
    >
      <button type="button" className="min-h-11 self-start text-sm font-bold text-primary md:hidden" data-testid="groups-back-list" onClick={() => openView(null)}>
        ← {t("femme.commissions.workspace.allGroups")}
      </button>
      {current === NONE && (
        <>
          <div>
            <h3 className="font-heading text-xl font-extrabold text-ink">{t("femme.commissions.groups.noGroup")}</h3>
            <p className="text-sm text-ink-3">{t("femme.commissions.groups.ungroupedHint")}</p>
          </div>
          {viewRows.length === 0 ? (
            <Text variant="muted" data-testid="groups-no-matches">
              {t("femme.commissions.groups.ungroupedEmpty")}
            </Text>
          ) : null}
        </>
      )}
      {group && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words font-heading text-xl font-extrabold text-ink" data-testid="group-title">
                {group.name}
              </h3>
              <p className="text-sm text-ink-3" data-testid="group-summary">
                {t("femme.commissions.groups.services", { count: group.serviceCount })} ·{" "}
                <span data-testid="group-percent">{group.percent === null ? t("femme.commissions.workspace.noPercent") : formatPercent(group.percent)}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className={ACTION_BUTTON}
                data-testid="groups-rename"
                onClick={() => {
                  setNameError(null);
                  setEditing({ id: group.id, name: group.name, assignSelected: false });
                }}
              >
                {t("femme.commissions.groups.rename")}
              </Button>
              <Button type="button" className={ACTION_BUTTON} data-testid="groups-add-open" onClick={() => setAdding(true)}>
                + {t("femme.commissions.workspace.addItems")}
              </Button>
              <KebabMenu
                id={`group-actions-${group.id}`}
                triggerAriaLabel={t("femme.commissions.groups.rowActions", { name: group.name })}
                items={[{ id: "delete", label: t("femme.commissions.groups.delete"), onSelect: () => setToDelete(group) }]}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary-lt px-3.5 py-2.5 text-sm text-ink">
            <span>{t("femme.commissions.workspace.rulesHint")}</span>
            <Link to={`/app/commissions/configurar/comisiones?q=${encodeURIComponent(group.name)}`} className="min-h-11 content-center font-bold text-primary" data-testid="groups-rules-link">
              {t("femme.commissions.workspace.rulesLink")} →
            </Link>
          </div>
          {viewRows.length === 0 && (
            <div className="rounded-xl border border-dashed border-line p-4 text-center" data-testid="group-empty-items">
              <Text variant="muted">{t("femme.commissions.workspace.groupEmpty")}</Text>
            </div>
          )}
        </>
      )}
      {!current && !searching && (
        <Text variant="muted" data-testid="groups-pick">
          {t("femme.commissions.workspace.pick")}
        </Text>
      )}
      {viewRows.length > 0 && <ul data-testid="groups-rows">{rowsToShow.map(itemRow)}</ul>}
      {showMore}
      {toolbar}
    </section>
  );

  // ── Search results: groups and services that match, each with where it is ────────────────────
  const resultsPane = (
    <div className="flex min-w-0 flex-col gap-3" data-testid="groups-results">
      <div className="text-sm text-ink-2">
        {t("femme.commissions.workspace.resultsFor", { query: query.trim() })}{" "}
        <b>{t("femme.commissions.workspace.resultsGroups", { count: matchingGroups.length })}</b> ·{" "}
        <b>{t("femme.commissions.workspace.resultsItems", { count: viewRows.length })}</b>
      </div>
      {matchingGroups.length > 0 && (
        <section className="rounded-card border border-line bg-surface px-5 py-2 shadow-sm">
          <h3 className="pt-3 text-[13px] font-extrabold uppercase tracking-wide text-ink-3">{t("femme.commissions.workspace.resultsGroupsTitle")}</h3>
          <ul>
            {matchingGroups.map((g) => (
              <li key={g.id} data-testid="groups-result-group" className="flex min-h-16 items-center justify-between gap-3 border-t border-line first:border-t-0">
                <span className="min-w-0">
                  <b className="block text-base text-ink">{g.name}</b>
                  <span className="text-sm text-ink-3">
                    {t("femme.commissions.groups.services", { count: g.serviceCount })} · {g.percent === null ? t("femme.commissions.workspace.noPercent") : formatPercent(g.percent)}
                  </span>
                </span>
                <Button type="button" variant="secondary" className={ACTION_BUTTON} data-testid="groups-result-open" onClick={() => openView(String(g.id))}>
                  {t("femme.commissions.workspace.openGroup")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-sm sm:px-5">
        <h3 className="text-[13px] font-extrabold uppercase tracking-wide text-ink-3">{t("femme.commissions.workspace.resultsItemsTitle")}</h3>
        {viewRows.length === 0 ? (
          <Text variant="muted" data-testid="groups-no-matches">
            {t("femme.commissions.groups.noMatches")}
          </Text>
        ) : (
          <ul data-testid="groups-rows">{rowsToShow.map(itemRow)}</ul>
        )}
        {showMore}
        {toolbar}
      </section>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="commission-groups">
      <form role="search" className="flex flex-wrap gap-2" onSubmit={(e) => e.preventDefault()}>
        <div className="min-w-0 flex-1 basis-64">
          <Label htmlFor="groups-search" className="sr-only">
            {t("femme.commissions.workspace.searchLabel")}
          </Label>
          <Input
            id="groups-search"
            type="search"
            value={query}
            placeholder={t("femme.commissions.workspace.searchPlaceholder")}
            data-testid="groups-search"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {searching && (
          <Button type="button" variant="secondary" className={ACTION_BUTTON} data-testid="groups-search-clear" onClick={() => setQuery("")}>
            {t("femme.commissions.groups.searchClear")}
          </Button>
        )}
        <Button type="button" className={ACTION_BUTTON} data-testid="groups-new" onClick={openNewGroup}>
          {t("femme.commissions.groups.newGroup")}
        </Button>
      </form>

      {notice && (
        <Alert variant="success" role="status" data-testid="groups-notice">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      {searching ? (
        resultsPane
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          {listPane}
          {detailPane}
        </div>
      )}

      {selected.size > 0 && (
        <div data-testid="groups-bulk-bar" className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-surface shadow-lg">
          <b data-testid="groups-selected">{t("femme.commissions.groups.selected", { count: selected.size })}</b>
          <span className="text-sm">{t("femme.commissions.groups.assignTo")}</span>
          <Select
            aria-label={t("femme.commissions.groups.assignTo")}
            value={bulkGroup}
            className="w-48 text-ink"
            data-testid="groups-bulk-select"
            onChange={(e) => {
              if (e.target.value === NEW_GROUP) {
                openNewGroup();
                return;
              }
              setBulkGroup(e.target.value);
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
            onClick={() => void assign(itemsOf([...selected]), Number(bulkGroup)).then(() => setBulkGroup(""))}
          >
            {t("femme.commissions.groups.assign")}
          </Button>
          <button type="button" className="ml-auto min-h-11 px-2 text-sm font-bold text-primary-lt" data-testid="groups-bulk-clear" onClick={() => setSelected(new Set())}>
            {t("femme.commissions.groups.clearSelection")}
          </button>
        </div>
      )}

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
          if (current === String(id)) openView(null);
          await run(() => deleteGroup(id), t("femme.commissions.groups.deleted"));
        }}
      />

      {group && (
        <AddItemsDialog
          open={adding}
          group={group}
          groups={shownGroups}
          items={all}
          onClose={() => setAdding(false)}
          onAdd={(ids) => {
            setAdding(false);
            void assign(itemsOf(ids), group.id);
          }}
        />
      )}
    </div>
  );
}

/** «Add services to a group»: the ungrouped ones first, the ones its name suggests marked, a search and filters. */
function AddItemsDialog({
  open,
  group,
  groups,
  items,
  onClose,
  onAdd,
}: {
  open: boolean;
  group: GroupView;
  groups: GroupView[];
  items: Item[];
  onClose: () => void;
  onAdd: (ids: number[]) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("UNGROUPED");
  const [groupFilter, setGroupFilter] = useState("");
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setScope("UNGROUPED");
      setGroupFilter("");
      setChosen(new Set());
    }
  }
  const candidates = useMemo(() => items.filter((r) => r.groupId !== group.id), [items, group.id]);
  const counts = {
    UNGROUPED: candidates.filter((r) => r.groupId === null).length,
    GROUPED: candidates.filter((r) => r.groupId !== null).length,
    ALL: candidates.length,
  };
  const needle = normalize(query.trim());
  const shown = candidates.filter((r) => {
    if (needle && !normalize(r.name).includes(needle)) return false;
    if (groupFilter) return String(r.groupId) === groupFilter;
    if (scope === "UNGROUPED") return r.groupId === null;
    if (scope === "GROUPED") return r.groupId !== null;
    return true;
  });
  const suggested = shown.filter((r) => r.suggestion?.groupId === group.id);
  const moving = [...chosen].filter((id) => candidates.find((r) => r.serviceId === id)?.groupId !== null).length;
  const chip = (value: Scope) => (
    <button
      key={value}
      type="button"
      aria-pressed={!groupFilter && scope === value}
      data-testid={`groups-add-scope-${value}`}
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
    <Modal
      open={open}
      onClose={onClose}
      title={t("femme.commissions.workspace.addTitle", { name: group.name })}
      description={t("femme.commissions.workspace.addDescription")}
      className="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={onClose}>
            {t("femme.commissions.common.cancel")}
          </Button>
          <Button
            type="button"
            className={`${ACTION_BUTTON} w-full sm:w-auto`}
            disabled={chosen.size === 0}
            data-testid="groups-add-confirm"
            onClick={() => onAdd([...chosen])}
          >
            {t("femme.commissions.workspace.addConfirm", { count: chosen.size, name: group.name })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="groups-add-dialog">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <Label htmlFor="groups-add-search" className="sr-only">
              {t("femme.commissions.workspace.searchLabel")}
            </Label>
            <Input
              id="groups-add-search"
              type="search"
              value={query}
              placeholder={t("femme.commissions.workspace.addSearch")}
              data-testid="groups-add-search"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select
            aria-label={t("femme.commissions.groups.groupFilter")}
            value={groupFilter}
            className="w-48"
            data-testid="groups-add-group-filter"
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="">{t("femme.commissions.groups.groupFilterAll")}</option>
            {groups
              .filter((g) => g.id !== group.id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("femme.commissions.groups.scopeAria")}>
          {(["UNGROUPED", "GROUPED", "ALL"] as const).map(chip)}
        </div>
        {suggested.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-lt px-3.5 py-2">
            <span className="text-sm text-warning">{t("femme.commissions.workspace.suggestedCount", { count: suggested.length, name: group.name })}</span>
            <Button
              type="button"
              variant="secondary"
              className={ACTION_BUTTON}
              data-testid="groups-add-mark-suggested"
              onClick={() => setChosen((prev) => new Set([...prev, ...suggested.map((r) => r.serviceId)]))}
            >
              {t("femme.commissions.workspace.markSuggested")}
            </Button>
          </div>
        )}
        <ul className="max-h-[22rem] overflow-y-auto rounded-xl border border-line" data-testid="groups-add-rows">
          {shown.length === 0 ? (
            <li className="p-4 text-sm text-ink-3">{t("femme.commissions.groups.noMatches")}</li>
          ) : (
            shown.slice(0, 100).map((r) => (
              <li key={`${r.kind}-${r.serviceId}`} data-testid="groups-add-row" data-name={r.name} className="flex min-h-14 items-center gap-3 border-t border-line px-3.5 py-1.5 first:border-t-0">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
                  checked={chosen.has(r.serviceId)}
                  aria-label={t("femme.commissions.groups.selectRow", { name: r.name })}
                  data-testid="groups-add-check"
                  onChange={() =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.serviceId)) next.delete(r.serviceId);
                      else next.add(r.serviceId);
                      return next;
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="break-words font-extrabold text-ink">{r.name}</div>
                  <div className="text-xs text-ink-3">
                    {[r.kind === "PRODUCT" ? t("femme.commissions.workspace.product") : null, r.categoryName, r.price !== null ? formatGuaraniesGs(r.price) : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {r.suggestion?.groupId === group.id && (
                  <span className="rounded-full bg-warning-lt px-2.5 py-1 text-xs font-extrabold text-warning">{t("femme.commissions.workspace.suggestedChip")}</span>
                )}
                <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${r.groupName ? "bg-primary-lt text-primary" : "bg-warning-lt text-warning"}`}>
                  {r.groupName ?? t("femme.commissions.groups.noGroup")}
                </span>
              </li>
            ))
          )}
        </ul>
        <p className="text-sm text-ink-2" data-testid="groups-add-summary">
          {t("femme.commissions.workspace.addChosen", { count: chosen.size })}
          {moving > 0 ? ` · ${t("femme.commissions.workspace.addMoving", { count: moving })}` : ""}
        </p>
      </div>
    </Modal>
  );
}
