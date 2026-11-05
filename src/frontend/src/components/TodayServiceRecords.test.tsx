import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { TodayServiceRecords } from "./TodayServiceRecords";

const listServiceRecordsPaged = vi.fn();
const getServiceRecord = vi.fn();

vi.mock("../api/serviceRecords", () => ({
  listServiceRecordsPaged: (...a: unknown[]) => listServiceRecordsPaged(...a),
  getServiceRecord: (...a: unknown[]) => getServiceRecord(...a),
}));
vi.mock("../lib/serviceRecordBilling", () => ({ billServiceRecord: vi.fn() }));
vi.mock("./ServiceRecordDetailModal", () => ({
  ServiceRecordDetailModal: (p: { serviceRecordId: number; professionalMode?: boolean }) => (
    <div data-testid="detail-modal" data-pro={String(!!p.professionalMode)}>
      ficha {p.serviceRecordId}
    </div>
  ),
}));

const at = new Date().toISOString();
const admin = [
  { id: 1, clientId: 1, clientFullName: "ANA GÓMEZ", status: "CLOSED", totalAmount: "80000", createdAt: at, servicesSummary: "Color", professionalsSummary: "Laura" },
  { id: 2, clientId: 2, clientFullName: "MARÍA ROJAS", status: "OPEN", totalAmount: "45000", createdAt: at, servicesSummary: "Manicura, Pedicura", professionalsSummary: "Bea" },
];
const pro = [
  { id: 2, clientId: 2, clientFullName: "MARÍA ROJAS", status: "OPEN", totalAmount: null, createdAt: at, servicesSummary: "Manicura", professionalsSummary: "Bea" },
];

function renderIt(professionalMode = false, onNewRecord?: () => void) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <TodayServiceRecords professionalMode={professionalMode} onNewRecord={onNewRecord} />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe("TodayServiceRecords", () => {
  beforeEach(() => {
    i18n.changeLanguage("en");
    listServiceRecordsPaged.mockReset();
    getServiceRecord.mockReset();
  });
  afterEach(() => cleanup());

  it("admin: open cards come first, show the amount and a Charge button; paid ones are quieter", async () => {
    listServiceRecordsPaged.mockResolvedValue({ content: admin });
    renderIt();
    const cards = await screen.findAllByTestId("dashboard-service-record-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute("data-status")).toBe("OPEN");
    expect(cards[0].textContent).toContain("MARÍA ROJAS");
    expect(cards[0].textContent).toContain("Manicura");
    expect(cards[0].textContent).toContain("Pedicura");
    expect(cards[0].textContent).toContain("45.000");
    expect(screen.getByTestId("dashboard-service-record-pay-2")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-service-record-pay-1")).toBeNull();
    expect(cards[1].getAttribute("data-status")).toBe("CLOSED");
    expect(screen.getByTestId("dashboard-today-records-open-count").textContent).toContain("1 open");
  });

  it("a ficha of the generic occasional client shows the translated label, not the stored name", async () => {
    listServiceRecordsPaged.mockResolvedValue({
      content: [{ ...admin[0], clientFullName: "CLIENTE OCASIONAL", clientGeneric: true }],
    });
    renderIt();
    const card = await screen.findByTestId("dashboard-service-record-card");
    expect(card.textContent).toContain("Occasional client");
    expect(card.textContent).not.toContain("CLIENTE OCASIONAL");
  });

  it("admin: the list ends with a «New service record» row that opens the new-record flow", async () => {
    listServiceRecordsPaged.mockResolvedValue({ content: admin });
    const onNew = vi.fn();
    renderIt(false, onNew);
    await userEvent.click(await screen.findByTestId("dashboard-service-records-add-row"));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("admin: with no fichas the empty state offers «Create the first service record»", async () => {
    listServiceRecordsPaged.mockResolvedValue({ content: [] });
    const onNew = vi.fn();
    renderIt(false, onNew);
    await userEvent.click(await screen.findByTestId("dashboard-service-records-create-first"));
    expect(onNew).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("dashboard-service-records-add-row")).toBeNull();
  });

  it("without onNewRecord (professional) there is no add row nor create button", async () => {
    listServiceRecordsPaged.mockResolvedValue({ content: pro });
    renderIt(true);
    await screen.findByTestId("dashboard-service-record-card");
    expect(screen.queryByTestId("dashboard-service-records-add-row")).toBeNull();
  });

  it("admin: «View history» sits in the title row, next to the section title", async () => {
    listServiceRecordsPaged.mockResolvedValue({ content: pro });
    renderIt(false);
    await screen.findByTestId("dashboard-service-record-card");
    const link = screen.getByTestId("dashboard-service-records-history-link");
    expect(link.closest('[data-testid="section-title"]')).not.toBeNull();
    expect(link.textContent).toMatch(/View history/i);
  });

  it("professional: no amounts and no Charge; the card opens the ficha in professional mode", async () => {
    listServiceRecordsPaged.mockResolvedValue({ content: pro });
    renderIt(true);
    const card = await screen.findByTestId("dashboard-service-record-card");
    expect(card.textContent).toContain("MARÍA ROJAS");
    expect(card.textContent).not.toMatch(/Gs\.|\d\.\d{3}/);
    expect(screen.queryByTestId("dashboard-service-record-pay-2")).toBeNull();
    expect(screen.queryByText(/service record history|View history/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Open .*MARÍA ROJAS|MARÍA ROJAS/i }));
    await waitFor(() => expect(screen.getByTestId("detail-modal").getAttribute("data-pro")).toBe("true"));
  });

  it("professional: shows the empty state when nothing is open", async () => {
    listServiceRecordsPaged.mockResolvedValue({ content: [] });
    renderIt(true);
    const empty = await screen.findByTestId("dashboard-service-records-empty");
    expect(empty.textContent).toContain("no open service records today");
  });
});
