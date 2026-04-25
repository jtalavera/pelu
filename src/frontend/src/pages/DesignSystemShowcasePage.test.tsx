import { describe, expect, it } from "vitest";
import { render, screen } from "../test/renderWithTour";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import DesignSystemShowcasePage from "./DesignSystemShowcasePage";

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
