import type { FemmeTourStepDef } from "../useTour";

export const businessSettingsSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='settings-nav']",
    titleKey: "femme.tour.businessSettings.nav.title",
    contentKey: "femme.tour.businessSettings.nav.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='settings-form']",
    titleKey: "femme.tour.businessSettings.form.title",
    contentKey: "femme.tour.businessSettings.form.content",
    placement: "right",
  },
  {
    target: "[data-tour='settings-logo']",
    titleKey: "femme.tour.businessSettings.logo.title",
    contentKey: "femme.tour.businessSettings.logo.content",
    placement: "right",
  },
  {
    target: "[data-tour='settings-save']",
    titleKey: "femme.tour.businessSettings.save.title",
    contentKey: "femme.tour.businessSettings.save.content",
    placement: "top",
  },
];
