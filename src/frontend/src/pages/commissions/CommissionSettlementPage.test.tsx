import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import type { EntryView, SettlementDetail } from "../../api/commissions";
import CommissionSettlementPage from "./CommissionSettlementPage";

const api = vi.hoisted(() => ({ getSettlement: vi.fn() }));
vi.mock("../../api/commissions", async (orig) => ({ ...(await orig<typeof import("../../api/commissions")>()), ...api }));
vi.mock("../../api/femmeClient", () => ({ femmeJson: vi.fn(async () => []), femmePostJson: vi.fn(), femmePutJson: vi.fn() }));

const entry = (id: number, accrualAt: string, over: Partial<EntryView> = {}): EntryView =>
  ({
    id,
    professionalId: 1,
    professionalName: "Abril Benítez",
    sourceType: "INVOICE_LINE",
    revision: 1,
    reasonCode: null,
    invoiceId: 10,
    invoiceLineId: id,
    invoiceNumber: "0000013",
    itemName: "Spa de pies",
    itemKind: "SERVICE",
    baseType: "NET_OF_TAX",
    baseAmount: 118182,
    percentApplied: 40,
    commissionAmount: 47273,
    fixedAmount: 0,
    fixedToProfessional: false,
    retentionPercent: 0,
    retentionAmount: 0,
    accrualAt,
    reversesEntryId: null,
    settlementId: 17,
    settlementStatus: "DRAFT",
    reassignable: true,
    note: null,
    ...over,
  }) as EntryView;

const detail = (): SettlementDetail => ({
  settlement: {
    id: 17,
    professionalId: 1,
    professionalName: "Abril Benítez",
    periodFrom: "2026-11-01",
    periodTo: "2026-11-30",
    status: "DRAFT",
    totalAmount: 125909,
    retentionAmount: 0,
    fixedAmount: 0,
    createdAt: "2026-11-16T14:02:00Z",
    approvedAt: null,
    paidAt: null,
    paymentMethod: null,
    paymentReference: null,
    voidReason: null,
  },
  entries: [
    entry(1, "2026-11-05T15:00:00Z"),
    entry(2, "2026-11-14T15:00:00Z", { invoiceNumber: "0000026", itemName: "Spray fijador", itemKind: "PRODUCT", commissionAmount: 5909, percentApplied: 10 }),
    entry(5, "2026-11-16T14:00:00Z", { invoiceLineId: 50, invoiceNumber: "0000027", itemName: "Manicura simple", commissionAmount: 18182, reassignable: false }),
    entry(6, "2026-11-16T14:01:00Z", { invoiceLineId: 50, invoiceNumber: "0000027", itemName: "Manicura simple", commissionAmount: -18182, sourceType: "REVERSAL", reasonCode: "RECALCULATION", reassignable: false, reversesEntryId: 5 }),
    entry(7, "2026-11-16T14:02:00Z", { invoiceLineId: 50, invoiceNumber: "0000027", itemName: "Manicura simple", commissionAmount: 22727, percentApplied: 50, revision: 2 }),
  ],
  adjustments: [entry(8, "2026-11-16T16:00:00Z", { sourceType: "ADJUSTMENT", invoiceLineId: null, itemName: null, invoiceNumber: null, commissionAmount: 50000, note: "bono", reasonCode: "MANUAL_ADJUSTMENT" })],
  byItem: [],
  byKind: [],
  mixedBases: false,
  history: [{ fromStatus: null, toStatus: "DRAFT", changedAt: "2026-11-16T14:02:00Z", changedByEmail: "usuario@ejemplo.com" }],
});

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/app/commissions/settlements/17"]}>
          <Routes>
            <Route path="/app/commissions/settlements/:id" element={<CommissionSettlementPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("CommissionSettlementPage · HU-COM-32", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getSettlement.mockResolvedValue(detail());
  });
  afterEach(cleanup);

  it("shows the sum that makes the total: services + products + adjustments", async () => {
    renderPage();
    const comp = await screen.findByTestId("settlement-composition");
    expect(within(comp).getByTestId("settlement-comp-services").textContent).toContain("Servicios");
    expect(within(comp).getByTestId("settlement-comp-services").textContent).toContain("2 líneas");
    expect(within(comp).getByTestId("settlement-comp-services").textContent).toContain("70.000");
    expect(within(comp).getByTestId("settlement-comp-products").textContent).toContain("5.909");
    expect(within(comp).getByTestId("settlement-comp-adjustments").textContent).toContain("+");
    expect(screen.getByTestId("settlement-total").textContent).toContain("125.909");
  });

  it("tells the detail day by day, one row per sale, and the adjustment in its day", async () => {
    renderPage();
    const days = await screen.findAllByTestId("settlement-day");
    expect(days.map((d) => d.getAttribute("data-day"))).toEqual(["2026-11-05", "2026-11-14", "2026-11-16"]);
    const last = days[2];
    expect(within(last).getAllByTestId("settlement-line")).toHaveLength(1); // 3 entries, one sale
    expect(within(last).getAllByTestId("settlement-adjustment")).toHaveLength(1);
    expect(within(last).getByTestId("settlement-day-total").textContent).toContain("72.727"); // 22.727 + 50.000
  });

  it("opens the path of a recalculated sale and closes it", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findAllByTestId("settlement-line")).find((l) => l.getAttribute("data-changed") === "true")!;
    expect(within(row).getByTestId("settlement-line-tag").textContent).toBe("Recalculada");
    expect(within(row).getByTestId("settlement-line-amount").textContent).toContain("22.727");
    expect(within(row).queryByTestId("settlement-sale-changes")).toBeNull();
    const toggle = within(row).getByTestId("settlement-line-changes-toggle");
    expect(toggle.textContent).toContain("Ver cambios · 3 filas");
    await user.click(toggle);
    expect(within(row).getAllByTestId("settlement-sale-step")).toHaveLength(3);
    expect(within(row).getByTestId("settlement-sale-changes-net").textContent).toContain("22.727");
    await user.click(toggle);
    expect(within(row).queryByTestId("settlement-sale-changes")).toBeNull();
  });

  it("no longer has the subtotals by type and item", async () => {
    renderPage();
    await screen.findByTestId("settlement-composition");
    expect(screen.queryByTestId("settlement-subtotals-toggle")).toBeNull();
    expect(screen.getByTestId("settlement-adjustment-open")).toBeTruthy();
  });
});
