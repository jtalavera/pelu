import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ProfessionalsPage from "./ProfessionalsPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();
const femmePutJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
}));

const PROFESSIONAL = {
  id: 1,
  fullName: "Ana Gomez",
  phone: "555",
  email: "ana@example.com",
  photoDataUrl: null,
  active: true,
  schedules: [{ dayOfWeek: 1, startTime: "09:00:00", endTime: "17:00:00" }],
};

const INACTIVE_PROFESSIONAL = { ...PROFESSIONAL, active: false };

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ProfessionalsPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

/** The ThemeProvider renders two trees; pick the first matching element. */
function getFirst(role: string, name: RegExp | string) {
  return screen.getAllByRole(role, { name })[0];
}

describe("ProfessionalsPage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    femmePutJson.mockReset();
  });

  it("loads professionals and shows actions", async () => {
    femmeJson.mockResolvedValue([PROFESSIONAL]);
    renderPage();
    expect(await screen.findAllByRole("heading", { name: /professionals/i })).toBeTruthy();
    expect(await screen.findByText(/ana gomez/i)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /new professional/i }).length).toBeGreaterThan(0);
  });

  it("shows Activate for inactive professionals and calls activate API on confirm", async () => {
    femmeJson
      .mockResolvedValueOnce([INACTIVE_PROFESSIONAL])
      .mockResolvedValueOnce([{ ...INACTIVE_PROFESSIONAL, active: true }]);
    femmePostJson.mockResolvedValue({ ...INACTIVE_PROFESSIONAL, active: true });
    renderPage();

    const activateBtns = await screen.findAllByRole("button", { name: /^activate$/i });
    await userEvent.click(activateBtns[0]);

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^activate$/i }));

    await waitFor(() => {
      expect(femmePostJson).toHaveBeenCalledWith("/api/professionals/1/activate", {});
    });
    expect(femmeJson.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("shows Details tab first and Schedule tab is disabled for new professional", async () => {
    femmeJson.mockResolvedValue([]);
    renderPage();
    await screen.findAllByRole("heading", { name: /professionals/i });

    await userEvent.click(getFirst("button", /new professional/i));

    // Details tab should be visible
    const detailsTab = await screen.findAllByRole("tab", { name: /details/i });
    expect(detailsTab[0]).toBeTruthy();

    // Schedule tab should be disabled
    const scheduleTabs = screen.getAllByRole("tab", { name: /schedule/i });
    expect((scheduleTabs[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("validates full name is required on Details tab", async () => {
    femmeJson.mockResolvedValue([]);
    renderPage();
    await screen.findAllByRole("heading", { name: /professionals/i });

    await userEvent.click(getFirst("button", /new professional/i));
    await userEvent.click(getFirst("button", /save and set schedule/i));

    expect(
      await screen.findByText(/enter the professional.*full name|enter a full name/i),
    ).toBeTruthy();
  });

  it("unlocks Schedule tab after saving details", async () => {
    femmeJson.mockResolvedValue([]);
    femmePostJson.mockResolvedValue(PROFESSIONAL);
    femmePutJson.mockResolvedValue(PROFESSIONAL);
    renderPage();
    await screen.findAllByRole("heading", { name: /professionals/i });

    await userEvent.click(getFirst("button", /new professional/i));
    const nameInputs = screen.getAllByLabelText(/full name/i);
    await userEvent.type(nameInputs[0], "Ana Gomez");
    await userEvent.click(getFirst("button", /save and set schedule/i));

    // After saving, the schedule tab should become enabled
    await waitFor(() => {
      const tabs = screen.getAllByRole("tab", { name: /schedule/i });
      expect((tabs[0] as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
