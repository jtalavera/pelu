import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ServiceRecordsPage from "./ServiceRecordsPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();
const femmePutJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
}));

const detail = {
  id: 1,
  clientId: 5,
  clientFullName: "Marta Benítez",
  clientRuc: null,
  status: "OPEN",
  totalAmount: "310000",
  tipsTotal: "0",
  voidReason: null,
  createdAt: "2026-10-26T13:30:00Z",
  closedAt: null,
  invoiceId: null,
  invoiceNumberFormatted: null,
  lines: [
    {
      id: 1,
      serviceId: 11,
      description: "Coloración",
      unitPrice: "250000",
      quantity: 1,
      lineTotal: "250000",
      professionalId: 3,
      professionalName: "Laura",
    },
  ],
  tips: [],
};

const items = [
  {
    id: 1,
    clientId: 5,
    clientFullName: "Marta Benítez",
    status: "OPEN",
    totalAmount: "310000",
    createdAt: "2026-10-26T13:30:00Z",
    servicesSummary: "Coloración, Brushing",
    professionalsSummary: "Laura, Ana",
  },
  {
    id: 2,
    clientId: 6,
    clientFullName: "Camila Ortiz",
    status: "CLOSED",
    totalAmount: "50000",
    createdAt: "2026-10-26T12:00:00Z",
    servicesSummary: "Manicura",
    professionalsSummary: "Rosa",
  },
  {
    id: 3,
    clientId: 7,
    clientFullName: "Patricia Núñez",
    status: "VOIDED",
    totalAmount: "120000",
    createdAt: "2026-10-24T12:00:00Z",
    servicesSummary: "Peinado",
    professionalsSummary: "Ana",
  },
];

function pageOf(content: typeof items) {
  return { content, page: 0, size: 10, totalElements: content.length, totalPages: content.length ? 1 : 0 };
}

function renderPage(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/app/service-records", state }]}>
      <Routes>
        <Route
          path="/app/service-records"
          element={
            <I18nextProvider i18n={i18n}>
              <ThemeProvider>
                <ServiceRecordsPage />
              </ThemeProvider>
            </I18nextProvider>
          }
        />
        <Route path="/app/billing" element={<div>Billing page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function listCalls(): string[] {
  return femmeJson.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/service-records?"));
}

describe("ServiceRecordsPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    femmePutJson.mockReset();
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s.startsWith("/api/service-records?")) return Promise.resolve(pageOf(items));
      if (s === "/api/service-records/1") return Promise.resolve(detail);
      if (s === "/api/professionals") return Promise.resolve([{ id: 3, fullName: "Laura", active: true }]);
      if (s.startsWith("/api/clients/")) return Promise.resolve({ email: "marta@example.com" });
      return Promise.resolve([]);
    });
  });

  afterEach(() => cleanup());

  it("opens on 'Open' (pending to charge) and asks the API only for OPEN records", async () => {
    renderPage();
    await screen.findByText("Marta Benítez");
    expect(screen.getByTestId("service-records-chip-open").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(listCalls().some((u) => u.includes("status=OPEN"))).toBe(true));
  });

  it("each row shows client, services · professionals, total, and Charge only on open records", async () => {
    renderPage();
    const row = await screen.findByTestId("service-record-row-1");
    expect(within(row).getByText(/Coloración, Brushing · Laura, Ana/)).toBeTruthy();
    expect(within(row).getByText(/310\.000/)).toBeTruthy();
    expect(screen.getByTestId("service-record-pay-1")).toBeTruthy();
    expect(screen.queryByTestId("service-record-pay-2")).toBeNull();
    expect(within(screen.getByTestId("service-record-row-2")).getByTestId("service-record-state").textContent).toBe("Paid");
    expect(within(screen.getByTestId("service-record-row-3")).getByTestId("service-record-state").textContent).toBe("Voided");
  });

  it("Charge on a row opens Facturación with the record (without opening the record)", async () => {
    renderPage();
    await userEvent.click(await screen.findByTestId("service-record-pay-1"));
    expect(await screen.findByText("Billing page")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("chips switch between Open, Today and All", async () => {
    renderPage();
    await screen.findByText("Marta Benítez");
    await userEvent.click(screen.getByTestId("service-records-chip-all"));
    await waitFor(() => expect(listCalls().some((u) => !u.includes("status="))).toBe(true));
    expect(screen.getByTestId("service-records-chip-all").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("service-records-chip-open").getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(screen.getByTestId("service-records-chip-today"));
    expect(screen.getByTestId("service-records-chip-today").getAttribute("aria-pressed")).toBe("true");
  });

  it("date and status filters are folded behind 'Filters'", async () => {
    renderPage();
    await screen.findByText("Marta Benítez");
    expect(screen.queryByLabelText(/^from$/i)).toBeNull();
    const toggle = screen.getByTestId("service-records-filters-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(screen.getByLabelText(/^from$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^to$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^status$/i)).toBeTruthy();
    expect(screen.getByText(/up to 6 months back/i)).toBeTruthy();
  });

  it("shows a friendly empty state when nothing is open", async () => {
    femmeJson.mockImplementation((url: unknown) => {
      if (String(url).startsWith("/api/service-records?")) return Promise.resolve(pageOf([]));
      return Promise.resolve([]);
    });
    renderPage();
    expect(await screen.findByTestId("service-records-empty")).toBeTruthy();
    expect(screen.getByText(/everything is paid/i)).toBeTruthy();
  });

  it("'New record' opens the form dialog with Client and Services blocks", async () => {
    renderPage();
    await screen.findByText("Marta Benítez");
    await userEvent.click(screen.getByTestId("service-records-new"));
    const dialog = await screen.findByRole("dialog", { name: /new service record/i });
    expect(within(dialog).getByRole("heading", { name: /^client$/i })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: /^services$/i })).toBeTruthy();
    await userEvent.click(within(dialog).getByTestId("service-record-close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opening a row shows the record; saving closes the dialog and shows a toast on the list", async () => {
    femmePutJson.mockResolvedValue(detail);
    renderPage();
    await userEvent.click(await screen.findByTestId("service-record-row-1"));
    const dialog = await screen.findByRole("dialog");
    const pill = await within(dialog).findByTestId("service-record-status");
    expect(pill.getAttribute("data-status")).toBe("OPEN");
    expect(pill.textContent).toMatch(/Open/);
    await userEvent.click(within(dialog).getByTestId("service-record-submit"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByTestId("service-records-toast")).toBeTruthy();
  });

  it("returns from 'create client' with the client preselected and the form open", async () => {
    renderPage({
      activeTab: "new",
      selectedClient: { id: 9, fullName: "Nueva Clienta", phone: null, email: null, ruc: null },
    });
    const dialog = await screen.findByRole("dialog", { name: /new service record/i });
    await waitFor(() => expect(within(dialog).getByDisplayValue(/Nueva Clienta/)).toBeTruthy());
  });
});
