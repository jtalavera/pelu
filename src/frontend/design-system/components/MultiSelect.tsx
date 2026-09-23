import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { FloatingDropdown } from "./FloatingDropdown";
import { Input } from "./Input";
import { Label } from "./Label";

export type MultiSelectOption<T extends string | number> = {
  value: T;
  label: string;
};

export type MultiSelectProps<T extends string | number> = {
  id: string;
  className?: string;
  labelSrOnly?: boolean;
  label: string;
  value: T[];
  onChange: (values: T[]) => void;
  options: MultiSelectOption<T>[];
  placeholder: string;
  filterPlaceholder: string;
  noResultsText: string;
  /** Selection summary shown when closed, e.g. "{count} selected" — `{count}` is replaced. */
  summaryTemplate: string;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Checkbox multi-pick dropdown, modeled on SearchableSelect's search/floating-panel pattern. */
export function MultiSelect<T extends string | number>({
  id,
  className,
  labelSrOnly,
  label,
  value,
  onChange,
  options,
  placeholder,
  filterPlaceholder,
  noResultsText,
  summaryTemplate,
  invalid,
  disabled,
  describedBy,
}: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  const summary = useMemo(
    () => (value.length > 0 ? summaryTemplate.replace("{count}", String(value.length)) : ""),
    [value, summaryTemplate],
  );

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return options;
    return options.filter((o) => normalize(o.label).includes(q));
  }, [options, query]);

  const showDropdown = open && !disabled;

  function toggle(optValue: T) {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Label htmlFor={id} className={labelSrOnly ? "sr-only" : undefined}>
        {label}
      </Label>
      <Input
        id={id}
        role="combobox"
        value={open ? query : summary}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (disabled) return;
          setQuery("");
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        placeholder={open ? filterPlaceholder : placeholder}
        autoComplete="off"
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listId : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          invalid &&
            "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20 dark:border-red-500 dark:focus-visible:ring-red-500/30",
        )}
      />
      <FloatingDropdown anchorRef={containerRef} open={showDropdown} ref={panelRef}>
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="w-full min-w-[12rem] rounded-md border border-slate-200 bg-white shadow-lg max-h-72 overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400" role="alert">
              {noResultsText}
            </li>
          ) : (
            filtered.map((opt) => {
              const selected = value.includes(opt.value);
              return (
                <li key={String(opt.value)} role="option" aria-selected={selected}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start gap-2 rounded-none px-3 py-2 text-sm"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      toggle(opt.value);
                    }}
                  >
                    <Checkbox checked={selected} readOnly tabIndex={-1} />
                    {opt.label}
                  </Button>
                </li>
              );
            })
          )}
        </ul>
      </FloatingDropdown>
    </div>
  );
}
