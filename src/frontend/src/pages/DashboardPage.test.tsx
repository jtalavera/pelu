import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import DashboardPage from "./DashboardPage";

const femmeJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <DashboardPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("DashboardPage fiscal alerts (HU-02b)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmeJson.mockResolvedValue({
      appointmentsToday: {
        total: 0,
        pending: 0,
        confirmed: 0,
        inProgress: 0,
        completed: 0,
      },
      revenueDay: { invoiced: "0", collected: "0" },
      revenueWeek: { invoiced: "0", collected: "0" },
      fiscalAlerts: [
        {
          severity: "blocking",
          messageKey: "fiscalExpiredOrExhausted",
          message: "blocking",
        },
      ],
    });
  });

  it("shows destructive alert for blocking fiscal messages", async () => {
    renderPage();
    const alerts = await screen.findAllByRole("alert");
    const blocking = alerts.find((el) => el.textContent?.includes("expired") || el.textContent?.includes("exhausted"));
    expect(blocking).toBeTruthy();
  });
});
