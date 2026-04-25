import type { FemmeTourStepDef } from "../useTour";
import { appShellSteps } from "./appShell";

/** Dashboard tour — includes shell navigation steps on first visit. */
export const dashboardSteps: FemmeTourStepDef[] = [
  ...appShellSteps,
  {
    target: "[data-tour='dashboard-greeting']",
    titleKey: "femme.tour.dashboard.greeting.title",
    contentKey: "femme.tour.dashboard.greeting.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='dashboard-new-appointment']",
    titleKey: "femme.tour.dashboard.newAppointment.title",
    contentKey: "femme.tour.dashboard.newAppointment.content",
    placement: "bottom-end",
  },
  {
    target: "[data-tour='dashboard-metrics']",
    titleKey: "femme.tour.dashboard.metrics.title",
    contentKey: "femme.tour.dashboard.metrics.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='dashboard-appt-list']",
    titleKey: "femme.tour.dashboard.apptList.title",
    contentKey: "femme.tour.dashboard.apptList.content",
    placement: "top",
  },
  {
    target: "[data-tour='dashboard-appt-filter']",
    titleKey: "femme.tour.dashboard.apptFilter.title",
    contentKey: "femme.tour.dashboard.apptFilter.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='dashboard-view-agenda']",
    titleKey: "femme.tour.dashboard.viewAgenda.title",
    contentKey: "femme.tour.dashboard.viewAgenda.content",
    placement: "top",
  },
  {
    target: "[data-tour='dashboard-mini-cal']",
    titleKey: "femme.tour.dashboard.miniCal.title",
    contentKey: "femme.tour.dashboard.miniCal.content",
    placement: "left",
  },
  {
    target: "[data-tour='dashboard-occupancy']",
    titleKey: "femme.tour.dashboard.occupancy.title",
    contentKey: "femme.tour.dashboard.occupancy.content",
    placement: "left",
  },
];
