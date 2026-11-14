import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "../test/renderWithTour";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ResumenPage from "./ResumenPage";

const femmeJson = vi.fn();
const listAppointments = vi.fn();
const getCurrentSession = vi.fn();
const getSessionDetail = vi.fn();
const listServiceRecordsPaged = vi.fn();
const getServiceRecord = vi.fn();
const listInvoicesPaged = vi.fn();
const billServiceRecord = vi.fn();
const navigate = vi.fn();
let sifenEnabled = true;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("../api/femmeClient", () => ({ femmeJson: (...a: unknown[]) => femmeJson(...a) }));
vi.mock("../api/appointments", () => ({ listAppointments: (...a: unknown[]) => listAppointments(...a) }));
vi.mock("../api/cashSessions", () => ({
  getCurrentSession: (...a: unknown[]) => getCurrentSession(...a),
  getSessionDetail: (...a: unknown[]) => getSessionDetail(...a),
}));
vi.mock("../api/serviceRecords", () => ({
  listServiceRecordsPaged: (...a: unknown[]) => listServiceRecordsPaged(...a),
  getServiceRecord: (...a: unknown[]) => getServiceRecord(...a),
}));
vi.mock("../api/invoices", () => ({ listInvoicesPaged: (...a: unknown[]) => listInvoicesPaged(...a) }));
vi.mock("../lib/serviceRecordBilling", () => ({ billServiceRecord: (...a: unknown[]) => billServiceRecord(...a) }));
vi.mock("../hooks/useFeatureFlags", () => ({ useFeatureFlag: () => sifenEnabled }));
vi.mock("../components/AppointmentFormModal", () => ({
  AppointmentFormModal: ({ open }: { open: boolean }) => (open ? <div role="dialog" data-testid="new-appointment-stub" /> : null),
}));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const appointments = [
  { id: 1, startAt: "2026-11-13T11:00:00Z", clientName: "Ana M.", serviceName: "Corte", status: "CONFIRMED" },
  { id: 2, startAt: "2026-11-13T13:30:00Z", clientName: "Laura G.", serviceName: "Color", status: "PENDING" },
  { id: 3, startAt: "2026-11-13T09:00:00Z", clientName: "Sofía R.", serviceName: "Peinado", status: "COMPLETED" },
  { id: 4, startAt: "2026-11-13T15:00:00Z", clientName: "Camila P.", serviceName: "Manicura", status: "CANCELLED" },
];

const openFichas = [
  { id: 11, clientId: 1, clientFullName: "Marta S.", status: "OPEN", totalAmount: "95000", createdAt: minutesAgo(25), servicesSummary: "Corte y peinado", professionalsSummary: "Ana" },
  { id: 12, clientId: 2, clientFullName: "Rocío A.", status: "OPEN", totalAmount: "180000", createdAt: minutesAgo(70), servicesSummary: "Color", professionalsSummary: "Laura" },
  { id: 13, clientId: 3, clientFullName: "Lucía F.", status: "OPEN", totalAmount: "120000", createdAt: minutesAgo(12), servicesSummary: "Manicura", professionalsSummary: "Julieta" },
  { id: 14, clientId: 4, clientFullName: "Pía D.", status: "OPEN", totalAmount: "30000", createdAt: minutesAgo(5), servicesSummary: "Cejas", professionalsSummary: "Ana" },
];

function paged<T>(content: T[], totalElements = content.length) {
  return { content, page: 0, size: 200, totalElements, totalPages: 1 };
}

