import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import BusinessSettingsPage from "./BusinessSettingsPage";

const femmeJsonMock = vi.fn();
const femmePutJsonMock = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
  femmePutJson: (...args: unknown[]) => femmePutJsonMock(...args),
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
    femmeJsonMock.mockReset();
    femmePutJsonMock.mockReset();
    femmeJsonMock.mockResolvedValue({
      businessName: "Demo",
      ruc: null,
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
      rucValidForInvoicing: false,
    });
    femmePutJsonMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it("loads business settings and shows the save action", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
    expect(screen.getByLabelText(/business name/i)).toBeTruthy();
  });

  it("shows a success alert at the top after saving", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText(/business name/i);
    const saveBtns = screen.getAllByRole("button", { name: /save changes/i });
    await user.click(saveBtns[0]);
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(
      screen.getByText(/Your business details were saved/i),
    ).toBeTruthy();
  });

  it("formats the phone field with the Paraguay mask while typing", async () => {
    const user = userEvent.setup();
    renderPage();
    const phoneField = (await screen.findAllByLabelText(/^phone$/i))[0] as HTMLInputElement;
    await user.click(phoneField);
    await user.keyboard("0981123456");
    expect(phoneField.value).toBe("(0981) 123-456");
  });

  it("blocks save when the phone has fewer than 10 digits", async () => {
    const user = userEvent.setup();
    renderPage();
    const phoneField = (await screen.findAllByLabelText(/^phone$/i))[0];
    await user.click(phoneField);
    await user.keyboard("0981123");
    const saveBtns = screen.getAllByRole("button", { name: /save changes/i });
    await user.click(saveBtns[0]);
    expect(await screen.findAllByText(/Enter the 10 digits/i)).toBeTruthy();
    expect(femmePutJsonMock).not.toHaveBeenCalled();
  });

  it("blocks save when the contact email is invalid", async () => {
    const user = userEvent.setup();
    renderPage();
    const emailField = (await screen.findAllByLabelText(/contact email/i))[0];
    await user.click(emailField);
    await user.keyboard("@invalid.com");
    const saveBtns = screen.getAllByRole("button", { name: /save changes/i });
    await user.click(saveBtns[0]);
    expect(await screen.findAllByText(/Enter a valid email/i)).toBeTruthy();
    expect(femmePutJsonMock).not.toHaveBeenCalled();
  });
});
