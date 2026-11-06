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

type Item = (typeof admin)[number];

/** A server that answers like the real one: open fichas, paid/voided ones paged, and the count of older open ones. */
function serverMock(opts: { open: Item[]; closed: Item[]; older?: number }) {
  listServiceRecordsPaged.mockImplementation(
    (p: { status?: string; size?: number; page?: number }) => {
      if (p.status === "OPEN" && p.size === 1) {
        return Promise.resolve({ content: [], totalElements: opts.older ?? 0 });
      }
      if (p.status === "OPEN") {
        return Promise.resolve({ content: opts.open, totalElements: opts.open.length });
      }
      if (p.status === "NOT_OPEN") {
        const size = p.size ?? 10;
        const start = (p.page ?? 0) * size;
        return Promise.resolve({
          content: opts.closed.slice(start, start + size),
          totalElements: opts.closed.length,
        });
      }
      return Promise.resolve({ content: [...opts.open, ...opts.closed] });
    },
  );
}

function closedItem(id: number, name: string, service = "Color"): Item {
  return {
    id,
    clientId: id,
    clientFullName: name,
    status: "CLOSED",
    totalAmount: "10000",
    createdAt: at,
    servicesSummary: service,
    professionalsSummary: "Laura",
  };
}

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

  it("admin: the open fichas are on view with the amount and a Charge button; paid ones are folded", async () => {
    serverMock({ open: [admin[1]], closed: [admin[0]] });
    renderIt();
    const cards = await screen.findAllByTestId("dashboard-service-record-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-status")).toBe("OPEN");
    expect(cards[0].textContent).toContain("MARÍA ROJAS");
    expect(cards[0].textContent).toContain("Manicura");
    expect(cards[0].textContent).toContain("Pedicura");
    expect(cards[0].textContent).toContain("45.000");
    expect(screen.getByTestId("dashboard-service-record-pay-2")).toBeTruthy();
    expect(screen.getByTestId("dashboard-today-records-open-count").textContent).toContain("1 open");
    // The paid one waits in the fold, with its count.
    expect(screen.getByTestId("dashboard-service-records-closed-count").textContent).toBe("1");
    expect(screen.queryByTestId("dashboard-service-record-invoice-1")).toBeNull();
    await userEvent.click(screen.getByTestId("dashboard-service-records-closed-toggle"));
    expect(await screen.findByTestId("dashboard-service-record-invoice-1")).toBeTruthy();
    expect(screen.getAllByTestId("dashboard-service-record-card")).toHaveLength(2);
  });

  it("paid and voided fichas come 12 at a time and «More (n)» asks the server for the next ones", async () => {
    const closed = Array.from({ length: 14 }, (_, k) => closedItem(100 + k, `CLIENTE ${k}`));
    serverMock({ open: [admin[1]], closed });
    renderIt();
    await screen.findByTestId("dashboard-service-records-closed-toggle");
    expect(screen.getByTestId("dashboard-service-records-closed-count").textContent).toBe("14");
    await userEvent.click(screen.getByTestId("dashboard-service-records-closed-toggle"));
    await waitFor(() => expect(screen.getAllByTestId("dashboard-service-record-card")).toHaveLength(13));
    const more = screen.getByTestId("dashboard-service-records-more");
    expect(more.textContent).toBe("More (2)");
    await userEvent.click(more);
    await waitFor(() => expect(screen.getAllByTestId("dashboard-service-record-card")).toHaveLength(15));
    expect(screen.queryByTestId("dashboard-service-records-more")).toBeNull();
    // The second page was asked for by number.
    expect(
      listServiceRecordsPaged.mock.calls.some(
        (c) => c[0].status === "NOT_OPEN" && c[0].page === 1 && c[0].size === 12,
      ),
    ).toBe(true);
  });

  it("«View history» carries a dot with the fichas of previous days that are still open", async () => {
    serverMock({ open: [admin[1]], closed: [], older: 3 });
    renderIt();
    const dot = await screen.findByTestId("dashboard-service-records-older-dot");
    expect(dot.textContent).toBe("3");
    const link = screen.getByTestId("dashboard-service-records-history-link");
    expect(link.getAttribute("aria-label")).toMatch(/3 service records from previous days are still open/i);
  });

  it("there is no dot when no ficha of a previous day is open", async () => {
    serverMock({ open: [admin[1]], closed: [], older: 0 });
    renderIt();
    await screen.findByTestId("dashboard-service-record-card");
    expect(screen.queryByTestId("dashboard-service-records-older-dot")).toBeNull();
  });

  it("the search filters by client or service, opens the paid list when something matches, and hides the dot", async () => {
    const closed = [closedItem(7, "LUCÍA GÓMEZ", "Brushing"), closedItem(8, "PEDRO LÓPEZ", "Corte")];
    serverMock({ open: [admin[1]], closed, older: 2 });
    renderIt();
    await screen.findByTestId("dashboard-service-records-older-dot");
    await userEvent.type(screen.getByLabelText(/filter list/i), "brush");
    // Only the paid «Brushing» one matches: its fold opens by itself.
    await waitFor(() => {
      const cards = screen.getAllByTestId("dashboard-service-record-card");
      expect(cards).toHaveLength(1);
      expect(cards[0].textContent).toContain("LUCÍA GÓMEZ");
    });
    expect(screen.getByTestId("dashboard-service-records-closed-count").textContent).toBe("1");
    expect(screen.queryByTestId("dashboard-service-records-older-dot")).toBeNull();
    await userEvent.clear(screen.getByLabelText(/filter list/i));
    await userEvent.type(screen.getByLabelText(/filter list/i), "zzz");
    expect(await screen.findByTestId("dashboard-service-records-no-matches")).toBeTruthy();
  });

  it("a ficha of the generic occasional client shows the translated label, not the stored name", async () => {
    serverMock({
      open: [{ ...admin[1], clientFullName: "CLIENTE OCASIONAL", clientGeneric: true } as Item],
      closed: [],
    });
    renderIt();
    const card = await screen.findByTestId("dashboard-service-record-card");
    expect(card.textContent).toContain("Occasional client");
    expect(card.textContent).not.toContain("CLIENTE OCASIONAL");
  });

  it("admin: the list ends with a «New service record» row that opens the new-record flow", async () => {
    serverMock({ open: [admin[1]], closed: [admin[0]] });
    const onNew = vi.fn();
    renderIt(false, onNew);
    await userEvent.click(await screen.findByTestId("dashboard-service-records-add-row"));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("admin: with no fichas the empty state offers «Create the first service record»", async () => {
    serverMock({ open: [], closed: [] });
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
    serverMock({ open: [admin[1]], closed: [] });
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
