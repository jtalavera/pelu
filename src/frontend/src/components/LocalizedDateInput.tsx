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
import { useTranslation } from "react-i18next";
import { FloatingDropdown, cn } from "@design-system";
import { getDateLocale } from "../i18n/dateLocale";

export type LocalizedDateInputProps = {
  id: string;
  /** ISO `YYYY-MM-DD`. Empty string clears the date. */
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
};

type Mode = "es" | "en";

/**
 * A locale-aware date entry control.
 *
 * Display: shows the formatted date using the active UI language
 *   - Spanish (es) → `DD/MM/YYYY` with es-PY weekday/month names in the popover.
 *   - English (en) → `MM/DD/YYYY` with en-US weekday/month names in the popover.
 *
 * Storage: emits ISO `YYYY-MM-DD` so the rest of the app keeps working with
 * unambiguous values.
 *
 * The user can either type the formatted date directly or pick a day in the
 * popup mini-calendar. Typed input is parsed permissively (accepts `dd/mm/yy`
 * or `mm/dd/yy` short forms based on locale).
 */
export const LocalizedDateInput = forwardRef<HTMLInputElement, LocalizedDateInputProps>(
  (
    { id, value, onChange, invalid, disabled, className, ...rest },
    forwardedRef,
  ) => {
    const { t, i18n } = useTranslation();
    const locale = getDateLocale(i18n);
    const mode: Mode = locale.startsWith("es") ? "es" : "en";

    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    const [open, setOpen] = useState(false);
    const [text, setText] = useState(() => formatIsoForDisplay(value, mode));

    useEffect(() => {
      setText(formatIsoForDisplay(value, mode));
    }, [value, mode]);

    const containerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      function onDocMouseDown(e: MouseEvent) {
        const target = e.target as Node;
        if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
        setOpen(false);
        setText(formatIsoForDisplay(value, mode));
      }
      document.addEventListener("mousedown", onDocMouseDown);
      return () => document.removeEventListener("mousedown", onDocMouseDown);
    }, [value, mode]);

    const visibleMonth = useMemo<{ year: number; month: number }>(() => {
      const base = parseDisplayToIso(text, mode) ?? value;
      if (base) {
        const d = parseIsoSafe(base);
        if (d) return { year: d.getFullYear(), month: d.getMonth() };
      }
      const today = new Date();
      return { year: today.getFullYear(), month: today.getMonth() };
    }, [text, value, mode]);

    const [navYear, setNavYear] = useState(visibleMonth.year);
    const [navMonth, setNavMonth] = useState(visibleMonth.month);

    useEffect(() => {
      if (open) {
        setNavYear(visibleMonth.year);
        setNavMonth(visibleMonth.month);
      }
    }, [open, visibleMonth.year, visibleMonth.month]);

    const monthLabel = useMemo(
      () =>
        new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
          new Date(navYear, navMonth, 1),
        ),
      [locale, navYear, navMonth],
    );

    const weekdays = useMemo(() => buildWeekdayLabels(locale), [locale]);

    const accept = useCallback(
      (raw: string) => {
        const iso = parseDisplayToIso(raw, mode);
        if (raw.trim() === "") {
          onChange("");
          setText("");
          return;
        }
        if (iso) {
          onChange(iso);
          setText(formatIsoForDisplay(iso, mode));
        }
      },
      [mode, onChange],
    );

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setText(formatIsoForDisplay(value, mode));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        accept(text);
        setOpen(false);
      }
    };

    const placeholder = mode === "es" ? "DD/MM/AAAA" : "MM/DD/YYYY";

    function pickDay(day: number) {
      const iso = `${navYear}-${pad(navMonth + 1)}-${pad(day)}`;
      onChange(iso);
      setText(formatIsoForDisplay(iso, mode));
      setOpen(false);
      // Avoid refocusing the input here: focusing re-triggers `onFocus`, which
      // reopens the popup and can leave the calendar overlay intercepting clicks
      // on fields below (e.g. comboboxes in an appointment dialog).
    }

    function navigateMonth(delta: number) {
      const next = new Date(navYear, navMonth + delta, 1);
      setNavYear(next.getFullYear());
      setNavMonth(next.getMonth());
    }

    return (
      <div ref={containerRef} className={cn("relative", className)}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={invalid || rest["aria-invalid"] || undefined}
          aria-describedby={rest["aria-describedby"]}
          aria-label={rest["aria-label"]}
          data-testid={rest["data-testid"]}
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const iso = parseDisplayToIso(e.target.value, mode);
            if (iso) {
              onChange(iso);
            } else if (e.target.value.trim() === "") {
              onChange("");
            }
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onBlur={() => {
            accept(text);
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
        <FloatingDropdown anchorRef={containerRef} open={open && !disabled} ref={panelRef} width={288}>
          <div
            role="dialog"
            aria-label={t("femme.localizedDateInput.dialogLabel")}
            className="rounded-md border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label={t("femme.localizedDateInput.prevMonth")}
                onClick={() => navigateMonth(-1)}
                className="rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ‹
              </button>
              <span className="text-sm font-medium capitalize">{monthLabel}</span>
              <button
                type="button"
                aria-label={t("femme.localizedDateInput.nextMonth")}
                onClick={() => navigateMonth(1)}
                className="rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-slate-500 dark:text-slate-400">
              {weekdays.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
              {buildMonthGrid(navYear, navMonth).map((cell, idx) => {
                if (cell === null) {
                  return <div key={`pad-${idx}`} aria-hidden />;
                }
                const iso = `${navYear}-${pad(navMonth + 1)}-${pad(cell)}`;
                const selected = iso === value;
                return (
                  <button
                    key={iso}
                    type="button"
                    aria-pressed={selected}
                    aria-label={iso}
                    onClick={() => pickDay(cell)}
                    className={cn(
                      "rounded px-2 py-1 text-sm",
                      "hover:bg-indigo-50 dark:hover:bg-indigo-950",
                      selected
                        ? "bg-indigo-600 text-white hover:bg-indigo-600"
                        : "text-slate-900 dark:text-slate-100",
                    )}
                  >
                    {cell}
                  </button>
                );
              })}
            </div>
          </div>
        </FloatingDropdown>
      </div>
    );
  },
);

LocalizedDateInput.displayName = "LocalizedDateInput";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseIsoSafe(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo - 1, d);
}

