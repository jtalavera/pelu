/** Keys allowed by the backend; map to design tokens in `tokens.css`. */
export const CATEGORY_ACCENT_KEYS = [
  "rose",
  "coral",
  "fuchsia",
  "violet",
  "indigo",
  "sky",
  "teal",
  "lime",
  "amber",
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
    case "coral":
      return { bg: "var(--color-coral-lt)", color: "var(--color-coral)" };
    case "fuchsia":
      return { bg: "var(--color-fuchsia-lt)", color: "var(--color-fuchsia)" };
    case "violet":
      return { bg: "var(--color-violet-lt)", color: "var(--color-violet)" };
    case "indigo":
      return { bg: "var(--color-indigo-lt)", color: "var(--color-indigo)" };
    case "sky":
      return { bg: "var(--color-sky-lt)", color: "var(--color-sky)" };
    case "teal":
      return { bg: "var(--color-teal-lt)", color: "var(--color-teal)" };
    case "lime":
      return { bg: "var(--color-lime-lt)", color: "var(--color-lime)" };
    case "amber":
      return { bg: "var(--color-amber-lt)", color: "var(--color-amber)" };
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
