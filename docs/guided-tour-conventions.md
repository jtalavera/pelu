# Guided Tour Conventions

This document describes how to add a guided tour to any new screen in the Femme/Pelu frontend using **react-joyride v3**.

---

## Overview

Every authenticated screen has a floating "?" button (FAB) that lets users launch a guided tour. The tour auto-launches the first time a user visits each page. Tours support both Spanish and English via i18next.

Key files:

| File | Purpose |
|---|---|
| `src/tour/TourContext.tsx` | React context — holds `run`, `steps`, `tourKey`; provides `registerTour`, `startTour`, `hasSeenTour`, `handleEvent` |
| `src/tour/TourJoyride.tsx` | Renders the single `<Joyride>` instance using the context |
| `src/tour/TourButton.tsx` | Floating "?" FAB — pulses on first visit, triggers `startTour` |
| `src/tour/useTour.ts` | Hook called from each page to register and auto-start its tour |
| `src/tour/steps/*.ts` | Module-level step definition arrays, one file per page |
| `src/App.tsx` | Wraps `<BrowserRouter>` with `<TourProvider>` and renders `<TourJoyride>` |
| `src/layout/AppShell.tsx` | Renders `<TourButton>` and has `data-tour` on all nav/topbar elements |

---

## Adding a tour to a new screen

### 1. Create the step definitions file

Create `src/tour/steps/<pageName>.ts`. Export a **module-level constant** (never inline — it must be stable to avoid re-registration on every render).

```ts
// src/tour/steps/myPage.ts
import type { FemmeTourStepDef } from "../useTour";

export const myPageSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='my-page-header']",
    titleKey: "femme.tour.myPage.header.title",
    contentKey: "femme.tour.myPage.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='my-page-list']",
    titleKey: "femme.tour.myPage.list.title",
    contentKey: "femme.tour.myPage.list.content",
    placement: "top",
    roles: ["ADMIN"],  // optional — omit to show to all roles
  },
];
```

**`FemmeTourStepDef` fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | Yes | CSS selector targeting a `[data-tour='…']` attribute |
| `titleKey` | `string` | Yes | i18n key for the tooltip title |
| `contentKey` | `string` | Yes | i18n key for the tooltip body |
| `placement` | `Placement` | No | Joyride placement (`"top"`, `"bottom"`, `"left"`, `"right"`, `"auto"`, etc.). Defaults to `"auto"` |
| `roles` | `Array<"ADMIN" \| "PROFESSIONAL">` | No | Restricts step to specific roles. Omit to show to everyone |

### 2. Add `data-tour` attributes to the JSX

Every step target must have a `data-tour` attribute in the DOM. Use lowercase kebab-case: `<page>-<element>`.

```tsx
// Header
<div data-tour="my-page-header" ...>...</div>

// Primary action button
<button data-tour="my-page-new" type="button" ...>New</button>

// List/table container
<div data-tour="my-page-list" ...>...</div>
```

**Important:** Custom components may not forward unknown props to the DOM. If a component doesn't accept `data-tour`, wrap it:

```tsx
// Wrong: SearchableSelect doesn't forward data-*
<SearchableSelect data-tour="my-page-filter" ... />

// Correct: wrap in a plain div
<div data-tour="my-page-filter">
  <SearchableSelect ... />
</div>
```

### 3. Call `useTour` in the page component

```tsx
import { useTour } from "../tour/useTour";
import { myPageSteps } from "../tour/steps/myPage";

export default function MyPage() {
  const { t } = useTranslation();
  useTour("my-page", myPageSteps);   // call near the top, before any early returns
  // ...
}
```

For role-aware tours, pass the role:

```tsx
const { data: me } = useCurrentUser();
useTour("my-page", myPageSteps, me?.role);
```

The hook:
- Registers the steps with `TourContext`
- Auto-launches the tour 700 ms after first mount if the user hasn't seen it before
- Re-registers when the `key`, language, or `role` changes

### 4. Add i18n keys to both locale files

