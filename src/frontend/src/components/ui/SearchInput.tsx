import { useTranslation } from "react-i18next";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  resultCount?: number;
  totalCount?: number;
  id?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  resultCount,
  totalCount,
  id = "search-input",
}: SearchInputProps) {
  const { t } = useTranslation();
  const ph = placeholder ?? t("femme.searchInput.placeholderDefault");

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
        <div
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            width: 13,
            height: 13,
            border: "1.5px solid var(--color-ink-3)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              bottom: -3,
              right: -3,
              width: 5,
              height: 1.5,
              background: "var(--color-ink-3)",
              transform: "rotate(45deg)",
            }}
          />
        </div>

        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
          aria-label={ph}
          style={{
            width: "100%",
            padding: "8px 32px 8px 30px",
            border: "1px solid var(--color-stone-md)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            color: "var(--color-ink)",
            background: "var(--color-white)",
            outline: "none",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = "var(--color-rose)";
            e.target.style.boxShadow = "0 0 0 3px var(--color-rose-lt)";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "var(--color-stone-md)";
            e.target.style.boxShadow = "none";
          }}
        />

        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={t("femme.searchInput.clearAria")}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "var(--color-stone-md)",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "var(--color-ink-2)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      {value && resultCount !== undefined && totalCount !== undefined ? (
        <span
          style={{
            fontSize: 11,
            color: resultCount === 0 ? "var(--color-danger)" : "var(--color-ink-3)",
            whiteSpace: "nowrap",
          }}
        >
          {resultCount === 0
            ? t("femme.searchInput.noResults")
            : t("femme.searchInput.resultCount", { count: resultCount, total: totalCount })}
        </span>
      ) : null}
    </div>
  );
}