function setup(over: { cash?: boolean; attention?: boolean; fiscalAlert?: boolean; failSummary?: boolean } = {}) {
  femmeJson.mockImplementation((url: string) => {
    if (url === "/api/dashboard") {
      if (over.failSummary) return Promise.reject(new Error("boom"));
      return Promise.resolve({
        appointmentsToday: { total: 18, pending: 3, confirmed: 15 },
        fiscalAlerts: over.fiscalAlert
          ? [{ severity: "warning", messageKey: "sifenVoidingPending", message: "You have document-number voidings pending submission to SIFEN." }]
          : [],
      });
    }
    return Promise.resolve(undefined);
  });
  listAppointments.mockResolvedValue(appointments);
  getCurrentSession.mockResolvedValue(over.cash === false ? undefined : { id: 7, isOpen: true });
  getSessionDetail.mockResolvedValue({
    id: 7,
    openedAt: "2026-11-13T11:02:00Z",
    paymentSummary: [
      { method: "CASH", total: "750000" },
      { method: "DEBIT_CARD", total: "300000" },
      { method: "CREDIT_CARD", total: "150000" },
      { method: "TRANSFER", total: "50000" },
    ],
  });
  listServiceRecordsPaged.mockImplementation((p: { status?: string; to?: string; size?: number }) => {
    if (p.status === "OPEN" && p.size === 200) return Promise.resolve(paged(openFichas));
    if (p.status === "CLOSED") return Promise.resolve(paged([], 9));
    if (p.status === "VOIDED") return Promise.resolve(paged([], 1));
    return Promise.resolve(paged([], 2)); // open from earlier days
  });
  listInvoicesPaged.mockResolvedValue(
    paged(
      [
        { id: 1, status: "ISSUED", sifenSubmissionStatus: "APPROVED", total: "50000", issuedAt: "2026-11-13T12:00:00Z" },
        { id: 2, status: "ISSUED", sifenSubmissionStatus: over.attention ? "REJECTED" : "APPROVED", total: "70000", issuedAt: "2026-11-13T12:10:00Z" },
      ],
      24,
    ),
  );
}

async function renderPage() {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter>
          <ResumenPage />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
  await screen.findByTestId("resumen-page");
}

