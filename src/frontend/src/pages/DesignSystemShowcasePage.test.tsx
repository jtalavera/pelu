import { describe, expect, it } from "vitest";
import { render, screen } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
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

  it("shows a closable alert that the × closes and a button brings back", async () => {
    renderPage();
    const alert = screen.getByTestId("showcase-closable-alert");
    expect(alert.textContent).toContain("Closable alert");
    await userEvent.click(screen.getByRole("button", { name: "Close notice" }));
    expect(screen.queryByTestId("showcase-closable-alert")).toBeNull();
    await userEvent.click(screen.getByTestId("showcase-closable-alert-reset"));
    expect(screen.getByTestId("showcase-closable-alert")).toBeTruthy();
  });
});