/**
 * Renders an ISO date in the user's preferred display format.
 * - Spanish:  DD/MM/YYYY
 * - English:  MM/DD/YYYY
 */
export function formatIsoForDisplay(iso: string, mode: Mode): string {
  const d = parseIsoSafe(iso);
  if (!d) return "";
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  return mode === "es" ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`;
}

/**
 * Parses a user-typed date back into ISO `YYYY-MM-DD`. Accepts:
 * - Long form `DD/MM/YYYY` or `MM/DD/YYYY` based on `mode`.
 * - Hyphens or dots as separators.
 * - Two-digit years (assumed 2000+).
 */
export function parseDisplayToIso(raw: string, mode: Mode): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  // Canonical ISO `YYYY-MM-DD` is always accepted, regardless of locale, so
  // automated tests, browser autofill, copy/paste, and direct API values keep
  // working independent of the user's display preference.
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const yyyy = parseInt(isoMatch[1], 10);
    const mm = parseInt(isoMatch[2], 10);
    const dd = parseInt(isoMatch[3], 10);
    return validateAndFormat(yyyy, mm, dd);
  }
  const m = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(trimmed);
  if (!m) return null;
  let dd: number;
  let mm: number;
  let yyyy: number;
  if (mode === "es") {
    dd = parseInt(m[1], 10);
    mm = parseInt(m[2], 10);
    yyyy = parseInt(m[3], 10);
  } else {
    mm = parseInt(m[1], 10);
    dd = parseInt(m[2], 10);
    yyyy = parseInt(m[3], 10);
  }
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return null;
  if (yyyy < 100) yyyy += 2000;
  return validateAndFormat(yyyy, mm, dd);
}

function validateAndFormat(yyyy: number, mm: number, dd: number): string | null {
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  const candidate = new Date(yyyy, mm - 1, dd);
  if (
    candidate.getFullYear() !== yyyy ||
    candidate.getMonth() !== mm - 1 ||
    candidate.getDate() !== dd
  ) {
    return null;
  }
  return `${String(yyyy).padStart(4, "0")}-${pad(mm)}-${pad(dd)}`;
}

/** Two-letter (or three for some locales) weekday labels starting Monday. */
function buildWeekdayLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  // Monday-first calendar: 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i);
    return fmt.format(d).replace(".", "").slice(0, 3);
  });
}

/**
 * Returns 42 cells (6 weeks × 7 days) padded with `null` for off-month slots.
 * Layout is Monday-first.
 */
export function buildMonthGrid(year: number, month: number): Array<number | null> {
  const first = new Date(year, month, 1);
  const dow = first.getDay(); // 0 = Sunday
  const firstColumn = (dow + 6) % 7; // shift to Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstColumn; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  return cells;
}
