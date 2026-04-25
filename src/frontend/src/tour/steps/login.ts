import type { FemmeTourStepDef } from "../useTour";

export const loginSteps: FemmeTourStepDef[] = [
  {
    target: "[data-tour='login-form']",
    titleKey: "femme.tour.login.form.title",
    contentKey: "femme.tour.login.form.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='login-email']",
    titleKey: "femme.tour.login.email.title",
    contentKey: "femme.tour.login.email.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='login-password']",
    titleKey: "femme.tour.login.password.title",
    contentKey: "femme.tour.login.password.content",
    placement: "bottom",
  },
  {
    target: "[data-tour='login-submit']",
    titleKey: "femme.tour.login.submit.title",
    contentKey: "femme.tour.login.submit.content",
    placement: "top",
  },
  {
    target: "[data-tour='login-forgot']",
    titleKey: "femme.tour.login.forgot.title",
    contentKey: "femme.tour.login.forgot.content",
    placement: "top",
  },
];
