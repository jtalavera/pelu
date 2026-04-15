import { type ReactNode, useCallback, useMemo, useState } from "react";

interface FilterConfig<T> {
  fields: (keyof T)[];
  items: T[];
}

export function useFilteredList<T>({ fields, items }: FilterConfig<T>) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase().trim();
    return items.filter((item) =>
      fields.some((field) => {
        const val = item[field];
        if (val == null) return false;
        return String(val).toLowerCase().includes(q);
      }),
    );
  }, [query, items, fields]);

  const highlight = useCallback(
    (text: string): ReactNode => {
      if (!query.trim()) return text;
      const q = query.trim();
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return text;
      return (
        <>
          {text.slice(0, idx)}
          <mark
            style={{
              background: "var(--color-rose-lt)",
              color: "var(--color-rose-dk)",
              borderRadius: 2,
              padding: "0 1px",
            }}
          >
            {text.slice(idx, idx + q.length)}
          </mark>
          {text.slice(idx + q.length)}
        </>
      );
    },
    [query],
  );

  return { query, setQuery, filtered, highlight };
}
