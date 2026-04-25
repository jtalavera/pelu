import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
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

describe("ClientDetailPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePutJson.mockReset();
    femmePostJson.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows client name in heading after loading", async () => {
    femmeJson.mockResolvedValue(sampleClient);
    renderPage();
    expect(await screen.findByRole("heading", { name: /Ana García/i })).toBeTruthy();
  });

  it("shows visit count", async () => {
    femmeJson.mockResolvedValue(sampleClient);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(screen.getByText(/3 visit/i)).toBeTruthy();
  });

  it("shows edit form pre-filled with client data", async () => {
    femmeJson.mockResolvedValue(sampleClient);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const nameInput = screen.getByLabelText(/full name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Ana García");
    const phoneInput = screen.getByLabelText(/phone/i) as HTMLInputElement;
    expect(phoneInput.value).toBe("0981000001");
  });

  it("shows error when load fails", async () => {
    femmeJson.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText(/could not load client profile/i)).toBeTruthy();
  });

  it("validates required full name on save", async () => {
    femmeJson.mockResolvedValue(sampleClient);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const nameInput = screen.getByLabelText(/full name/i);
    await userEvent.clear(nameInput);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter the client.*full name/i)).toBeTruthy();
  });

  it("validates invalid RUC format on save", async () => {
    femmeJson.mockResolvedValue(sampleClient);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const rucInput = screen.getByLabelText(/^ruc/i);
    await userEvent.clear(rucInput);
    await userEvent.type(rucInput, "invalidruc");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/invalid ruc/i)).toBeTruthy();
  });

  it("saves successfully and updates client name", async () => {
    femmeJson.mockResolvedValue(sampleClient);
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
    femmeJson.mockResolvedValue(sampleClient);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(screen.getByRole("button", { name: /deactivate/i })).toBeTruthy();
  });

  it("inactive client shows inactive badge, reactivate button, and no deactivate button", async () => {
    femmeJson.mockResolvedValue({ ...sampleClient, active: false });
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(screen.getByText(/inactive/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
    expect(screen.getByRole("button", { name: /reactivate/i })).toBeTruthy();
  });

  it("shows only one success message after save", async () => {
    femmeJson.mockResolvedValue(sampleClient);
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
    femmeJson.mockResolvedValue(sampleClient);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    await userEvent.click(screen.getByRole("tab", { name: /history/i }));
    expect(await screen.findByText(/no appointments on record/i)).toBeTruthy();
    expect(screen.getByText(/no invoices on record/i)).toBeTruthy();
  });

  it("navigates back to client list when back button clicked", async () => {
    femmeJson.mockResolvedValue(sampleClient);
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    await userEvent.click(screen.getByRole("button", { name: /back to clients/i }));
    expect(await screen.findByText("Clients list")).toBeTruthy();
  });
});
