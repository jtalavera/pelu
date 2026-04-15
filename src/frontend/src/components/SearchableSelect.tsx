import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Label, cn } from "@design-system";

export type SearchableSelectOption<T extends string | number> = {
  value: T;
  label: string;
};

type Props<T extends string | number> = {
  id: string;
  className?: string;
  labelSrOnly?: boolean;
  label: string;
  value: T | "";
  onChange: (value: T | "") => void;
  options: SearchableSelectOption<T>[];
  /** Prepends an extra option (e.g. “All” with value ""). */
  emptyOption?: { value: ""; label: string };
  filterPlaceholder: string;
  noResultsText: string;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function SearchableSelect<T extends string | number>({
  id,
  className,
  labelSrOnly,
  label,
  value,
  onChange,
  options,
  emptyOption,
  filterPlaceholder,
  noResultsText,
  invalid,
  disabled,
  describedBy,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  const allRows: SearchableSelectOption<T | "">[] = useMemo(() => {
    const head = emptyOption ? [{ value: emptyOption.value as T | "", label: emptyOption.label }] : [];
    return [...head, ...options];
  }, [options, emptyOption]);

  const selectedLabel = useMemo(() => {
    if (value === "") {
      return emptyOption?.label ?? "";
    }
    const found = options.find((o) => o.value === value);
    return found?.label ?? "";
  }, [value, options, emptyOption]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  useEffect(() => {
    if (!open && !disabled) {
      setQuery(selectedLabel);
    }
  }, [selectedLabel, open, disabled]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return allRows;
    return allRows.filter((row) => normalize(row.label).includes(q));
  }, [allRows, query]);

  const showDropdown = open && !disabled;
  const singleFiltered = showDropdown && filtered.length === 1;

  const pickRow = useCallback(
    (row: SearchableSelectOption<T | "">) => {
      if (row.value === "") {
        onChange("" as T | "");
      } else {
        onChange(row.value as T);
      }
      setOpen(false);
      setQuery(
        row.value === ""
          ? emptyOption?.label ?? ""
          : options.find((o) => o.value === row.value)?.label ?? "",
      );
    },
    [onChange, emptyOption, options],
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Label htmlFor={id} className={labelSrOnly ? "sr-only" : undefined}>
        {label}
      </Label>
      <Input
        id={id}
        role="combobox"
        value={open ? query : selectedLabel}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          setOpen(true);
        }}
        onFocus={() => {
          if (disabled) return;
          setQuery("");
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setQuery(selectedLabel);
            return;
          }
          if (e.key === "Enter") {
            if (showDropdown && filtered.length === 1) {
              e.preventDefault();
              pickRow(filtered[0]);
            }
          }
        }}
        placeholder={filterPlaceholder}
        autoComplete="off"
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listId : undefined}
        aria-activedescendant={singleFiltered ? `${id}-option-0` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          invalid &&
            "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20 dark:border-red-500 dark:focus-visible:ring-red-500/30",
        )}
      />
      {showDropdown ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-50 mt-1 w-full min-w-[12rem] rounded-md border border-slate-200 bg-white shadow-lg max-h-72 overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400" role="alert">
              {noResultsText}
            </li>
          ) : (
            filtered.map((row, index) => {
              const selected =
                row.value === "" ? value === "" : value === (row.value as unknown as T | "");
              const isOnlyMatch = singleFiltered && index === 0;
              return (
                <li
                  key={String(row.value)}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={selected}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      "w-full justify-start rounded-none px-3 py-2 text-sm",
                      isOnlyMatch &&
                        "bg-slate-100 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:ring-slate-600",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickRow(row);
                    }}
                  >
                    {row.label}
                  </Button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
