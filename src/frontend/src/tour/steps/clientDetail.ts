import type { FemmeTourStepDef } from "../useTour";

export const clientDetailSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='client-detail-header']",
    titleKey: "femme.tour.clientDetail.header.title",
    contentKey: "femme.tour.clientDetail.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='client-detail-tabs']",
    titleKey: "femme.tour.clientDetail.tabs.title",
    contentKey: "femme.tour.clientDetail.tabs.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='client-detail-edit']",
    titleKey: "femme.tour.clientDetail.editInfo.title",
    contentKey: "femme.tour.clientDetail.editInfo.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='client-detail-status']",
    titleKey: "femme.tour.clientDetail.status.title",
    contentKey: "femme.tour.clientDetail.status.content",
    placement: "bottom",
  },
];
