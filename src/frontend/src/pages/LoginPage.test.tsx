import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import i18n from "../i18n";
import LoginPage from "./LoginPage";

/** Avoid registering joyride timers; full login flow is covered in e2e. */
vi.mock("../tour/useTour", () => ({ useTour: () => ({ startTour: () => undefined }) }));

// Explicit cleanup between tests — `vite.config.ts` doesn't set `globals: true`/RTL's automatic
// afterEach hook, so a still-mounted component from an earlier test can otherwise leak into
// `document.body` and pollute later `getByText`/`getByTestId` assertions in this file.
afterEach(() => {
  cleanup();
});

describe("LoginPage", () => {
  it("renders the sign-in form and submit action (HU auth)", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("heading", { name: new RegExp(i18n.t("femme.login.title"), "i") }),
    ).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(i18n.t("femme.login.email"), "i"))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(i18n.t("femme.login.password"), "i"))).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(i18n.t("femme.login.submit"), "i") })).toBeTruthy();
  });
});
