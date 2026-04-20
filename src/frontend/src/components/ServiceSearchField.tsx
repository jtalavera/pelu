import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";

export type SalonServiceOption = {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryAccentKey: string;
  name: string;
  priceMinor: string | number;
  durationMinutes: number;
  active: boolean;
};

type Props = {
  value: SalonServiceOption | null;
  onChange: (service: SalonServiceOption | null) => void;
  id?: string;
  label?: string;
  placeholder?: string;
  /** When set with `invalid`, links the input to a `FieldValidationError` id for accessibility. */
  errorDescribedById?: string;
  invalid?: boolean;
};

const DEBOUNCE_MS = 300;

function formatPriceGs(priceMinor: string | number): string {
  const n = Number(priceMinor);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("es-PY");
}

export function ServiceSearchField({
  value,
  onChange,
  id,
  label,
  placeholder,
  errorDescribedById,
  invalid,
}: Props) {
  const { t } = useTranslation();
  const inputId = id ?? "service-search-field";
  const labelText = label ?? t("femme.billing.invoice.lineServiceLabel");
  const placeholderText = placeholder ?? t("femme.billing.invoice.lineServicePlaceholder");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SalonServiceOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setQuery(value.name);
    }
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (value !== null) {
      onChange(null);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(v.trim());
    }, DEBOUNCE_MS);
  }

  async function doSearch(q: string) {
    setSearching(true);
    try {
      const url =
        q.length > 0
          ? `/api/services?q=${encodeURIComponent(q)}`
          : "/api/services";
      const data = await femmeJson<SalonServiceOption[]>(url);
      const list = Array.isArray(data) ? data : [];
      setResults(list.filter((s) => s.active));
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function selectService(service: SalonServiceOption) {
    onChange(service);
    setQuery(service.name);
    setOpen(false);
    setResults([]);
  }

  const showDropdown = open;
  const describedByIds = [
    invalid && errorDescribedById ? errorDescribedById : null,
    showDropdown ? `${inputId}-listbox` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={containerRef} className="relative w-full">
      <Label htmlFor={inputId}>{labelText}</Label>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          value={query}
          onChange={handleQueryChange}
          onFocus={() => {
            void doSearch(query.trim());
          }}
          placeholder={placeholderText}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? `${inputId}-listbox` : undefined}
          aria-describedby={describedByIds || undefined}
          aria-invalid={invalid || undefined}
          aria-label={labelText}
        />
        {searching ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner size="sm" />
          </span>
        ) : null}
      </div>

      {showDropdown ? (
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          aria-label={labelText}
          className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-72 overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
        >
          {results.length === 0 && !searching ? (
            <li className="px-3 py-2">
              <Text variant="muted" className="text-sm">
                {t("femme.billing.invoice.lineServiceNoResults")}
              </Text>
            </li>
          ) : null}
          {results.map((service) => (
            <li key={service.id} role="option" aria-selected={false}>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start rounded-none px-3 py-2 text-sm"
                onClick={() => selectService(service)}
              >
                <span className="flex flex-col items-start">
                  <span className="font-medium">{service.name}</span>
                  <span className="text-xs text-[rgb(var(--color-muted-foreground))]">
                    {[
                      service.categoryName,
                      t("femme.billing.invoice.lineServicePriceGs", {
                        amount: formatPriceGs(service.priceMinor),
                      }),
                      t("femme.billing.invoice.lineServiceDuration", {
                        minutes: service.durationMinutes,
                      }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
