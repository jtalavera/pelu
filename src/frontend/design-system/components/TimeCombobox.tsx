import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "../lib/cn";
import { FloatingDropdown } from "./FloatingDropdown";

export type TimeComboboxProps = {
  id: string;
  /** HH:MM (24h) or empty string. */
  value: string;
  onChange: (next: string) => void;
  /** Step in minutes between dropdown options. Defaults to 15. */
  stepMinutes?: number;
  /** Inclusive upper bound of dropdown options. Defaults to "23:45". */
  endTime?: string;
  /** Inclusive lower bound of dropdown options. Defaults to "00:00". */
  startTime?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  /** Pass-through attributes. */
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  onBlur?: () => void;
};

/**
 * Editable combobox for picking a time of day.
 *
 * Behavior:
 * - Dropdown lists every option from `startTime` to `endTime` in `stepMinutes`
 *   intervals (defaults: 00:00 → 23:45 in 15-min steps).
 * - The user can also type any HH:MM (24h) — values are normalized to HH:MM.
 * - Pressing Enter accepts the current input (if it parses as HH:MM) and closes
 *   the dropdown.
 *
 * The component is purely visual + interactive: copy strings (`placeholder`,
 * `aria-label`) must be provided by the consumer through props, so callers
 * remain in full control of i18n.
 */
export const TimeCombobox = forwardRef<HTMLInputElement, TimeComboboxProps>(
  (
    {
      id,
      value,
      onChange,
      stepMinutes = 15,
      startTime = "00:00",
      endTime = "23:45",
      placeholder,
      disabled,
      invalid,
      className,
      onBlur,
      ...rest
    },
    forwardedRef,
  ) => {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    const listId = `${id}-listbox`;

    const options = useMemo(() => {
      return buildTimeOptions(startTime, endTime, stepMinutes);
    }, [startTime, endTime, stepMinutes]);

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState(value ?? "");

    useEffect(() => {
      if (!open) {
        setQuery(value ?? "");
      }
    }, [value, open]);

    const filtered = useMemo(() => {
      const q = (query || "").trim();
      if (!q) return options;
      return options.filter((opt) => opt.startsWith(q));
    }, [options, query]);

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

    const acceptText = useCallback(
      (raw: string) => {
        const normalized = normalizeTimeInput(raw);
        if (normalized) {
          onChange(normalized);
          setQuery(normalized);
        } else {
          // Allow clearing
          onChange(raw.trim() === "" ? "" : raw);
          setQuery(raw);
        }
        setOpen(false);
      },
      [onChange],
    );

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery(value ?? "");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (open && filtered.length === 1) {
          acceptText(filtered[0]);
          return;
        }
        acceptText(query);
      }
    };

    return (
      <div ref={containerRef} className={cn("relative", className)}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
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
          value={open ? query : value}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
          }}
          onBlur={() => {
            const normalized = normalizeTimeInput(query);
            if (query.trim() === "") {
              onChange("");
            } else if (normalized) {
              onChange(normalized);
              setQuery(normalized);
            }
            setOpen(false);
            onBlur?.();
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
            className="max-h-60 w-full min-w-[8rem] overflow-y-auto rounded-xl border border-line bg-surface shadow-lg"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-3">
                {placeholder ?? ""}
              </li>
            ) : (
              filtered.map((opt) => {
                const selected = opt === value;
                return (
                  <li
                    key={opt}
                    role="option"
                    aria-selected={selected}
                    data-testid={`${id}-option-${opt}`}
                    className={cn(
                      "cursor-pointer px-3 py-2 text-sm",
                      "hover:bg-page",
                      selected && "bg-page font-medium",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      acceptText(opt);
                    }}
                  >
                    {opt}
                  </li>
                );
              })
            )}
          </ul>
        </FloatingDropdown>
      </div>
    );
  },
);

TimeCombobox.displayName = "TimeCombobox";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Normalizes a free-text time entry into HH:MM (24h) when possible. Accepts
 * "8", "08", "8:5", "08:05", "8.30", "0830", "830". Returns null if not a valid
 * time.
 */
export function normalizeTimeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[\s.]/g, ":");
  let hh: number;
  let mm: number;
  if (/^\d{1,2}:\d{1,2}$/.test(compact)) {
    const parts = compact.split(":");
    hh = parseInt(parts[0], 10);
    mm = parseInt(parts[1], 10);
  } else if (/^\d{3,4}$/.test(trimmed)) {
    if (trimmed.length === 3) {
      hh = parseInt(trimmed.slice(0, 1), 10);
      mm = parseInt(trimmed.slice(1), 10);
    } else {
      hh = parseInt(trimmed.slice(0, 2), 10);
      mm = parseInt(trimmed.slice(2), 10);
    }
  } else if (/^\d{1,2}$/.test(trimmed)) {
    hh = parseInt(trimmed, 10);
    mm = 0;
  } else {
    return null;
  }
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}`;
}

/**
 * Returns every "HH:MM" slot from `startTime` to `endTime` (inclusive) using
 * `stepMinutes` increments. Inputs must be HH:MM.
 */
export function buildTimeOptions(
  startTime: string,
  endTime: string,
  stepMinutes: number,
): string[] {
  if (stepMinutes <= 0) return [];
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return [];
  const out: string[] = [];
  for (let m = start; m <= end; m += stepMinutes) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

function parseTimeToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}
