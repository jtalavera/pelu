import type { CSSProperties } from "react";

/**
 * Look of the SIFEN credential forms (certificate, CSC). Same format as Configuración → Timbrado →
 * "Agregar timbrado" (FiscalStampSettingsPage): a stone card with an uppercase section title, a
 * two-column field grid with a small label above and a hint below each field, and the registered
 * items in a white card.
 */
const LINE = "rgb(var(--fb-border))";
const SURFACE = "rgb(var(--fb-surface))";

export const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  color: "rgb(var(--fb-ink-2))",
  marginBottom: 4,
};

export const hintStyle: CSSProperties = {
  fontSize: 13,
  color: "rgb(var(--fb-ink-3))",
  marginTop: 4,
  // Examples such as the 32-character CSC have no break opportunity: wrap them on a phone.
  overflowWrap: "anywhere",
};

export const sectionTitleStyle: CSSProperties = {
  fontFamily: "var(--font-heading, inherit)",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
  color: "rgb(var(--fb-primary))",
  textTransform: "uppercase",
  margin: "0 0 8px",
};

/** Card: information (registered items, summary). Border only, no tinted fill. */
export const sectionCardStyle: CSSProperties = {
  border: `1px solid ${LINE}`,
  borderRadius: "var(--radius-xl)",
  padding: 16,
  marginBottom: 12,
  background: SURFACE,
};

/** The "add" form: same card (no tinted fill). */
export const createSectionCardStyle: CSSProperties = { ...sectionCardStyle };

/** Two columns on wide screens, one on a phone. */
export const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
  gap: 12,
};

export const fullRowStyle: CSSProperties = { gridColumn: "1 / -1" };

export const tableWrapStyle: CSSProperties = {
  border: `1px solid ${LINE}`,
  borderRadius: "var(--radius-xl)",
  overflow: "hidden",
  background: SURFACE,
};

export const thStyle: CSSProperties = {
  padding: "9px 12px",
  fontSize: 12,
  fontWeight: 700,
  color: "rgb(var(--fb-ink-3))",
  background: "transparent",
  textAlign: "left",
  whiteSpace: "nowrap",
};

export const tdStyle: CSSProperties = {
  padding: "10px 12px",
  fontSize: 14,
  borderTop: `1px solid ${LINE}`,
  verticalAlign: "middle",
};

export function buildInputStyle(hasError: boolean, focused: boolean): CSSProperties {
  const base: CSSProperties = {
    minHeight: 44,
    padding: "8px 12px",
    border: hasError ? "1px solid rgb(var(--fb-danger))" : `1px solid ${LINE}`,
    borderRadius: 12,
    fontSize: 14,
    color: "rgb(var(--fb-ink))",
    background: SURFACE,
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };
  if (focused) {
    base.boxShadow = hasError ? "0 0 0 3px rgb(var(--fb-danger) / 0.2)" : "0 0 0 3px rgb(var(--fb-primary) / 0.2)";
    if (!hasError) base.borderColor = "rgb(var(--fb-primary))";
  }
  return base;
}
