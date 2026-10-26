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
          "flex min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-3",
          "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
          "",
          "disabled:cursor-not-allowed disabled:bg-page disabled:opacity-60",
          invalid &&
            "border-danger focus-visible:border-danger focus-visible:ring-danger/20",
        )}
      />
      <FloatingDropdown anchorRef={containerRef} open={open && !disabled} ref={panelRef}>
        <ul
          id={listId}
          role="listbox"
          className="max-h-60 w-full min-w-[12rem] overflow-y-auto rounded-xl border border-line bg-surface shadow-lg"
        >
          {loading ? (
            <li className="px-3 py-2 text-sm text-ink-3">…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-3">
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
                    "hover:bg-page",
                    selected && "bg-page font-medium",
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
