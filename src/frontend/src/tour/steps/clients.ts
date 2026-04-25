import type { FemmeTourStepDef } from "../useTour";

export const clientsSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='clients-header']",
    titleKey: "femme.tour.clients.header.title",
    contentKey: "femme.tour.clients.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='clients-search']",
    titleKey: "femme.tour.clients.search.title",
    contentKey: "femme.tour.clients.search.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='clients-filter-tabs']",
    titleKey: "femme.tour.clients.filterTabs.title",
    contentKey: "femme.tour.clients.filterTabs.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='clients-new']",
    titleKey: "femme.tour.clients.new.title",
    contentKey: "femme.tour.clients.new.content",
    placement: "bottom-end",
  },
  {
    target: "[data-tour='clients-list']",
    titleKey: "femme.tour.clients.list.title",
    contentKey: "femme.tour.clients.list.content",
    placement: "top",
  },
];
