import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    femmePutJson.mockReset();
  });

  it("loads professionals and shows actions", async () => {
    femmeJson.mockResolvedValue([
      {
        id: 1,
        fullName: "Ana Gomez",
        phone: "555",
        email: "ana@example.com",
        photoDataUrl: null,
        active: true,
        schedules: [{ dayOfWeek: 1, startTime: "09:00:00", endTime: "17:00:00" }],
      },
    ]);

    renderPage();
    expect(await screen.findByRole("heading", { name: /professionals/i })).toBeTruthy();
    expect(await screen.findByText(/ana gomez/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /new professional/i })).toBeTruthy();
  });

  it("opens modal and validates required full name", async () => {
    femmeJson.mockResolvedValue([]);
    renderPage();
    await screen.findByRole("heading", { name: /professionals/i });
    await userEvent.click(screen.getAllByRole("button", { name: /new professional/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter a full name/i)).toBeTruthy();
  });
});

