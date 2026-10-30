import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ProfessionalsPage from "./ProfessionalsPage";

const femmePostJson = vi.fn();
const femmePutJson = vi.fn();
const listProfessionalsPaged = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
}));

vi.mock("../api/professionals", () => ({
  listProfessionalsPaged: (...args: unknown[]) => listProfessionalsPaged(...args),
}));

function makePageResponse(items: unknown[]) {
  return { content: items, page: 0, size: 10, totalElements: items.length, totalPages: 1 };
}

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

describe("ProfessionalsPage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    listProfessionalsPaged.mockReset();
    femmePostJson.mockReset();
    femmePutJson.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads professionals and shows the new button", async () => {
    listProfessionalsPaged.mockResolvedValue(makePageResponse([PROFESSIONAL]));
    renderPage();
    expect(await screen.findByText(/ana gomez/i)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /new professional/i }).length).toBeGreaterThan(0);
  });

  it("turns a professional on with the row switch and calls activate API on confirm", async () => {
    listProfessionalsPaged
      .mockResolvedValueOnce(makePageResponse([INACTIVE_PROFESSIONAL]))
      .mockResolvedValueOnce(makePageResponse([{ ...INACTIVE_PROFESSIONAL, active: true }]));
    femmePostJson.mockResolvedValue({ ...INACTIVE_PROFESSIONAL, active: true });
    renderPage();

    const toggles = await screen.findAllByTestId(`prof-switch-${INACTIVE_PROFESSIONAL.id}`);
    expect((toggles[0] as HTMLInputElement).checked).toBe(false);
    await userEvent.click(toggles[0]);

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^activate$/i }));

    await waitFor(() => {
      expect(femmePostJson).toHaveBeenCalledWith("/api/professionals/1/activate", {});
    });
    await waitFor(() => {
      expect(listProfessionalsPaged.mock.calls.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 2000 });
  });

  it("new professional form is one view: name, phone and a Monday-to-Saturday 9-18 schedule by default", async () => {
    listProfessionalsPaged.mockResolvedValue(makePageResponse([]));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /new professional/i }));

    expect(await screen.findByLabelText(/full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/phone/i)).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByTestId("prof-schedule-summary").textContent).toMatch(
      /Monday to Saturday.*09:00 to 18:00/,
    );
    // Email, PIN, system access and photo live under "More options".
    expect(screen.queryByLabelText(/^email/i)).toBeNull();
    expect(document.getElementById("prof-pin")).toBeNull();
  });

  it("validates full name is required", async () => {
    listProfessionalsPaged.mockResolvedValue(makePageResponse([]));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /new professional/i }));
    await userEvent.click(await screen.findByTestId("prof-save"));

    expect(
      await screen.findByText(/enter the professional.*full name|enter a full name/i),
    ).toBeTruthy();
  });

  it("photo file input (HU-20) is under More options and accepts images", async () => {
    listProfessionalsPaged.mockResolvedValue(makePageResponse([]));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /new professional/i }));
    await userEvent.click(await screen.findByTestId("prof-more-options-toggle"));

    const fileInput = document.getElementById("prof-photo-file") as HTMLInputElement | null;
    expect(fileInput?.type).toBe("file");
    expect(fileInput?.accept ?? "").toMatch(/image\/jpeg/);
    expect(fileInput?.accept ?? "").toMatch(/image\/png/);
  });

  it("creates the professional and saves the default schedule in one step", async () => {
    listProfessionalsPaged.mockResolvedValue(makePageResponse([]));
    femmePostJson.mockResolvedValue(PROFESSIONAL);
    femmePutJson.mockResolvedValue(PROFESSIONAL);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /new professional/i }));
    await userEvent.type(await screen.findByLabelText(/full name/i), "Ana Gomez");
    await userEvent.click(screen.getByTestId("prof-save"));

    await waitFor(() => {
      expect(femmePostJson).toHaveBeenCalledWith(
        "/api/professionals",
        expect.objectContaining({ fullName: "Ana Gomez" }),
      );
    });
    await waitFor(() => {
      expect(femmePutJson).toHaveBeenCalledWith(
        "/api/professionals/1/schedules",
        [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "18:00" })),
      );
    });
  });
});