Every `titleKey` and `contentKey` must exist in **both** `en.json` and `es.json` under `femme.tour.<pageName>.<element>`:

```json
// en.json — inside "femme": { "tour": { ... } }
"myPage": {
  "header": { "title": "Page header", "content": "This section shows…" },
  "list":   { "title": "Item list",   "content": "All items are listed here…" }
}
```

```json
// es.json — inside "femme": { "tour": { ... } }
"myPage": {
  "header": { "title": "Encabezado", "content": "Esta sección muestra…" },
  "list":   { "title": "Lista",      "content": "Todos los elementos…" }
}
```

---

## Naming conventions

| Concept | Convention | Example |
|---|---|---|
| `data-tour` attribute | `<page>-<element>` kebab-case | `my-page-header`, `billing-new-invoice` |
| Tour key (`useTour` first arg) | Same as page slug | `"my-page"`, `"billing"` |
| Step file | `src/tour/steps/<pageName>.ts` | `myPage.ts`, `billing.ts` |
| i18n path | `femme.tour.<pageName>.<element>` | `femme.tour.myPage.header.title` |
| Step export | `<pageName>Steps` | `myPageSteps`, `billingSteps` |
| `localStorage` key | `femme.tour.seen.<tourKey>` | `femme.tour.seen.my-page` |

---

## Role-based steps

Use the `roles` field to restrict a step to one or more roles:

```ts
{
  target: "[data-tour='calendar-prof-filter']",
  titleKey: "femme.tour.calendar.profFilter.title",
  contentKey: "femme.tour.calendar.profFilter.content",
  roles: ["ADMIN"],  // PROFESSIONAL users won't see this step
}
```

Steps without a `roles` field are shown to all roles.

---

## Navigation steps (AppShell)

If a page should orient first-time users to the entire navigation (like Dashboard), import and spread `appShellSteps` at the beginning of its step array:

```ts
import { appShellSteps } from "./appShell";
import type { FemmeTourStepDef } from "../useTour";

export const myPageSteps: FemmeTourStepDef[] = [
  ...appShellSteps,
  { target: "[data-tour='my-page-header']", ... },
];
```

`appShellSteps` covers: sidebar, all nav items (role-restricted where appropriate), topbar search, theme, language, notifications, and user menu.

---

## Auto-launch behaviour

The tour auto-launches **once per page key per browser**. The seen state is stored in `localStorage` under `femme.tour.seen.<tourKey>`. To reset (e.g. for testing), open DevTools → Application → Local Storage and delete the relevant key.

The FAB:
- Is always visible on authenticated screens
- Pulses (animated ring) until the user has seen the tour at least once
- Can be clicked to re-launch the tour at any time

---

## react-joyride v3 API notes

This project uses **react-joyride v3** (breaking changes from v2):

| v2 | v3 |
|---|---|
| `callback` prop | `onEvent` prop |
| `showProgress` top-level | `options.showProgress` |
| `styles.buttonNext` | `styles.buttonPrimary` |
| `disableBeacon` | `options.skipBeacon` |
| `EVENTS.TOUR_END` | `STATUS.FINISHED` / `STATUS.SKIPPED` |

Always check the [react-joyride v3 docs](https://docs.react-joyride.com) when making changes to `TourJoyride.tsx`.

---

## Existing tours

| Page | Tour key | Step file |
|---|---|---|
| Login | `login` | `steps/login.ts` |
| Dashboard | `dashboard` | `steps/dashboard.ts` (includes AppShell steps) |
| Calendar | `calendar` | `steps/calendar.ts` |
| Services | `services` | `steps/services.ts` |
| Billing | `billing` | `steps/billing.ts` |
| Clients | `clients` | `steps/clients.ts` |
| Client Detail | `client-detail` | `steps/clientDetail.ts` |
| Professionals | `professionals` | `steps/professionals.ts` |
| Business Settings | `business-settings` | `steps/businessSettings.ts` |
| Fiscal Stamp Settings | `fiscal-stamp` | `steps/fiscalStamp.ts` |
