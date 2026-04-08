import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import BusinessSettingsPage from "./BusinessSettingsPage";

vi.mock("../api/femmeClient", () => ({
  femmeJson: vi.fn(() =>
    Promise.resolve({
      businessName: "Demo",
      ruc: null,
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
      rucValidForInvoicing: false,
    }),
  ),
  femmePutJson: vi.fn(() => Promise.resolve({})),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <BusinessSettingsPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("BusinessSettingsPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
  });

  it("loads business settings and shows the save action", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
    expect(screen.getByLabelText(/business name/i)).toBeTruthy();
  });
});
