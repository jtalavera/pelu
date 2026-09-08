import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, FloatingDropdown, Input, Label, Spinner, Text } from "@design-system";
import { listTenantsPaged, type PlatformTenant } from "../api/platformTenants";

export type TenantSelection = { tenant: PlatformTenant } | null;

type Props = {
  value: TenantSelection;
  onChange: (selection: TenantSelection) => void;
  id?: string;
  /** Defaults to femme.featureFlags.tenantSearch.label */
  label?: string;
  /** Defaults to femme.featureFlags.tenantSearch.placeholder */
  placeholder?: string;
};

const DEBOUNCE_MS = 300;
const RESULT_SIZE = 8;

/**
 * Live-filtering tenant picker, pattern-matched on ClientSearchField (same debounce/combobox/
 * FloatingDropdown shape) but standalone — tenants and clients are different enough entities
 * (paged server response, tier/status metadata) that sharing the component wasn't worth the
 * coupling. Reuses the existing PlatformTenantsPage search endpoint (already filters by
 * name/domain server-side) — no backend changes needed.
 */
export function TenantSearchField({ value, onChange, id, label, placeholder }: Props) {
  const { t } = useTranslation();
  const inputId = id ?? "tenant-search-field";
  const labelText = label ?? t("femme.featureFlags.tenantSearch.label");
  const placeholderText = placeholder ?? t("femme.featureFlags.tenantSearch.placeholder");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlatformTenant[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value?.tenant) {
      setQuery(value.tenant.name);
    }
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
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
      const page = await listTenantsPaged({ q, page: 0, size: RESULT_SIZE });
      setResults(page.content);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function selectTenant(tenant: PlatformTenant) {
    onChange({ tenant });
    setQuery(tenant.name);
    setOpen(false);
    setResults([]);
  }

  const showDropdown = open;

  return (
    <div ref={containerRef} className="relative w-full">
      <Label htmlFor={inputId}>{labelText}</Label>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (!showDropdown || searching) return;
            if (results.length === 1) {
              e.preventDefault();
              selectTenant(results[0]);
            }
          }}
          onFocus={() => {
            void doSearch(query.trim());
          }}
          placeholder={placeholderText}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? `${inputId}-listbox` : undefined}
          aria-label={labelText}
        />
        {searching ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner size="sm" />
          </span>
        ) : null}
      </div>

      <FloatingDropdown anchorRef={containerRef} open={showDropdown} ref={panelRef}>
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          aria-label={labelText}
          className="w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-72 overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
        >
          {results.length === 0 && !searching ? (
            <li className="px-3 py-2">
              <Text variant="muted" className="text-sm">
                {t("femme.featureFlags.tenantSearch.noResults")}
              </Text>
            </li>
          ) : null}
          {results.map((tenant) => {
            const metaParts = [
              tenant.tierName,
              tenant.status === "SUSPENDED" ? t("femme.status.SUSPENDED") : null,
            ].filter(Boolean) as string[];
            const lineTitle = [tenant.name, ...metaParts].join(" · ");
            return (
              <li key={tenant.id} role="option" aria-selected={false}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 text-sm"
                  onClick={() => selectTenant(tenant)}
                  title={lineTitle}
                >
                  <span className="block w-full min-w-0 truncate text-left text-sm leading-snug">
                    <span className="font-medium">{tenant.name}</span>
                    {metaParts.length > 0 ? (
                      <span className="text-[rgb(var(--color-muted-foreground))]">
                        {" · "}
                        {metaParts.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      </FloatingDropdown>
    </div>
  );
}
