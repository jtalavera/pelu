import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";

type Client = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
  active?: boolean;
};

export type ClientSelection =
  | { type: "client"; client: Client }
  | { type: "occasional" }
  | null;

type Props = {
  value: ClientSelection;
  onChange: (selection: ClientSelection) => void;
  onCreateNew?: (query: string) => void;
  id?: string;
  /** Defaults to femme.clients.inlineSearch.label */
  label?: string;
  /** Defaults to femme.clients.inlineSearch.placeholder */
  placeholder?: string;
};

const DEBOUNCE_MS = 300;

export function ClientSearchField({
  value,
  onChange,
  onCreateNew,
  id,
  label,
  placeholder,
}: Props) {
  const { t } = useTranslation();
  const inputId = id ?? "client-search-field";
  const labelText = label ?? t("femme.clients.inlineSearch.label");
  const placeholderText = placeholder ?? t("femme.clients.inlineSearch.placeholder");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync from selection only when a concrete selection is set (not when cleared — user may be typing).
  useEffect(() => {
    if (value?.type === "client") {
      setQuery(value.client.fullName);
    } else if (value?.type === "occasional") {
      setQuery(t("femme.clients.inlineSearch.occasional"));
    }
  }, [value, t]);

  // Close dropdown when clicking outside
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
    // Clear selection when user types
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
          ? `/api/clients?q=${encodeURIComponent(q)}`
          : "/api/clients";
      const data = await femmeJson<Client[]>(url);
      setResults(Array.isArray(data) ? data : []);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function selectClient(client: Client) {
    onChange({ type: "client", client });
    setQuery(client.fullName);
    setOpen(false);
    setResults([]);
  }

  function selectOccasional() {
    onChange({ type: "occasional" });
    setQuery(t("femme.clients.inlineSearch.occasional"));
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
              selectClient(results[0]);
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

      {value?.type === "client" ? (
        <Text variant="muted" className="mt-1 text-sm" aria-live="polite">
          {t("femme.clients.inlineSearch.selected")}: <strong>{value.client.fullName}</strong>
          {value.client.phone ? ` · ${value.client.phone}` : ""}
          {value.client.ruc
            ? ` · ${t("femme.clients.ruc")} ${value.client.ruc}`
            : ""}
        </Text>
      ) : null}

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
                {t("femme.clients.inlineSearch.noResults")}
              </Text>
            </li>
          ) : null}
          {results.map((client) => {
            const metaParts = [
              client.active === false ? t("femme.status.INACTIVE") : null,
              client.phone,
              client.ruc ? `${t("femme.clients.ruc")} ${client.ruc}` : null,
            ].filter(Boolean) as string[];
            const lineTitle = [client.fullName, ...metaParts].join(" · ");
            return (
              <li key={client.id} role="option" aria-selected={false}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 text-sm"
                  onClick={() => selectClient(client)}
                  title={lineTitle}
                >
                  <span className="block w-full min-w-0 truncate text-left text-sm leading-snug">
                    <span className="font-medium">{client.fullName}</span>
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
          {onCreateNew ? (
            <li className="border-t border-[rgb(var(--color-border))]">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start rounded-none px-3 py-2 text-sm"
                onClick={() => {
                  setOpen(false);
                  onCreateNew(query.trim());
                }}
              >
                + {t("femme.clients.inlineSearch.createNew")}
              </Button>
            </li>
          ) : null}
          <li className="border-t border-[rgb(var(--color-border))]">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start rounded-none px-3 py-2 text-sm"
              onClick={selectOccasional}
            >
              {t("femme.clients.inlineSearch.occasional")}
            </Button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
