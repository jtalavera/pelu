import type { FemmeTourStepDef } from "../useTour";

export const fiscalStampSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='fiscal-stamp-header']",
    titleKey: "femme.tour.fiscalStamp.header.title",
    contentKey: "femme.tour.fiscalStamp.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='fiscal-stamp-list']",
    titleKey: "femme.tour.fiscalStamp.list.title",
    contentKey: "femme.tour.fiscalStamp.list.content",
    placement: "top",
  },
  {
    target: "[data-tour='fiscal-stamp-form']",
    titleKey: "femme.tour.fiscalStamp.form.title",
    contentKey: "femme.tour.fiscalStamp.form.content",
    placement: "top",
  },
];
