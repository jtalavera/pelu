import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
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

function renderPage(clientId = "1", search = "") {
  return render(
    <MemoryRouter initialEntries={[`/app/clients/${clientId}${search}`]}>
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

const emptyPagedInvoices = {
  content: [],
  page: 0,
  size: 10,
  totalElements: 0,
  totalPages: 0,
  issuedTotal: 0,
};

const emptyPagedAppointments = {
  content: [],
  page: 0,
  size: 10,
  totalElements: 0,
  totalPages: 0,
};

const emptySummary = {
  usualProfessionals: [],
  lastVisitAt: null,
  spentLast12Months: null,
  averageTicketLast12Months: null,
  lastServices: [],
  lastProducts: [],
};

const emptyTechnicalSheet = {
  clientId: 1,
  clientName: "Ana García",
  active: true,
  notes: null,
  notesUpdatedAt: null,
  notesUpdatedBy: null,
  colorFormula: null,
  colorFormulaUpdatedAt: null,
  colorFormulaUpdatedBy: null,
};

function defaultFemmeJsonImpl(url: unknown) {
  const s = String(url);
  if (s.endsWith("/summary")) {
    return Promise.resolve(emptySummary);
  }
  if (s.endsWith("/technical-sheet")) {
    return Promise.resolve(emptyTechnicalSheet);
  }
  if (s.startsWith("/api/clients/") && !s.includes("?") && !s.endsWith("/summary") && !s.endsWith("/technical-sheet")) {
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
  if (s.startsWith("/api/invoices?")) {
    return Promise.resolve(emptyPagedInvoices);
  }
  if (s.startsWith("/api/appointments/history?")) {
    return Promise.resolve(emptyPagedAppointments);
  }
  if (s.startsWith("/api/appointments?")) {
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

  async function openDataTab() {
    await screen.findByRole("heading", { name: /Ana García/i });
    await userEvent.click(screen.getByRole("tab", { name: "Details" }));
  }

  it("shows the facts line: visits, last visit, spent in 12 months and usual professional", async () => {
    femmeJson.mockImplementation((url) => {
      if (String(url).endsWith("/summary")) {
        return Promise.resolve({
          ...emptySummary,
          lastVisitAt: "2026-10-26T15:00:00Z",
          spentLast12Months: "1250000",
          usualProfessionals: [{ id: 2, fullName: "Laura", active: true, serviceCount: 5 }],
        });
      }
      return defaultFemmeJsonImpl(url);
    });
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const facts = await screen.findByText(/Usual: Laura/);
    expect(facts.parentElement?.textContent).toMatch(/3 visits/);
    expect(facts.parentElement?.textContent).toMatch(/Last visit/);
    expect(facts.parentElement?.textContent).toMatch(/Spent Gs\./);
    expect(screen.getByTestId("client-contact-actions")).toBeTruthy();
  });

  it("shows edit form pre-filled with client data (Details tab)", async () => {
    renderPage();
    await openDataTab();
    const nameInput = screen.getByLabelText(/full name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Ana García");
    const phoneInput = screen.getByLabelText(/^phone$/i) as HTMLInputElement;
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
    await openDataTab();
    const nameInput = screen.getByLabelText(/full name/i);
    await userEvent.clear(nameInput);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter the client.*full name/i)).toBeTruthy();
  });

  it("validates invalid RUC format on save (opens Tax details)", async () => {
    renderPage();
    await openDataTab();
    await userEvent.click(screen.getByTestId("client-section-fiscal-toggle"));
    const documentNumberInput = screen.getByLabelText(/document number/i);
    await userEvent.clear(documentNumberInput);
    await userEvent.type(documentNumberInput, "invalidruc");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/invalid ruc/i)).toBeTruthy();
  });

  it("tax details and profile are folded until opened", async () => {
    renderPage();
    await openDataTab();
    expect(screen.queryByLabelText(/document number/i)).toBeNull();
    const toggle = screen.getByTestId("client-section-fiscal-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText(/document number/i)).toBeTruthy();
    expect(screen.getByTestId("client-section-profile-toggle").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("formats the phone field with the Paraguay mask while typing", async () => {
    renderPage();
    await openDataTab();
    const phoneInput = screen.getByLabelText(/^phone$/i) as HTMLInputElement;
    await userEvent.clear(phoneInput);
    await userEvent.click(phoneInput);
    await userEvent.keyboard("0981123456");
    expect(phoneInput.value).toBe("(0981) 123-456");
  });

  it("blocks save when the phone has fewer than 10 digits", async () => {
    renderPage();
    await openDataTab();
    const phoneInput = screen.getByLabelText(/^phone$/i);
    await userEvent.clear(phoneInput);
    await userEvent.click(phoneInput);
    await userEvent.keyboard("0981123");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter all 10 digits/i)).toBeTruthy();
    expect(femmePutJson).not.toHaveBeenCalled();
  });

  it("blocks save when the email is invalid", async () => {
    renderPage();
    await openDataTab();
    const emailInput = screen.getByLabelText(/^email$/i);
    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, "@no-prefix.com");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter a valid email/i)).toBeTruthy();
    expect(femmePutJson).not.toHaveBeenCalled();
  });

  it("saving closes the form and returns to the list with the success notice", async () => {
    femmePutJson.mockResolvedValue({ ...sampleClient, fullName: "Ana Updated" });
    renderPage();
    await openDataTab();
    const nameInput = screen.getByLabelText(/full name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Ana Updated");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(femmePutJson).toHaveBeenCalled());
    expect(await screen.findByText("Clients list")).toBeTruthy();
  });

  it("shows the deactivate link for an active client and confirms before deactivating", async () => {
    femmePostJson.mockResolvedValue({ ...sampleClient, active: false });
    renderPage();
    await openDataTab();
    await userEvent.click(screen.getByTestId("client-edit-deactivate"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /^deactivate$/i }),
    );
    await waitFor(() =>
      expect(femmePostJson).toHaveBeenCalledWith("/api/clients/1/deactivate", {}),
    );
    expect(await screen.findByText("Clients list")).toBeTruthy();
  });

  it("inactive client shows inactive badge, reactivate link, and no deactivate link", async () => {
    femmeJson.mockImplementation((url) => {
      if (String(url).startsWith("/api/clients/") && !String(url).includes("?") && !String(url).endsWith("/summary") && !String(url).endsWith("/technical-sheet")) {
        return Promise.resolve({ ...sampleClient, active: false });
      }
      return defaultFemmeJsonImpl(url);
    });
    renderPage();
    await openDataTab();
    expect(screen.getByText(/inactive/i)).toBeTruthy();
    expect(screen.queryByTestId("client-edit-deactivate")).toBeNull();
    expect(screen.getByTestId("client-edit-reactivate")).toBeTruthy();
  });

  it("three tabs in order: History (default), Technical sheet, Details", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const tabs = screen.getAllByRole("tab").map((el) => el.textContent);
    expect(tabs).toEqual(["History", "Technical sheet", "Details"]);
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
  });

  it("history is empty when there are no appointments or invoices", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(await screen.findByTestId("client-history-empty")).toBeTruthy();
  });

  it("?tab= in the URL opens that tab; unknown values fall back to History", async () => {
    renderPage("1", "?tab=sheet");
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(screen.getByRole("tab", { name: "Technical sheet" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    cleanup();
    renderPage("1", "?tab=nope");
    await screen.findByRole("heading", { name: /Ana García/i });
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
  });

  it("history shows the next appointment and one merged timeline of appointments and invoices", async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const appt = (id: number, startAt: string, serviceName: string, status: string) => ({
      id,
      clientId: 1,
      clientName: "Ana García",
      professionalId: 2,
      professionalName: "Pro",
      serviceId: 3,
      serviceName,
      durationMinutes: 60,
      startAt,
      endAt: startAt,
      status,
      cancelReason: null,
    });
    femmeJson.mockImplementation((url) => {
      const s = String(url);
      if (s.startsWith("/api/clients/") && !s.includes("?") && !s.endsWith("/summary") && !s.endsWith("/technical-sheet")) {
        return Promise.resolve(sampleClient);
      }
      if (s.startsWith("/api/appointments?")) {
        return Promise.resolve([appt(50, future.toISOString(), "Cut", "CONFIRMED")]);
      }
      if (s.startsWith("/api/appointments/history?")) {
        return Promise.resolve({
          ...emptyPagedAppointments,
          content: [
            appt(40, "2026-10-26T15:00:00Z", "Coloring", "COMPLETED"),
            appt(41, "2026-09-14T15:00:00Z", "Brushing", "COMPLETED"),
          ],
          totalElements: 2,
          totalPages: 1,
        });
      }
      if (s.startsWith("/api/invoices?")) {
        return Promise.resolve({
          ...emptyPagedInvoices,
          content: [
            {
              id: 9,
              invoiceNumber: 123,
              invoiceNumberFormatted: "001-001-0000123",
              clientDisplayName: "Ana García",
              status: "ISSUED",
              total: "300000",
              issuedAt: "2026-10-26T16:00:00Z",
              sifenSubmissionStatus: "APPROVED",
            },
          ],
          totalElements: 1,
          totalPages: 1,
        });
      }
      return defaultFemmeJsonImpl(url);
    });
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    const next = await screen.findByTestId("client-next-appointment");
    expect(within(next).getByText("Cut")).toBeTruthy();
    const items = await screen.findAllByTestId("client-history-item");
    expect(items.map((el) => el.getAttribute("data-kind"))).toEqual([
      "invoice",
      "appointment",
      "appointment",
    ]);
    expect(within(items[0]).getByText(/#001-001-0000123/)).toBeTruthy();
    expect(within(items[1]).getByText("Coloring")).toBeTruthy();
    expect(screen.queryByTestId("client-history-more")).toBeNull();
  });

  it("navigates back to client list when back button clicked", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /Ana García/i });
    await userEvent.click(screen.getByRole("button", { name: /back to clients/i }));
    expect(await screen.findByText("Clients list")).toBeTruthy();
  });
});
