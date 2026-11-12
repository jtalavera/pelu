/** @type {import('tailwindcss').Config} */

// Semantic colors resolve to the `--fb-*` RGB triplets in src/styles/tokens.css, so they follow the
// light/dark theme automatically and support opacity modifiers (e.g. `bg-primary/10`).
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./design-system/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette (fixed; does not change with the theme)
        teal: { brand: token("fb-teal") },
        tinta: token("fb-tinta"),
        durazno: token("fb-durazno"),
        lino: token("fb-lino"),
        celeste: token("fb-celeste"),
        rosa: token("fb-rosa"),
        // Semantic (theme-aware)
        primary: {
          DEFAULT: token("fb-primary"),
          lt: token("fb-primary-lt"),
          md: token("fb-primary-md"),
          dk: token("fb-primary-dk"),
          fg: token("fb-on-primary"),
        },
        secondary: {
          DEFAULT: token("fb-secondary"),
          lt: token("fb-secondary-lt"),
          md: token("fb-secondary-md"),
          dk: token("fb-secondary-dk"),
        },
        accent: {
          DEFAULT: token("fb-accent"),
          fg: token("fb-accent-ink"),
        },
        page: token("fb-bg"),
        surface: token("fb-surface"),
        line: token("fb-border"),
        ink: {
          DEFAULT: token("fb-ink"),
          2: token("fb-ink-2"),
          3: token("fb-ink-3"),
        },
        success: { DEFAULT: token("fb-success"), lt: token("fb-success-lt") },
        warning: { DEFAULT: token("fb-warning"), lt: token("fb-warning-lt") },
        danger: { DEFAULT: token("fb-danger"), lt: token("fb-danger-lt") },
      },
      fontFamily: {
        sans: [
          "Nunito Sans Variable",
          "Nunito Sans",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          "Apple Color Emoji",
          "Segoe UI Emoji",
        ],
        heading: [
          "Nunito Variable",
          "Nunito",
          "Nunito Sans Variable",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "var(--radius-xl)",
      },
      // Flat look: a barely-there lift instead of the old drop shadows.
      boxShadow: {
        card: "0 1px 2px 0 rgb(10 31 51 / 0.05)",
        "card-hover": "0 6px 16px -4px rgb(10 31 51 / 0.12)",
      },
    },
  },
  plugins: [],
};
