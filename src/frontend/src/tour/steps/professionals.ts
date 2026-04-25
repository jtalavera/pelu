import type { FemmeTourStepDef } from "../useTour";

export const professionalsSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='professionals-header']",
    titleKey: "femme.tour.professionals.header.title",
    contentKey: "femme.tour.professionals.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='professionals-search']",
    titleKey: "femme.tour.professionals.search.title",
    contentKey: "femme.tour.professionals.search.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='professionals-new']",
    titleKey: "femme.tour.professionals.new.title",
    contentKey: "femme.tour.professionals.new.content",
    placement: "bottom-end",
  },
  {
    target: "[data-tour='professionals-list']",
    titleKey: "femme.tour.professionals.list.title",
    contentKey: "femme.tour.professionals.list.content",
    placement: "top",
  },
];
