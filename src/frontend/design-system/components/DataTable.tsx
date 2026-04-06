import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";

function GripIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="3" cy="2.5" r="1" />
      <circle cx="9" cy="2.5" r="1" />
      <circle cx="3" cy="6" r="1" />
      <circle cx="9" cy="6" r="1" />
      <circle cx="3" cy="9.5" r="1" />
      <circle cx="9" cy="9.5" r="1" />
    </svg>
  );
}

function ColumnsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SortChevron({
  direction,
  className,
}: {
  direction: "asc" | "desc" | null;
  className?: string;
}) {
  if (!direction) {
    return (
      <span
        className={cn(
          "inline-flex flex-col text-slate-300 dark:text-slate-600",
          className,
        )}
        aria-hidden
      >
        <svg width="10" height="6" viewBox="0 0 10 6" className="-mb-1">
          <path d="M5 0L10 6H0z" fill="currentColor" />
        </svg>
        <svg width="10" height="6" viewBox="0 0 10 6" className="rotate-180">
          <path d="M5 0L10 6H0z" fill="currentColor" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={cn("text-indigo-600 dark:text-indigo-400", className)}
      aria-hidden
    >
      {direction === "asc" ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 2l4 6H2z" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 10L2 4h8z" />
        </svg>
      )}
    </span>
  );
}

function mergeOrderWithVisibleReorder(
  fullOrder: string[],
  isReorderableColumn: (id: string) => boolean,
  newReorderableOrder: string[],
): string[] {
  const queue = [...newReorderableOrder];
  return fullOrder.map((id) => {
    if (!isReorderableColumn(id)) return id;
    return queue.shift()!;
  });
}

export type DataTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T, rowIndex: number) => ReactNode;
  sortable?: boolean;
  /** Required when sortable is true */
  sortFn?: (a: T, b: T) => number;
  /** Column always shown; excluded from visibility toggles */
  alwaysVisible?: boolean;
  /** Start hidden until user enables in column settings */
  defaultHidden?: boolean;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId?: (row: T, index: number) => string | number;
  className?: string;
  /** Show the column configuration (visibility) control */
  showColumnSettings?: boolean;
};

type SortState = { columnId: string | null; direction: "asc" | "desc" | null };

