import type { FemmeTourStepDef } from "../useTour";

export const calendarSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='calendar-header']",
    titleKey: "femme.tour.calendar.header.title",
    contentKey: "femme.tour.calendar.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='calendar-prof-filter']",
    titleKey: "femme.tour.calendar.profFilter.title",
    contentKey: "femme.tour.calendar.profFilter.content",
    placement: "bottom",
    roles: ["ADMIN"],
  },
  {
    target: "[data-tour='calendar-today']",
    titleKey: "femme.tour.calendar.today.title",
    contentKey: "femme.tour.calendar.today.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='calendar-week-nav']",
    titleKey: "femme.tour.calendar.weekNav.title",
    contentKey: "femme.tour.calendar.weekNav.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='calendar-new-appointment']",
    titleKey: "femme.tour.calendar.newAppointment.title",
    contentKey: "femme.tour.calendar.newAppointment.content",
    placement: "bottom-end",
  },
  {
    target: "[data-tour='calendar-grid']",
    titleKey: "femme.tour.calendar.grid.title",
    contentKey: "femme.tour.calendar.grid.content",
    placement: "top",
  },
];