describe("ResumenPage (HU-77)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    for (const m of [femmeJson, listAppointments, getCurrentSession, getSessionDetail, listServiceRecordsPaged, getServiceRecord, listInvoicesPaged, billServiceRecord, navigate]) m.mockReset();
    sifenEnabled = true;
  });

  it("shows a loading skeleton and, once everything arrived, the four cards at once", async () => {
    setup();
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <MemoryRouter>
            <ResumenPage />
          </MemoryRouter>
        </ThemeProvider>
      </I18nextProvider>,
    );
    expect(screen.getByTestId("resumen-loading")).toBeTruthy();
    await screen.findByTestId("resumen-page");
    expect(screen.queryByTestId("resumen-loading")).toBeNull();
    for (const id of ["resumen-appointments", "resumen-cash", "resumen-fichas", "resumen-invoices"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId("resumen-title").textContent).toBe("Hello, team!");
  });

  it("«Turnos de hoy»: counts from the summary and the next appointments (not completed or cancelled), by time", async () => {
    setup();
    await renderPage();
    expect(screen.getByTestId("resumen-appointments-total").textContent).toBe("18");
    expect(screen.getByTestId("resumen-appointments-pending").textContent).toBe("3 pending");
    expect(screen.getByTestId("resumen-appointments-confirmed").textContent).toBe("15 confirmed");
    const rows = screen.getAllByTestId("resumen-appointment");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/Ana M\./);
    expect(rows[1].textContent).toMatch(/Laura G\./);
    expect(screen.getByTestId("resumen-view-agenda").getAttribute("href")).toBe("/app/calendar");
  });

  it("«Caja del día»: the total and what came in by cash, card (debit + credit) and transfer", async () => {
    setup();
    await renderPage();
    expect(screen.getByTestId("resumen-cash-total").textContent).toMatch(/1\.250\.000/);
    expect(screen.getByTestId("resumen-cash-cash").textContent).toMatch(/750\.000/);
    expect(screen.getByTestId("resumen-cash-card").textContent).toMatch(/450\.000/);
    expect(screen.getByTestId("resumen-cash-transfer").textContent).toMatch(/50\.000/);
    expect(screen.queryByTestId("resumen-cash-other")).toBeNull();
    expect(screen.getByTestId("resumen-view-cash").textContent).toMatch(/Open since/);
  });

  it("«Caja del día» with no register open says so and points to Caja", async () => {
    setup({ cash: false });
    await renderPage();
    expect(screen.getByTestId("resumen-cash-closed").textContent).toBe("Cash register closed");
    expect(screen.getByTestId("resumen-view-cash").getAttribute("href")).toBe("/app/billing");
    expect(screen.queryByTestId("resumen-cash-total")).toBeNull();
  });

  it("«Fichas de hoy»: what is left to collect, the paid / open / voided counts and the longest-waiting open ones", async () => {
    setup();
    await renderPage();
    // 95.000 + 180.000 + 120.000 + 30.000
    expect(screen.getByTestId("resumen-fichas-to-collect").textContent).toMatch(/425\.000/);
    expect(screen.getByTestId("resumen-fichas-open-count").textContent).toBe("4 open records");
    const legend = screen.getByTestId("resumen-fichas-legend").textContent!;
    expect(legend).toMatch(/9\s*paid/);
    expect(legend).toMatch(/4\s*open/);
    expect(legend).toMatch(/1\s*voided/);
    const rows = screen.getAllByTestId("resumen-ficha");
    expect(rows).toHaveLength(3);
    // Oldest first: Rocío (70 min), Marta (25 min), Lucía (12 min).
    expect(rows[0].textContent).toMatch(/Rocío A\./);
    expect(rows[0].textContent).toMatch(/Color · Laura · 1 h 10 min ago/);
    expect(rows[1].textContent).toMatch(/Marta S\./);
    expect(rows[1].textContent).toMatch(/25 min ago/);
    expect(screen.getByTestId("resumen-fichas-more").textContent).toBe("and 1 more open record");
    expect(screen.getByTestId("resumen-fichas-older").textContent).toBe("2 open from previous days");
    expect(screen.getByTestId("resumen-fichas-view-all").getAttribute("href")).toBe("/app/service-records");
  });

  it("«Cobrar» opens the ficha's payment in Facturación", async () => {
    setup();
    const detail = { id: 12, clientId: 2, clientFullName: "Rocío A.", lines: [] };
    getServiceRecord.mockResolvedValue(detail);
    billServiceRecord.mockResolvedValue(undefined);
    await renderPage();
    fireEvent.click(screen.getByTestId("resumen-ficha-collect-12"));
    await waitFor(() => expect(billServiceRecord).toHaveBeenCalledTimes(1));
    expect(getServiceRecord).toHaveBeenCalledWith(12);
    expect(billServiceRecord.mock.calls[0][1]).toEqual(detail);
  });

  it("«Factura electrónica»: how many were issued today and that all are up to date", async () => {
    setup();
    await renderPage();
    expect(within(screen.getByTestId("resumen-invoices")).getByRole("heading").textContent).toBe("Electronic invoices");
    expect(screen.getByTestId("resumen-invoices-total").textContent).toBe("24");
    expect(screen.getByTestId("resumen-invoices-ok").textContent).toBe("All up to date");
  });

  it("«Factura electrónica» flags the invoices that need attention", async () => {
    setup({ attention: true });
    await renderPage();
    expect(screen.getByTestId("resumen-invoices-attention").textContent).toBe("1 needs attention");
    expect(screen.queryByTestId("resumen-invoices-ok")).toBeNull();
  });

  it("without electronic invoicing the card is just «Invoices» and has no state", async () => {
    sifenEnabled = false;
    setup();
    await renderPage();
    expect(within(screen.getByTestId("resumen-invoices")).getByRole("heading").textContent).toBe("Invoices");
    expect(screen.queryByTestId("resumen-invoices-ok")).toBeNull();
    expect(screen.queryByTestId("resumen-invoices-attention")).toBeNull();
  });

  it("«+ New appointment» opens the form and «+ New invoice» goes to a new invoice", async () => {
    setup();
    await renderPage();
    fireEvent.click(screen.getByTestId("resumen-new-appointment"));
    expect(await screen.findByTestId("new-appointment-stub")).toBeTruthy();
    fireEvent.click(screen.getByTestId("resumen-new-invoice"));
    expect(navigate).toHaveBeenCalledWith("/app/billing", { state: { activeTab: "invoice" } });
  });

  it("keeps showing a fiscal alert (closable), translated to the user's language", async () => {
    setup({ fiscalAlert: true });
    await i18n.changeLanguage("es");
    await renderPage();
    const alert = screen.getByTestId("resumen-fiscal-alert");
    // The server's English text is only a fallback: the message comes from the locale by its code.
    expect(alert.textContent).toMatch(/Tenés inutilizaciones de numeración pendientes/);
    expect(alert.textContent).not.toMatch(/You have document-number/);
    fireEvent.click(within(alert).getByRole("button"));
    expect(screen.queryByTestId("resumen-fiscal-alert")).toBeNull();
  });

  it("falls back to the server's text for an alert code it does not know", async () => {
    setup({ fiscalAlert: true });
    femmeJson.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/dashboard"
          ? {
              appointmentsToday: { total: 0, pending: 0, confirmed: 0 },
              fiscalAlerts: [{ severity: "warning", messageKey: "unknownCode", message: "Some new alert" }],
            }
          : undefined,
      ),
    );
    await renderPage();
    expect(screen.getByTestId("resumen-fiscal-alert").textContent).toMatch(/Some new alert/);
  });

  it("shows an error when the summary cannot be read", async () => {
    setup({ failSummary: true });
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <MemoryRouter>
            <ResumenPage />
          </MemoryRouter>
        </ThemeProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByTestId("resumen-error")).toBeTruthy();
  });
  it("everything the page says is in Spanish when the interface is in Spanish", async () => {
    setup({ attention: true });
    await i18n.changeLanguage("es");
    await renderPage();
    expect(screen.getByTestId("resumen-title").textContent).toBe("¡Hola, equipo!");
    expect(screen.getByTestId("resumen-subtitle").textContent).toMatch(/^Así va tu salón hoy · /);
    expect(screen.getByTestId("resumen-new-appointment").textContent).toBe("+ Nuevo turno");
    expect(screen.getByTestId("resumen-new-invoice").textContent).toBe("+ Nueva factura");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Turnos de hoy", "Caja del día", "Fichas de hoy", "Factura electrónica"]);
    expect(screen.getByTestId("resumen-appointments-pending").textContent).toBe("3 pendientes");
    expect(screen.getByTestId("resumen-appointments-confirmed").textContent).toBe("15 confirmados");
    expect(screen.getByTestId("resumen-view-agenda").textContent).toBe("Ver agenda →");
    expect(screen.getByTestId("resumen-view-cash").textContent).toMatch(/^Abierta desde las .* · Ver caja →$/);
    expect(screen.getByTestId("resumen-fichas-open-count").textContent).toBe("4 fichas abiertas");
    expect(screen.getByTestId("resumen-fichas-view-all").textContent).toBe("Ver todas →");
    expect(screen.getByTestId("resumen-fichas-legend").textContent).toMatch(/cobradas.*abiertas.*anulada/);
    expect(screen.getAllByTestId("resumen-ficha")[0].textContent).toMatch(/hace /);
    expect(screen.getByTestId("resumen-fichas-more").textContent).toBe("y 1 ficha abierta más");
    expect(screen.getByTestId("resumen-fichas-older").textContent).toBe("2 abiertas de días anteriores");
    expect(screen.getByTestId("resumen-invoices-attention").textContent).toBe("1 requiere atención");
    expect(screen.getByTestId("resumen-view-invoices").textContent).toBe("Ver comprobantes →");
    // No English left on the page (the data itself — names, services — is the user's).
    expect(screen.getByTestId("resumen-page").textContent).not.toMatch(
      /\b(Hello|team|pending|confirmed|Open agenda|Collect|open records?|issued|attention|ago|All up to date)\b/i,
    );
  });

  it("every fiscal alert code the server can send has a translation in both languages", () => {
    // Keep in sync with `DashboardService` (the `messageKey` of each `FiscalAlert`).
    const codes = [
      "businessRucMissing",
      "fiscalNoActiveStamp",
      "fiscalExpiredOrExhausted",
      "fiscalExpiringSoon",
      "fiscalLowRange",
      "sifenVoidingPending",
      "sifenVoidingOverdue",
    ];
    for (const lng of ["es", "en"]) {
      for (const code of codes) {
        expect(i18n.exists(`femme.dashboard.alerts.${code}`, { lng }), `${lng}: ${code}`).toBe(true);
      }
    }
  });

});
