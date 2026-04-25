import type { FemmeTourStepDef } from "../useTour";

export const servicesSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='services-header']",
    titleKey: "femme.tour.services.header.title",
    contentKey: "femme.tour.services.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='services-search']",
    titleKey: "femme.tour.services.search.title",
    contentKey: "femme.tour.services.search.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='services-filters']",
    titleKey: "femme.tour.services.filters.title",
    contentKey: "femme.tour.services.filters.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='services-add-category']",
    titleKey: "femme.tour.services.addCategory.title",
    contentKey: "femme.tour.services.addCategory.content",
    placement: "bottom-end",
  },
  {
    target: "[data-tour='services-list']",
    titleKey: "femme.tour.services.list.title",
    contentKey: "femme.tour.services.list.content",
    placement: "top",
  },
];
