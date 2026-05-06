import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import FiscalStampSettingsPage from "./FiscalStampSettingsPage";

const femmeJsonMock = vi.fn();
const femmePostJsonMock = vi.fn();
const femmePutJsonMock = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
  femmePostJson: (...args: unknown[]) => femmePostJsonMock(...args),
  femmePutJson: (...args: unknown[]) => femmePutJsonMock(...args),
}));

const ACTIVE_STAMP = {
  id: 7,
  stampNumber: "12345678",
  validFrom: "2026-01-01",
  validUntil: "2026-12-31",
  rangeFrom: 1,
  rangeTo: 100,
  nextEmissionNumber: 5,
  active: true,
  lockedAfterInvoice: false,
};

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
    femmeJsonMock.mockReset();
    femmePostJsonMock.mockReset();
    femmePutJsonMock.mockReset();
    femmeJsonMock.mockResolvedValue([]);
    femmePostJsonMock.mockResolvedValue({});
    femmePutJsonMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it("lists registered stamps section and add form when empty", async () => {
    renderPage();
    expect(await screen.findByText(/No stamps yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /add stamp/i })).toBeTruthy();
    expect(screen.getByLabelText(/stamp number/i)).toBeTruthy();
  });

  it("edit dialog only shows the starting emission number field (item 20)", async () => {
    femmeJsonMock.mockResolvedValueOnce([ACTIVE_STAMP]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(ACTIVE_STAMP.stampNumber);
    const editBtns = screen.getAllByRole("button", { name: /^edit stamp$/i });
    await user.click(editBtns[0]);
    const dialogs = await screen.findAllByRole("dialog");
    const dialog = dialogs[0];
    expect(within(dialog).getByLabelText(/starting invoice number/i)).toBeTruthy();
    expect(within(dialog).queryByLabelText(/validity start/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/validity end/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/^stamp number$/i)).toBeNull();
  });

  it("submitting the edit form keeps existing dates and updates only the starting number (item 20)", async () => {
    femmeJsonMock.mockResolvedValue([ACTIVE_STAMP]);
    femmePutJsonMock.mockResolvedValue({ ...ACTIVE_STAMP, nextEmissionNumber: 25 });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(ACTIVE_STAMP.stampNumber);
    const editBtns = screen.getAllByRole("button", { name: /^edit stamp$/i });
    await user.click(editBtns[0]);
    const dialog = (await screen.findAllByRole("dialog"))[0];
    const startInput = within(dialog).getByLabelText(/starting invoice number/i);
    await user.clear(startInput);
    await user.type(startInput, "25");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(femmePutJsonMock).toHaveBeenCalledWith(
      `/api/fiscal-stamps/${ACTIVE_STAMP.id}`,
      {
        validFrom: ACTIVE_STAMP.validFrom,
        validUntil: ACTIVE_STAMP.validUntil,
        nextEmissionNumber: 25,
      },
    );
  });
});
