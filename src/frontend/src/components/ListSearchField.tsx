const SearchGlyph = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

export type ListSearchFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Accessible name (sr-only label + aria-label). */
  label: string;
  placeholder: string;
  className?: string;
  wrapperStyle?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
};

/**
 * Inline search field for list toolbars: updates the parent on every keystroke.
 * Use with client-side filtering or debounced server requests from the parent.
 */
export function ListSearchField({
  id,
  value,
  onChange,
  label,
  placeholder,
  className,
  wrapperStyle,
  inputStyle,
}: ListSearchFieldProps) {
  const defaultInputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "7px 10px 7px 32px",
    border: "var(--border-default)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    background: "var(--color-stone)",
    color: "var(--color-ink)",
    outline: "none",
  };

  return (
    <div
      className={className}
      style={{ position: "relative", flex: "1 1 0%", maxWidth: 280, minWidth: 160, ...wrapperStyle }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span
        style={{
          position: "absolute",
          left: 9,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--color-ink-3)",
          pointerEvents: "none",
          display: "flex",
        }}
      >
        <SearchGlyph />
      </span>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        style={{ ...defaultInputStyle, ...inputStyle }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--color-rose)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "";
        }}
      />
    </div>
  );
}
