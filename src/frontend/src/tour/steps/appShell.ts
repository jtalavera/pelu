import type { FemmeTourStepDef } from "../useTour";

/**
 * Shared sidebar + topbar steps.
 * Prepend these to a page-level tour so the user learns the shell on their
 * first visit (e.g. the dashboard tour).
 */
export const appShellSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='nav-sidebar']",
    titleKey: "femme.tour.nav.sidebar.title",
    contentKey: "femme.tour.nav.sidebar.content",
    placement: "right",
  },
  {
    target: "[data-tour='nav-dashboard']",
    titleKey: "femme.tour.nav.dashboard.title",
    contentKey: "femme.tour.nav.dashboard.content",
    placement: "right",
    roles: ["ADMIN"],
  },
  {
    target: "[data-tour='nav-calendar']",
    titleKey: "femme.tour.nav.calendar.title",
    contentKey: "femme.tour.nav.calendar.content",
    placement: "right",
  },
  {
    target: "[data-tour='nav-services']",
    titleKey: "femme.tour.nav.services.title",
    contentKey: "femme.tour.nav.services.content",
    placement: "right",
    roles: ["ADMIN"],
  },
  {
    target: "[data-tour='nav-professionals']",
    titleKey: "femme.tour.nav.professionals.title",
    contentKey: "femme.tour.nav.professionals.content",
    placement: "right",
    roles: ["ADMIN"],
  },
  {
    target: "[data-tour='nav-clients']",
    titleKey: "femme.tour.nav.clients.title",
    contentKey: "femme.tour.nav.clients.content",
    placement: "right",
    roles: ["ADMIN"],
  },
  {
    target: "[data-tour='nav-billing']",
    titleKey: "femme.tour.nav.billing.title",
    contentKey: "femme.tour.nav.billing.content",
    placement: "right",
    roles: ["ADMIN"],
  },
  {
    target: "[data-tour='nav-settings']",
    titleKey: "femme.tour.nav.settings.title",
    contentKey: "femme.tour.nav.settings.content",
    placement: "right",
    roles: ["ADMIN"],
  },
  {
    target: "[data-tour='topbar-search']",
    titleKey: "femme.tour.topbar.search.title",
    contentKey: "femme.tour.topbar.search.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='topbar-theme']",
    titleKey: "femme.tour.topbar.theme.title",
    contentKey: "femme.tour.topbar.theme.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='topbar-lang']",
    titleKey: "femme.tour.topbar.lang.title",
    contentKey: "femme.tour.topbar.lang.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='topbar-notifications']",
    titleKey: "femme.tour.topbar.notifications.title",
    contentKey: "femme.tour.topbar.notifications.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='topbar-user-menu']",
    titleKey: "femme.tour.topbar.userMenu.title",
    contentKey: "femme.tour.topbar.userMenu.content",
    placement: "bottom-end",
  },
];
