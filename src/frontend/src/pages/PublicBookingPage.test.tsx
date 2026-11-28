import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import PublicBookingPage from "./PublicBookingPage";

const fetchPublicBookingMock = vi.fn();
vi.mock("../api/publicBooking", () => ({
  fetchPublicBooking: (...args: unknown[]) => fetchPublicBookingMock(...args),
}));

function renderAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/r/:slug" element={<PublicBookingPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("PublicBookingPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("es");
    fetchPublicBookingMock.mockReset();
  });
  afterEach(() => cleanup());

  it("shows the salon's name when it is open for bookings", async () => {
    fetchPublicBookingMock.mockResolvedValue({ available: true, businessName: "Salón Bella" });
    renderAt("/r/bella");
    expect((await screen.findByTestId("public-booking-name")).textContent).toBe("Salón Bella");
    expect(fetchPublicBookingMock).toHaveBeenCalledWith("bella", expect.anything());
  });

  it("shows the neutral page when the link is not available", async () => {
    fetchPublicBookingMock.mockResolvedValue({ available: false });
    renderAt("/r/nope");
    expect((await screen.findByTestId("public-booking-unavailable")).textContent).toContain(
      "Este enlace no está disponible",
    );
  });

  it("offers a retry when the page cannot be loaded", async () => {
    fetchPublicBookingMock.mockRejectedValueOnce(new Error("PUBLIC_BOOKING_500"));
    fetchPublicBookingMock.mockResolvedValueOnce({ available: true, businessName: "Salón Bella" });
    renderAt("/r/bella");
    expect((await screen.findByRole("alert")).textContent).toContain("No pudimos cargar la página");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByTestId("public-booking-name")).toBeTruthy());
  });

  it("is translated to English", async () => {
    void i18n.changeLanguage("en");
    fetchPublicBookingMock.mockResolvedValue({ available: false });
    renderAt("/r/nope");
    expect(await screen.findByText("This link is not available")).toBeTruthy();
  });
});
