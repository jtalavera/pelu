import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "../test/renderWithTour";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import DesignSystemShowcasePage from "./DesignSystemShowcasePage";

// Explicit cleanup between tests — `vite.config.ts` doesn't set `globals: true`/RTL's automatic
// afterEach hook, so a still-mounted component from an earlier test can otherwise leak into
// `document.body` and pollute later `getByText`/`getByTestId` assertions in this file.
afterEach(() => {
  cleanup();
});

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter>
          <DesignSystemShowcasePage />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("DesignSystemShowcasePage", () => {
  it("renders the design system gallery with a main landmark", () => {
    renderPage();
    expect(screen.getByRole("main", { name: "Component gallery" })).toBeTruthy();
  });
});
