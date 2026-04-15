/** Keys allowed by the backend; map to design tokens in `tokens.css`. */
export const CATEGORY_ACCENT_KEYS = [
  "rose",
  "mauve",
  "success",
  "warning",
  "danger",
  "stone",
] as const;

export type CategoryAccentKey = (typeof CATEGORY_ACCENT_KEYS)[number];

export function categoryAccentStyle(key: string): { bg: string; color: string } {
  switch (key.toLowerCase()) {
    case "rose":
      return { bg: "var(--color-rose-lt)", color: "var(--color-rose)" };
    case "mauve":
      return { bg: "var(--color-mauve-lt)", color: "var(--color-mauve)" };
    case "success":
      return { bg: "var(--color-success-lt)", color: "var(--color-success)" };
    case "warning":
      return { bg: "var(--color-warning-lt)", color: "var(--color-warning)" };
    case "danger":
      return { bg: "var(--color-danger-lt)", color: "var(--color-danger)" };
    case "stone":
    default:
      return { bg: "var(--color-stone)", color: "var(--color-ink-3)" };
  }
}
