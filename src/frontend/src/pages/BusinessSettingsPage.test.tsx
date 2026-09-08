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

let meRole: "ADMIN" | "PROFESSIONAL" = "ADMIN";
vi.mock("../hooks/useMe", () => ({
  useMe: () => ({
    me: {
      userId: 1,
      tenantId: 1,
      email: "isabelzymanscki@gmail.com",
      role: meRole,
      professionalId: null,
    },
    loading: false,
  }),
}));

let sifenInvoicingFlagEnabled = false;
vi.mock("../hooks/useFeatureFlags", () => ({
  useFeatureFlag: (key: string) =>
    key === "SIFEN_ELECTRONIC_INVOICING" ? sifenInvoicingFlagEnabled : false,
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
    meRole = "ADMIN";
    sifenInvoicingFlagEnabled = false;
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
      taxpayerType: null,
      economicActivityCode: null,
      economicActivityDescription: null,
      sifenFantasyName: null,
      kudeFooterMessage: null,
      sifenDepartmentCode: null,
      sifenDepartmentName: null,
      sifenCityCode: null,
      sifenCityName: null,
    });
    femmePutJsonMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it("loads business settings and shows the save action", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
    expect(screen.getByLabelText(/business or legal name/i)).toBeTruthy();
  });

  it("shows a success alert at the top after saving", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText(/business or legal name/i);
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

  it("shows a forbidden message and never loads data for a non-admin role", async () => {
    meRole = "PROFESSIONAL";
    renderPage();
    expect(
      await screen.findByText(/Only the business administrator can manage business settings/i),
    ).toBeTruthy();
    expect(femmeJsonMock).not.toHaveBeenCalledWith("/api/business-profile");
  });

  it("hides the SIFEN tax data section when the feature flag is off", async () => {
    renderPage();
    await screen.findByLabelText(/business or legal name/i);
    expect(screen.queryByText(/SIFEN tax data/i)).toBeNull();
  });

  it("shows the trade name field right below the business name, even with the SIFEN flag off", async () => {
    const user = userEvent.setup();
    renderPage();
    const businessName = await screen.findByLabelText(/business or legal name/i);
    const tradeName = screen.getByLabelText(/trade name/i);
    expect(tradeName).toBeTruthy();
    // trade name comes after the business name in DOM order
    expect(
      businessName.compareDocumentPosition(tradeName) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.type(tradeName, "Salón Demo");
    const saveBtns = screen.getAllByRole("button", { name: /save changes/i });
    await user.click(saveBtns[0]);
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(femmePutJsonMock).toHaveBeenCalledWith(
      "/api/business-profile",
      expect.objectContaining({ sifenFantasyName: "Salón Demo" }),
    );
  });

  it("shows the SIFEN tax data section and saves it when the feature flag is on", async () => {
    sifenInvoicingFlagEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText(/business or legal name/i);
    expect(screen.getByText(/SIFEN tax data/i)).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: /legal entity/i }));
    await user.type(screen.getByLabelText(/economic activity code/i), "96020");
    await user.type(
      screen.getByLabelText(/economic activity description/i),
      "Peluquería y otros tratamientos de belleza",
    );
    await user.type(screen.getByLabelText(/trade name/i), "Peluquería Lucía");

    const saveBtns = screen.getAllByRole("button", { name: /save changes/i });
    await user.click(saveBtns[0]);

    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(femmePutJsonMock).toHaveBeenCalledWith(
      "/api/business-profile",
      expect.objectContaining({
        taxpayerType: "LEGAL_ENTITY",
        economicActivityCode: "96020",
        economicActivityDescription: "Peluquería y otros tratamientos de belleza",
        sifenFantasyName: "Peluquería Lucía",
        sifenDepartmentCode: null,
        sifenDepartmentName: null,
        sifenCityCode: null,
        sifenCityName: null,
      }),
    );
  });
});
