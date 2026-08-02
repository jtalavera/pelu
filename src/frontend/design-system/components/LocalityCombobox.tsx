import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { FloatingDropdown } from "./FloatingDropdown";

export type Locality = {
  departmentCode: string;
  departmentName: string;
  cityCode: string;
  cityName: string;
};

export type LocalityComboboxProps = {
  id: string;
  /** Currently selected locality, or `null` if none. */
  value: Locality | null;
  onChange: (next: Locality | null) => void;
  /** Called on every keystroke with the raw query — the caller owns the actual search request. */
  onSearch: (query: string) => void;
  /** Search results to render, already filtered/limited by the caller. */
  options: Locality[];
  loading?: boolean;
  placeholder?: string;
  noResultsLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

function formatLocality(l: Locality): string {
  return `${l.cityName} (${l.departmentName})`;
}

/**
 * Search-as-you-type combobox for picking a department+city pair from the DNIT geographic
 * catalog (SIFEN HU-02 AC-07) — same interaction shape as {@link TimeCombobox} (editable text
 * input + floating listbox), but backed by a server-side search the caller drives via {@link
 * LocalityComboboxProps.onSearch} instead of a client-side static option list (the full catalog
 * is ~6,800 entries, too many to filter in the browser on every keystroke).
 */
export function LocalityCombobox({
  id,
  value,
  onChange,
  onSearch,
  options,
  loading,
  placeholder,
  noResultsLabel,
  disabled,
  invalid,
  className,
  ...rest
}: LocalityComboboxProps) {
  const listId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ? formatLocality(value) : "");

  useEffect(() => {
    if (!open) {
      setQuery(value ? formatLocality(value) : "");
    }
  }, [value, open]);

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function select(locality: Locality) {
    onChange(locality);
    setQuery(formatLocality(locality));
    setOpen(false);
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery(value ? formatLocality(value) : "");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (options.length === 1) {
        select(options[0]);
      }
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid || rest["aria-invalid"] || undefined}
        aria-describedby={rest["aria-describedby"]}
        aria-label={rest["aria-label"]}
        data-testid={rest["data-testid"]}
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          if (value && next !== formatLocality(value)) {
            onChange(null);
          }
          onSearch(next);
        }}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          onSearch(query);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400",
          "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20",
          "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-indigo-400 dark:focus-visible:ring-indigo-400/25",
          "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:disabled:bg-slate-800",
          invalid &&
            "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20 dark:border-red-500 dark:focus-visible:ring-red-500/30",
        )}
      />
      <FloatingDropdown anchorRef={containerRef} open={open && !disabled} ref={panelRef}>
        <ul
          id={listId}
          role="listbox"
          className="max-h-60 w-full min-w-[12rem] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {loading ? (
            <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
              {noResultsLabel ?? ""}
            </li>
          ) : (
            options.map((opt) => {
              const key = `${opt.departmentCode}-${opt.cityCode}`;
              const selected = value?.departmentCode === opt.departmentCode && value?.cityCode === opt.cityCode;
              return (
                <li
                  key={key}
                  role="option"
                  aria-selected={selected}
                  data-testid={`${id}-option-${key}`}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-sm",
                    "hover:bg-slate-100 dark:hover:bg-slate-800",
                    selected && "bg-slate-100 font-medium dark:bg-slate-800",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(opt);
                  }}
                >
                  {formatLocality(opt)}
                </li>
              );
            })
          )}
        </ul>
      </FloatingDropdown>
    </div>
  );
}
