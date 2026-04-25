import type { FemmeTourStepDef } from "../useTour";

export const billingSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='billing-header']",
    titleKey: "femme.tour.billing.header.title",
    contentKey: "femme.tour.billing.header.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='billing-session']",
    titleKey: "femme.tour.billing.session.title",
    contentKey: "femme.tour.billing.session.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='billing-new-invoice']",
    titleKey: "femme.tour.billing.newInvoice.title",
    contentKey: "femme.tour.billing.newInvoice.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='billing-search']",
    titleKey: "femme.tour.billing.search.title",
    contentKey: "femme.tour.billing.search.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='billing-invoice-list']",
    titleKey: "femme.tour.billing.invoiceList.title",
    contentKey: "femme.tour.billing.invoiceList.content",
    placement: "top",
  },
];
