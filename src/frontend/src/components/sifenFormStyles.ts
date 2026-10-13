import type { CSSProperties } from "react";

/**
 * Look of the SIFEN credential forms (certificate, CSC). Same format as Configuración → Timbrado →
 * "Agregar timbrado" (FiscalStampSettingsPage): a stone card with an uppercase section title, a
 * two-column field grid with a small label above and a hint below each field, and the registered
 * items in a white card.
 */
export const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--color-ink-2)",
  marginBottom: 4,
};

export const hintStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--color-ink-3)",
  marginTop: 3,
  // Examples such as the 32-character CSC have no break opportunity: wrap them on a phone.
  overflowWrap: "anywhere",
};

export const sectionTitleStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.06em",
  color: "var(--color-ink-3)",
  textTransform: "uppercase",
  margin: "0 0 10px",
  paddingBottom: 6,
  borderBottom: "var(--border-default)",
};

/** White card: information (registered items, summary). */
export const sectionCardStyle: CSSProperties = {
  border: "var(--border-default)",
  borderRadius: "var(--radius-xl)",
  padding: 16,
  marginBottom: 16,
  background: "var(--color-white)",
};

/** Stone card: the "add" form. */
export const createSectionCardStyle: CSSProperties = {
  ...sectionCardStyle,
  background: "var(--color-stone)",
};

/** Two columns on wide screens, one on a phone. */
export const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
  gap: 12,
};

export const fullRowStyle: CSSProperties = { gridColumn: "1 / -1" };

export const tableWrapStyle: CSSProperties = {
  border: "var(--border-default)",
  borderRadius: "var(--radius-xl)",
  overflow: "hidden",
};

export const thStyle: CSSProperties = {
  padding: "9px 12px",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--color-ink-3)",
  background: "var(--color-stone)",
  textAlign: "left",
  whiteSpace: "nowrap",
};

export const tdStyle: CSSProperties = {
  padding: "10px 12px",
  fontSize: 12,
  borderTop: "var(--border-default)",
  verticalAlign: "middle",
};

export function buildInputStyle(hasError: boolean, focused: boolean): CSSProperties {
  const base: CSSProperties = {
    padding: "8px 11px",
    border: hasError ? "1px solid var(--color-danger)" : "1px solid var(--color-stone-md)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    color: "var(--color-ink)",
    background: "var(--color-white)",
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };
  if (focused) {
    base.boxShadow = hasError
      ? "0 0 0 3px var(--color-danger-lt)"
      : "0 0 0 3px var(--color-rose-lt)";
    if (!hasError) base.borderColor = "var(--color-rose)";
  }
  return base;
}
