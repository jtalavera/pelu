import { useEffect, useId, useState } from "react";
import { Input } from "@design-system";

/**
 * Issue #174 AC-06: a date field that always displays and is typed as `DD/MM/AAAA`, regardless of
 * the browser locale (unlike a native `<input type="date">`). The value it stores and emits is the
 * ISO `YYYY-MM-DD` string the rest of the app already uses for date filters; an incomplete or
 * invalid entry emits `""`.
 *
 * Reused by the "Historial de comprobantes" filter and the editable emission date on the
 * comprobante form.
 */
export function DateField({
  id,
  value,
  onChange,
  ariaLabel,
  ariaInvalid,
  ariaDescribedby,
  disabled,
  className,
}: {
  id?: string;
  /** ISO `YYYY-MM-DD` or `""`. */
  value: string;
  onChange: (isoDate: string) => void;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedby?: string;
  disabled?: boolean;
  className?: string;
}) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const [text, setText] = useState(() => isoToDisplay(value));

  // Keep the visible text in sync when the value is changed from outside (e.g. "Limpiar filtros"),
  // but never fight the user while they're mid-edit and the display already matches.
  useEffect(() => {
    setText((prev) => (displayToIso(prev) === value ? prev : isoToDisplay(value)));
  }, [value]);

  function handleChange(raw: string) {
    const masked = maskDate(raw);
    setText(masked);
    onChange(displayToIso(masked));
  }

  return (
    <Input
      id={inputId}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="DD/MM/AAAA"
      value={text}
      disabled={disabled}
      onChange={(e) => handleChange(e.target.value)}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid ? true : undefined}
      aria-describedby={ariaDescribedby}
      className={className}
      maxLength={10}
    />
  );
}

/** Digits only, formatted progressively as `DD/MM/YYYY` (max 8 digits). */
export function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(
    (p) => p.length > 0,
  );
  return parts.join("/");
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`; anything else → `""`. */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `DD/MM/YYYY` → `YYYY-MM-DD` when it's a real calendar date, otherwise `""`. */
export function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display.trim());
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return "";
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}
