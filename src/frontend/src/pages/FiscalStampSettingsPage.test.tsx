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
  establishment: 1,
  expeditionPoint: 1,
  hasInvoices: false,
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

  async function openEditDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /actions for stamp/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^edit stamp$/i }));
    return (await screen.findAllByRole("dialog"))[0];
  }

  it("shows the empty state with an Add stamp action that opens the form in a dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/No stamps yet/i)).toBeTruthy();
    expect(screen.queryByLabelText(/stamp number/i)).toBeNull();
    await user.click(screen.getByTestId("fiscal-stamp-add"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/stamp number/i)).toBeTruthy();
  });

  it("lists each stamp as a row with its status and next number, actions in a menu", async () => {
    femmeJsonMock.mockResolvedValueOnce([ACTIVE_STAMP]);
    const user = userEvent.setup();
    renderPage();
    const row = await screen.findByTestId(`fiscal-stamp-row-${ACTIVE_STAMP.id}`);
    expect(row.textContent).toMatch(/Stamp 12345678/);
    expect(row.textContent).toMatch(/001-001-0000005/);
    await user.click(within(row).getByRole("button", { name: /actions for stamp/i }));
    expect(await screen.findByRole("menuitem", { name: /deactivate/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^delete$/i })).toBeTruthy();
  });

  it("edit dialog lets every field be edited while the stamp has no invoices (issue #290)", async () => {
    femmeJsonMock.mockResolvedValueOnce([ACTIVE_STAMP]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId(`fiscal-stamp-row-${ACTIVE_STAMP.id}`);
    const dialog = await openEditDialog(user);
    const expectations: [RegExp, string][] = [
      [/^stamp number$/i, ACTIVE_STAMP.stampNumber],
      [/^validity start$/i, ACTIVE_STAMP.validFrom],
      [/^validity end$/i, ACTIVE_STAMP.validUntil],
      [/^number from$/i, String(ACTIVE_STAMP.rangeFrom)],
      [/^number to$/i, String(ACTIVE_STAMP.rangeTo)],
      [/starting invoice number/i, String(ACTIVE_STAMP.nextEmissionNumber)],
      [/^establishment$/i, String(ACTIVE_STAMP.establishment)],
      [/expedition point/i, String(ACTIVE_STAMP.expeditionPoint)],
    ];
    for (const [label, value] of expectations) {
      const input = within(dialog).getByLabelText(label) as HTMLInputElement;
      expect(input.disabled).toBe(false);
      // Dates are pre-filled verbatim (no Date round-trip that could shift the day).
      expect(input.value).toBe(value);
    }
  });

  it("once the stamp has invoices only validity end, number to and starting number stay editable (issue #290)", async () => {
    const usedStamp = { ...ACTIVE_STAMP, hasInvoices: true, lockedAfterInvoice: true };
    femmeJsonMock.mockResolvedValueOnce([usedStamp]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId(`fiscal-stamp-row-${usedStamp.id}`);
    const dialog = await openEditDialog(user);
    const field = (label: RegExp) => within(dialog).getByLabelText(label) as HTMLInputElement;
    for (const locked of [
      /^stamp number$/i,
      /^validity start$/i,
      /^number from$/i,
      /^establishment$/i,
      /expedition point/i,
    ]) {
      expect(field(locked).disabled).toBe(true);
    }
    for (const editable of [/^validity end$/i, /^number to$/i, /starting invoice number/i]) {
      expect(field(editable).disabled).toBe(false);
    }
  });

  it("submitting the edit form sends every field (issue #290)", async () => {
    femmeJsonMock.mockResolvedValue([ACTIVE_STAMP]);
    femmePutJsonMock.mockResolvedValue({ ...ACTIVE_STAMP, nextEmissionNumber: 25 });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId(`fiscal-stamp-row-${ACTIVE_STAMP.id}`);
    const dialog = await openEditDialog(user);
    const replace = async (label: RegExp, value: string) => {
      const input = within(dialog).getByLabelText(label);
      await user.clear(input);
      if (value) await user.type(input, value);
    };
    await replace(/^stamp number$/i, "87654321");
    await replace(/^number from$/i, "10");
    await replace(/^number to$/i, "");
    await replace(/starting invoice number/i, "25");
    await replace(/^establishment$/i, "2");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(femmePutJsonMock).toHaveBeenCalledWith(`/api/fiscal-stamps/${ACTIVE_STAMP.id}`, {
      stampNumber: "87654321",
      validFrom: ACTIVE_STAMP.validFrom,
      validUntil: ACTIVE_STAMP.validUntil,
      rangeFrom: 10,
      rangeTo: null,
      nextEmissionNumber: 25,
      establishment: 2,
      expeditionPoint: ACTIVE_STAMP.expeditionPoint,
    });
  });

  it("creates a stamp without validity end or number to (issue #290)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/No stamps yet/i);
    await user.click(screen.getByTestId("fiscal-stamp-add"));
    await screen.findByRole("dialog");
    await user.type(screen.getByLabelText(/^stamp number$/i), "12345678");
    const vf = screen.getByLabelText(/^validity start$/i);
    await user.type(vf, "2026-10-10");
    await user.type(screen.getByLabelText(/^number from$/i), "1");
    await user.type(screen.getByLabelText(/starting invoice number/i), "1");
    await user.click(screen.getByTestId("fiscal-stamp-create-submit"));
    expect(femmePostJsonMock).toHaveBeenCalledWith(
      "/api/fiscal-stamps",
      expect.objectContaining({
        validFrom: "2026-10-10",
        validUntil: null,
        rangeFrom: 1,
        rangeTo: null,
        initialEmissionNumber: 1,
      }),
    );
  });

  it("shows stored dates without shifting a day west of UTC, and a dash for missing ends (issue #290)", async () => {
    // vi.stubEnv writes process.env.TZ, which Node applies to Date right away.
    vi.stubEnv("TZ", "America/Asuncion");
    try {
      femmeJsonMock.mockResolvedValueOnce([
        ACTIVE_STAMP,
        { ...ACTIVE_STAMP, id: 8, stampNumber: "999", active: false, validUntil: null, rangeTo: null },
      ]);
      renderPage();
      const row = await screen.findByTestId(`fiscal-stamp-row-${ACTIVE_STAMP.id}`);
      // validFrom 2026-01-01 would read as Dec 31, 2025 if parsed as UTC midnight.
      expect(row.textContent).not.toMatch(/2025/);
      expect(row.textContent).toMatch(/Dec 31, 2026/);
      const openEnded = screen.getByTestId("fiscal-stamp-row-8");
      expect(openEnded.textContent).toMatch(/–\s—\s·/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
