import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";

type Client = {
  id: number;
  fullName: string;
  phone: string | null;
  ruc: string | null;
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
};

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

export function ClientSearchField({ value, onChange, onCreateNew, id }: Props) {
  const { t } = useTranslation();
  const inputId = id ?? "client-search-field";

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // If a client is already selected, show their name in the input
  useEffect(() => {
    if (value?.type === "client") {
      setQuery(value.client.fullName);
    } else if (value?.type === "occasional") {
      setQuery(t("femme.clients.inlineSearch.occasional"));
    } else {
      setQuery("");
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
    if (v.trim().length < MIN_CHARS) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void doSearch(v.trim());
    }, DEBOUNCE_MS);
  }

  async function doSearch(q: string) {
    setSearching(true);
    try {
      const data = await femmeJson<Client[]>(`/api/clients?q=${encodeURIComponent(q)}`);
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

  const showDropdown = open && query.trim().length >= MIN_CHARS;

  return (
    <div ref={containerRef} className="relative w-full">
      <Label htmlFor={inputId}>{t("femme.clients.inlineSearch.label")}</Label>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          value={query}
          onChange={handleQueryChange}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder={t("femme.clients.inlineSearch.placeholder")}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? `${inputId}-listbox` : undefined}
          aria-label={t("femme.clients.inlineSearch.label")}
        />
        {searching ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner size="sm" />
          </span>
        ) : null}
      </div>

      {query.trim().length > 0 && query.trim().length < MIN_CHARS ? (
        <Text variant="muted" className="mt-1 text-sm">
          {t("femme.clients.inlineSearch.minChars")}
        </Text>
      ) : null}

      {value?.type === "client" ? (
        <Text variant="muted" className="mt-1 text-sm" aria-live="polite">
          {t("femme.clients.inlineSearch.selected")}: <strong>{value.client.fullName}</strong>
          {value.client.phone ? ` · ${value.client.phone}` : ""}
          {value.client.ruc ? ` · RUC ${value.client.ruc}` : ""}
        </Text>
      ) : null}

      {showDropdown ? (
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          aria-label={t("femme.clients.inlineSearch.label")}
          className="absolute z-50 mt-1 w-full rounded-md border border-[rgb(var(--color-border))] bg-[rgb(var(--color-card))] shadow-lg"
        >
          {results.length === 0 ? (
            <>
              <li className="px-3 py-2">
                <Text variant="muted" className="text-sm">
                  {t("femme.clients.inlineSearch.noResults")}
                </Text>
              </li>
              {onCreateNew ? (
                <li>
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
            </>
          ) : (
            results.map((client) => (
              <li key={client.id} role="option" aria-selected={false}>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start rounded-none px-3 py-2 text-sm"
                  onClick={() => selectClient(client)}
                >
                  <span className="flex flex-col items-start">
                    <span className="font-medium">{client.fullName}</span>
                    <span className="text-xs text-[rgb(var(--color-muted-foreground))]">
                      {[client.phone, client.ruc ? `RUC ${client.ruc}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </Button>
              </li>
            ))
          )}
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