function SortableHeader<T>({
  column,
  sort,
  onSort,
  dragLabel,
}: {
  column: DataTableColumn<T>;
  sort: SortState;
  onSort: (columnId: string) => void;
  dragLabel: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const active =
    sort.columnId === column.id ? sort.direction : null;
  const sortable = column.sortable && column.sortFn;

  return (
    <th
      ref={setNodeRef}
      style={style}
      scope="col"
      aria-sort={
        !sortable
          ? undefined
          : active === "asc"
            ? "ascending"
            : active === "desc"
              ? "descending"
              : "none"
      }
      className={cn(
        "border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600",
        "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
        isDragging &&
          "z-10 bg-white shadow-md ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-600",
      )}
    >
      <div className="flex min-w-[8rem] items-center gap-1.5">
        <button
          type="button"
          className="inline-flex shrink-0 cursor-grab touch-none rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-slate-700 dark:hover:text-slate-300"
          aria-label={dragLabel}
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
        {sortable ? (
          <button
            type="button"
            onClick={() => onSort(column.id)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-1 text-left font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-50"
          >
            <span className="truncate">{column.header}</span>
            <SortChevron direction={active} />
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-700 dark:text-slate-200">
            {column.header}
          </span>
        )}
      </div>
    </th>
  );
}

export function DataTable<T>({
  columns,
  data,
  getRowId = (_, i) => i,
  className,
  showColumnSettings = true,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const columnMap = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.id, c])) as Record<
      string,
      DataTableColumn<T>
    >,
    [columns],
  );

  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    columns.map((c) => c.id),
  );
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      columns.map((c) => [c.id, c.defaultHidden !== true]),
    ),
  );
  const [sort, setSort] = useState<SortState>({
    columnId: null,
    direction: null,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const columnIdsKey = useMemo(
    () => columns.map((c) => c.id).join("\0"),
    [columns],
  );

  useEffect(() => {
    setColumnOrder(columns.map((c) => c.id));
    setVisibility(
      Object.fromEntries(
        columns.map((c) => [c.id, c.defaultHidden !== true]),
      ),
    );
  }, [columnIdsKey, columns]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [settingsOpen]);

  const visibleOrderedColumns = useMemo(() => {
    return columnOrder
      .map((id) => columnMap[id])
      .filter(
        (c): c is DataTableColumn<T> =>
          Boolean(c) && (c.alwaysVisible || visibility[c.id] !== false),
      );
  }, [columnOrder, columnMap, visibility]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const handleSort = useCallback(
    (columnId: string) => {
      const col = columnMap[columnId];
      if (!col?.sortable || !col.sortFn) return;
      setSort((prev) => {
        if (prev.columnId !== columnId) {
          return { columnId, direction: "asc" };
        }
        if (prev.direction === "asc") {
          return { columnId, direction: "desc" };
        }
        return { columnId: null, direction: null };
      });
    },
    [columnMap],
  );

  const sortedData = useMemo(() => {
    if (!sort.columnId || !sort.direction) return data;
    const col = columnMap[sort.columnId];
    if (!col?.sortFn) return data;
    const next = [...data];
    next.sort((a, b) => {
      const r = col.sortFn!(a, b);
      return sort.direction === "asc" ? r : -r;
    });
    return next;
  }, [data, sort, columnMap]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const isReorderable = (id: string) => {
      const c = columnMap[id];
      return Boolean(c && (c.alwaysVisible || visibility[id] !== false));
    };
    const reorderableIds = columnOrder.filter(isReorderable);
    const oldIndex = reorderableIds.indexOf(String(active.id));
    const newIndex = reorderableIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrder = arrayMove(reorderableIds, oldIndex, newIndex);
    setColumnOrder(
      mergeOrderWithVisibleReorder(columnOrder, isReorderable, newOrder),
    );
  };

  const toggleableColumns = columns.filter((c) => !c.alwaysVisible);
  const sortableIds = visibleOrderedColumns.map((c) => c.id);

  return (
    <div className={cn("w-full space-y-2", className)}>
      {showColumnSettings && toggleableColumns.length > 0 ? (
        <div className="flex justify-end">
          <div className="relative" ref={settingsRef}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-slate-600 dark:text-slate-300"
              aria-expanded={settingsOpen}
              aria-haspopup="true"
              aria-controls={settingsOpen ? menuId : undefined}
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <ColumnsIcon className="size-4 shrink-0" />
              <span className="sr-only sm:not-sr-only">
                {t("designSystem.dataTable.columns")}
              </span>
            </Button>
            {settingsOpen ? (
              <div
                id={menuId}
                role="menu"
                className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-600 dark:bg-slate-900"
              >
                <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t("designSystem.dataTable.visibleColumns")}
                </p>
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {toggleableColumns.map((col) => (
                    <li key={col.id}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                        <Checkbox
                          checked={visibility[col.id] !== false}
                          onChange={(e) =>
                            setVisibility((v) => ({
                              ...v,
                              [col.id]: e.target.checked,
                            }))
                          }
                        />
                        <span className="truncate">{col.header}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900 dark:shadow-none dark:ring-1 dark:ring-slate-700/80">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr>
                <SortableContext
                  items={sortableIds}
                  strategy={horizontalListSortingStrategy}
                >
                  {visibleOrderedColumns.map((col) => (
                    <SortableHeader
                      key={col.id}
                      column={col}
                      sort={sort}
                      onSort={handleSort}
                      dragLabel={t("designSystem.dataTable.dragReorderColumn")}
                    />
                  ))}
                </SortableContext>
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row, rowIndex) => (
                <tr
                  key={String(getRowId(row, rowIndex))}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/60"
                >
                  {visibleOrderedColumns.map((col) => (
                    <td
                      key={col.id}
                      className="px-3 py-2.5 align-middle text-slate-800 dark:text-slate-200"
                    >
                      {col.cell(row, rowIndex)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DndContext>
      </div>
    </div>
  );
}
