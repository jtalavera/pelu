import type { FemmeTourStepDef } from "../useTour";

/** Same page anatomy (and data-tour anchors) as the services tour, with product-specific copy. */
export const productsSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='services-header']",
    titleKey: "femme.tour.products.header.title",
    contentKey: "femme.tour.products.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='services-search']",
    titleKey: "femme.tour.products.search.title",
    contentKey: "femme.tour.products.search.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='services-filters']",
    titleKey: "femme.tour.products.filters.title",
    contentKey: "femme.tour.products.filters.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='services-add-category']",
    titleKey: "femme.tour.products.addCategory.title",
    contentKey: "femme.tour.products.addCategory.content",
    placement: "bottom-end",
  },
  {
    target: "[data-tour='services-list']",
    titleKey: "femme.tour.products.list.title",
    contentKey: "femme.tour.products.list.content",
    placement: "top",
  },
];
