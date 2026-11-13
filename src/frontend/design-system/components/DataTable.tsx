import { useCallback, type KeyboardEvent, type ReactNode } from "react";
import { useMediaQuery } from "../../src/hooks/useMediaQuery";
import { cn } from "../lib/cn";

export type DataTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T, rowIndex: number) => ReactNode;
  /** Alignment of the header and the cells; amounts go on the right. */
  align?: "left" | "right";
  /** Extra classes for the cells of this column (e.g. `max-w-[16rem]` to truncate). */
  cellClassName?: string;
  /** Let the content wrap onto several lines (default: one line, `whitespace-nowrap`). */
  wrap?: boolean;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T, index: number) => string | number;
  className?: string;
  /** `data-testid` of the `<table>`. */
  testId?: string;
  /** `data-testid` of the `<ul>` of cards on a phone (default: `testId`). */
  mobileTestId?: string;
  /** `data-testid` of every row (`<tr>` / `<li>`). */
  rowTestId?: (row: T) => string;
  /** Extra `data-*` attributes of a row (e.g. `data-kind`). */
  rowAttributes?: (row: T) => Record<string, string | undefined>;
  /** Makes the whole row clickable (mouse, Enter and Space). Needs `rowLabel`. */
  onRowClick?: (row: T) => void;
  /** Accessible name of a clickable row. */
  rowLabel?: (row: T) => string;
  /** `"muted"` dims the row (voided, withdrawn…). */
  rowTone?: (row: T) => "muted" | undefined;
  /** Last column: the row's «Más acciones» menu (a `KebabMenu`). Clicks on it never reach `onRowClick`. */
  rowActions?: (row: T) => ReactNode;
  /** Accessible header of the actions column. */
  actionsHeader?: ReactNode;
  /** On a phone (< 640 px) each row is this card instead of a table row. Without it the table scrolls sideways. */
  mobileCard?: (row: T) => ReactNode;
  /** Shown (under the header) when there are no rows. */
  emptyLabel?: ReactNode;
  /** `data-testid` of the empty-state cell. */
  emptyTestId?: string;
  /** Tailwind min-width of the table, so narrow screens scroll inside their own box. */
  minWidthClassName?: string;
};

/**
 * The one table of the product (Propinas look): small uppercase header over a hairline, 44 px rows with thin
 * separators, amounts on the right and the «⋮» menu in the last column. Cards on a phone.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  className,
  testId,
  mobileTestId,
  rowTestId,
  rowAttributes,
  onRowClick,
  rowLabel,
  rowTone,
  rowActions,
  actionsHeader,
  mobileCard,
  emptyLabel,
  emptyTestId,
  minWidthClassName = "min-w-[26rem]",
}: DataTableProps<T>) {
  const isPhone = useMediaQuery("(max-width: 639px)");

  const clickProps = useCallback(
    (row: T) =>
      onRowClick
        ? {
            tabIndex: 0,
            "aria-label": rowLabel?.(row),
            onClick: () => onRowClick(row),
            onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(row);
              }
            },
          }
        : {},
    [onRowClick, rowLabel],
  );

  const stopRowClick = rowActions && onRowClick ? { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() } : {};

  if (isPhone && mobileCard) {
    if (rows.length === 0 && emptyLabel) {
      return (
        <p className="py-3 text-center text-sm text-ink-3" data-testid={emptyTestId}>
          {emptyLabel}
        </p>
      );
    }
    return (
      <ul className={cn("flex flex-col", className)} data-testid={mobileTestId ?? testId}>
        {rows.map((row, i) => (
          <li
            key={getRowId(row, i)}
            data-testid={rowTestId?.(row)}
            {...rowAttributes?.(row)}
            {...clickProps(row)}
            className={cn(
              "flex items-center gap-2 border-t border-line py-3 first:border-t-0",
              onRowClick && "cursor-pointer",
              rowTone?.(row) === "muted" ? "text-ink-3" : "text-ink",
            )}
          >
            <div className="min-w-0 flex-1">{mobileCard(row)}</div>
            {rowActions ? (
              <div className="w-11 shrink-0 text-right" {...stopRowClick}>
                {rowActions(row)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className={cn("w-full border-collapse text-sm", minWidthClassName)} data-testid={testId}>
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-extrabold uppercase tracking-wider text-ink-3">
            {columns.map((col) => (
              <th key={col.id} className={cn("px-2 py-2", col.align === "right" && "text-right")}>
                {col.header}
              </th>
            ))}
            {rowActions ? (
              <th className="w-11 px-1 py-2">
                {actionsHeader ? <span className="sr-only">{actionsHeader}</span> : null}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyLabel ? (
            <tr>
              <td
                colSpan={columns.length + (rowActions ? 1 : 0)}
                className="px-2 py-6 text-center text-xs text-ink-3"
                data-testid={emptyTestId}
              >
                {emptyLabel}
              </td>
            </tr>
          ) : null}
          {rows.map((row, i) => (
            <tr
              key={getRowId(row, i)}
              data-testid={rowTestId?.(row)}
              {...rowAttributes?.(row)}
              {...clickProps(row)}
              className={cn(
                "h-11 border-t border-line first:border-t-0",
                onRowClick && "cursor-pointer hover:bg-primary-lt",
                rowTone?.(row) === "muted" ? "text-ink-3" : "text-ink",
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.id}
                  className={cn(
                    "px-2 py-1.5",
                    !col.wrap && "whitespace-nowrap",
                    col.align === "right" && "text-right",
                    col.cellClassName,
                  )}
                >
                  {col.cell(row, i)}
                </td>
              ))}
              {rowActions ? (
                <td className="px-1 text-right" {...stopRowClick}>
                  {rowActions(row)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
