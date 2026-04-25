import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ClientDetailPage from "./ClientDetailPage";

const femmeJson = vi.fn();
const femmePutJson = vi.fn();
const femmePostJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
}));

const sampleClient = {
  id: 1,
  fullName: "Ana García",
  phone: "0981000001",
  email: "ana@example.com",
  ruc: "80000005-6",
  active: true,
  visitCount: 3,
};

function renderPage(clientId = "1") {
  return render(
    <MemoryRouter initialEntries={[`/app/clients/${clientId}`]}>
      <Routes>
        <Route
          path="/app/clients/:id"
          element={
            <I18nextProvider i18n={i18n}>
              <ThemeProvider>
                <ClientDetailPage />
              </ThemeProvider>
            </I18nextProvider>
          }
        />
        <Route path="/app/clients" element={<div>Clients list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function defaultFemmeJsonImpl(url: unknown) {
  const s = String(url);
  if (s.startsWith("/api/clients/") && !s.includes("?")) {
    return Promise.resolve({
      id: 1,
      fullName: "Ana García",
      phone: "0981000001",
      email: "ana@example.com",
      ruc: "80000005-6",
      active: true,
      visitCount: 3,
    });
  }
  if (s.startsWith("/api/invoices?") || s.startsWith("/api/appointments?")) {
    return Promise.resolve([]);
  }
  return Promise.reject(new Error(`unmocked: ${s}`));
}

describe("ClientDetailPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmeJson.mockImplementation(defaultFemmeJsonImpl);
    femmePutJson.mockReset();
    femmePostJson.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows client name in heading after loading", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: /Ana García/i })).toBeTruthy();
  });

  it("shows visit count", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(screen.getByText(/3 visit/i)).toBeTruthy();
  });

  it("shows edit form pre-filled with client data", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const nameInput = screen.getByLabelText(/full name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Ana García");
    const phoneInput = screen.getByLabelText(/phone/i) as HTMLInputElement;
    expect(phoneInput.value).toBe("0981000001");
  });

  it("shows error when load fails", async () => {
    femmeJson.mockReset();
    femmeJson.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText(/could not load client profile/i)).toBeTruthy();
  });

  it("validates required full name on save", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const nameInput = screen.getByLabelText(/full name/i);
    await userEvent.clear(nameInput);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter the client.*full name/i)).toBeTruthy();
  });

  it("validates invalid RUC format on save", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const rucInput = screen.getByLabelText(/^ruc/i);
    await userEvent.clear(rucInput);
    await userEvent.type(rucInput, "invalidruc");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/invalid ruc/i)).toBeTruthy();
  });

  it("saves successfully and updates client name", async () => {
    const updated = { ...sampleClient, fullName: "Ana Updated" };
    femmePutJson.mockResolvedValue(updated);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const nameInput = screen.getByLabelText(/full name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Ana Updated");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(femmePutJson).toHaveBeenCalled());
  });

  it("shows deactivate button for active client", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(screen.getByRole("button", { name: /deactivate/i })).toBeTruthy();
  });

  it("inactive client shows inactive badge, reactivate button, and no deactivate button", async () => {
    femmeJson.mockImplementation((url) => {
      if (String(url).startsWith("/api/clients/") && !String(url).includes("?")) {
        return Promise.resolve({ ...sampleClient, active: false });
      }
      return defaultFemmeJsonImpl(url);
    });
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(screen.getByText(/inactive/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
    expect(screen.getByRole("button", { name: /reactivate/i })).toBeTruthy();
  });

  it("shows only one success message after save", async () => {
    const updated = { ...sampleClient, fullName: "Ana Updated" };
    femmePutJson.mockResolvedValue(updated);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const nameInput = screen.getByLabelText(/full name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Ana Updated");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(femmePutJson).toHaveBeenCalled());
    const successNodes = screen.queryAllByText(/client updated successfully/i);
    expect(successNodes).toHaveLength(1);
  });

  it("shows history tab with appointments and invoices sections", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    await userEvent.click(screen.getByRole("tab", { name: /history/i }));
    expect(await screen.findByText(/upcoming/i)).toBeTruthy();
    expect(
      (await screen.findAllByText(/no appointments on record/i)).length,
    ).toBe(2);
    expect(screen.getByText(/no invoices on record/i)).toBeTruthy();
  });

  it("history tab shows upcoming future appointment in Upcoming", async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    femmeJson.mockImplementation((url) => {
      const s = String(url);
      if (s.startsWith("/api/clients/") && !s.includes("?")) {
        return Promise.resolve(sampleClient);
      }
      if (s.startsWith("/api/appointments?")) {
        return Promise.resolve([
          {
            id: 50,
            clientId: 1,
            clientName: "Ana García",
            professionalId: 2,
            professionalName: "Pro",
            serviceId: 3,
            serviceName: "Cut",
            durationMinutes: 60,
            startAt: future.toISOString(),
            endAt: new Date(future.getTime() + 3600_000).toISOString(),
            status: "CONFIRMED" as const,
            cancelReason: null,
          },
        ]);
      }
      if (s.startsWith("/api/invoices?")) {
        return Promise.resolve([]);
      }
      return defaultFemmeJsonImpl(url);
    });
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    await userEvent.click(screen.getByRole("tab", { name: /history/i }));
    expect(await screen.findByText("Cut")).toBeTruthy();
  });

  it("navigates back to client list when back button clicked", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    await userEvent.click(screen.getByRole("button", { name: /back to clients/i }));
    expect(await screen.findByText("Clients list")).toBeTruthy();
  });
});
