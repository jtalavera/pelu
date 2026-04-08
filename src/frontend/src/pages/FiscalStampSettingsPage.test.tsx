import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import FiscalStampSettingsPage from "./FiscalStampSettingsPage";

vi.mock("../api/femmeClient", () => ({
  femmeJson: vi.fn(() => Promise.resolve([])),
  femmePostJson: vi.fn(() => Promise.resolve({})),
  femmePutJson: vi.fn(() => Promise.resolve({})),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <FiscalStampSettingsPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("FiscalStampSettingsPage (HU-02b)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
  });

  it("lists registered stamps section and add form when empty", async () => {
    renderPage();
    expect(await screen.findByText(/No stamps yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /add stamp/i })).toBeTruthy();
    expect(screen.getByLabelText(/stamp number/i)).toBeTruthy();
  });
});
