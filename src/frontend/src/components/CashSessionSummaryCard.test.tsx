import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { CashSessionSummaryCard } from "./CashSessionSummaryCard";
import type { CashSessionDetail } from "../api/cashSessions";

const base: CashSessionDetail = {
  id: 1,
  tenantId: 1,
  openedAt: "2026-10-30T18:08:00Z",
  openedByEmail: "isabel@example.com",
  closedAt: null,
  closedByEmail: null,
  openingCashAmount: "100000",
  countedCashAmount: null,
  expectedCashAmount: "-6000",
  cashDifference: null,
  totalInvoiced: "100000",
  invoiceCount: 6,
  paymentSummary: [{ method: "CASH", total: "100000" }],
  isOpen: true,
  movements: [
    { id: 1, cashSessionId: 1, type: "MANUAL_OUT", amount: "10000", reason: "Pago de almuerzo", createdByEmail: "isabel@example.com", createdAt: "2026-10-30T21:24:00Z", tipWithdrawalId: null },
    { id: 2, cashSessionId: 1, type: "MANUAL_IN", amount: "10000", reason: "propina", createdByEmail: "isabel@example.com", createdAt: "2026-10-30T21:25:00Z", tipWithdrawalId: null },
    { id: 3, cashSessionId: 1, type: "TIP_WITHDRAWAL_OUT", amount: "6000", reason: null, createdByEmail: "isabel@example.com", createdAt: "2026-10-31T16:48:00Z", tipWithdrawalId: 4 },
  ],
};

function renderCard(detail: CashSessionDetail) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <CashSessionSummaryCard detail={detail} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("CashSessionSummaryCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(() => cleanup());

  it("shows cash out and tip withdrawals as negative amounts, cash in as positive", () => {
    renderCard(base);
    const amounts = screen.getAllByTestId("cash-movement-amount").map((e) => e.textContent);
    expect(amounts).toEqual(["−Gs. 10.000", "+Gs. 10.000", "−Gs. 6.000"]);
  });

  it("an open session leads with the live expected cash, negative in red", () => {
    renderCard(base);
    const expected = screen.getByTestId("cash-summary-expected-cash");
    expect(expected.textContent).toBe("−Gs. 6.000");
    expect(expected.className).toMatch(/text-danger/);
  });

  it("a closed session shows expected, counted and difference", () => {
    renderCard({
      ...base,
      isOpen: false,
      closedAt: "2026-10-31T22:02:00Z",
      closedByEmail: "isabel@example.com",
      expectedCashAmount: "94000",
      countedCashAmount: "90000",
      cashDifference: "-4000",
    });
    expect(screen.getByTestId("cash-summary-expected-cash").textContent).toBe("Gs. 94.000");
    expect(screen.getByText("Gs. 90.000")).toBeTruthy();
    expect(screen.getByText("−Gs. 4.000").className).toMatch(/text-danger/);
  });

  describe("tips left after the invoice was issued (HU-73)", () => {
    const withTips: CashSessionDetail = {
      ...base,
      expectedCashAmount: "20000",
      paymentSummary: [
        { method: "CASH", total: "110000" },
        { method: "DEBIT_CARD", total: "5000" },
      ],
      lateTips: [
        {
          id: 1,
          professionalName: "Laura Benítez",
          invoiceNumberFormatted: "0000126",
          amount: "10000",
          paymentMethod: "CASH",
          cardBrand: null,
          createdAt: "2026-10-30T21:30:00Z",
          createdByEmail: "ana@demo.com",
          voided: false,
          voidReason: null,
          voidedByEmail: null,
        },
        {
          id: 2,
          professionalName: "Camila Ortiz",
          invoiceNumberFormatted: "0000126",
          amount: "5000",
          paymentMethod: "DEBIT_CARD",
          cardBrand: "VISA",
          createdAt: "2026-10-30T21:31:00Z",
          createdByEmail: "ana@demo.com",
          voided: false,
          voidReason: null,
          voidedByEmail: null,
        },
        {
          id: 3,
          professionalName: "Laura Benítez",
          invoiceNumberFormatted: "0000126",
          amount: "1000",
          paymentMethod: "CASH",
          cardBrand: null,
          createdAt: "2026-10-30T21:20:00Z",
          createdByEmail: "ana@demo.com",
          voided: true,
          voidReason: "Monto mal cargado",
          voidedByEmail: "admin@demo.com",
        },
      ],
    };

    it("lists them among the movements, oldest first, counting them", () => {
      renderCard(withTips);
      const rows = screen.getAllByTestId(/^cash-(movement|late-tip)-row$/);
      // 3 movements + 3 late tips, ordered by time: the voided tip (21:20) comes before the 21:24 movement.
      expect(rows).toHaveLength(6);
      expect(rows[0].getAttribute("data-testid")).toBe("cash-late-tip-row");
      expect(rows[0].getAttribute("data-voided")).toBe("true");
      expect(screen.getByTestId("cash-section-movements").textContent).toMatch(/6/);
    });

    it("shows the tip, who it is for, the invoice and how it was paid; only cash shows a «+»", () => {
      renderCard(withTips);
      const tipRows = screen.getAllByTestId("cash-late-tip-row");
      const cash = tipRows.find((r) => r.getAttribute("data-voided") === "false" && /Cash/.test(r.textContent ?? ""))!;
      expect(cash.textContent).toMatch(/Tip collected · Laura Benítez · #0000126/);
      expect(within(cash).getByTestId("cash-late-tip-amount").textContent).toBe("+Gs. 10.000");
      const card = tipRows.find((r) => /Debit card/.test(r.textContent ?? ""))!;
      expect(card.textContent).toMatch(/Debit card · Visa/);
      expect(within(card).getByTestId("cash-late-tip-amount").textContent).toBe("Gs. 5.000");
    });

    it("strikes through a voided tip, says why, and gives it no sign", () => {
      renderCard(withTips);
      const voided = screen.getAllByTestId("cash-late-tip-row").find((r) => r.getAttribute("data-voided") === "true")!;
      expect(voided.textContent).toMatch(/Tip voided · Laura Benítez/);
      expect(voided.textContent).toMatch(/«Monto mal cargado»/);
      const amount = within(voided).getByTestId("cash-late-tip-amount");
      expect(amount.className).toMatch(/line-through/);
      expect(amount.textContent).toBe("Gs. 1.000");
    });

    it("tells how much of each method total are late tips, leaving voided ones out", async () => {
      renderCard(withTips);
      await userEvent.click(screen.getByTestId("cash-section-methods"));
      expect(screen.getByTestId("cash-late-tips-note").textContent).toBe(
        "They include the tips collected after issuing: cash Gs. 10.000, debit card Gs. 5.000.",
      );
    });

    it("shows no note when there are no (live) late tips", async () => {
      renderCard({ ...withTips, lateTips: [withTips.lateTips![2]] });
      await userEvent.click(screen.getByTestId("cash-section-methods"));
      expect(screen.queryByTestId("cash-late-tips-note")).toBeNull();
    });
  });

  it("opening data is folded until opened", async () => {
    renderCard(base);
    expect(screen.queryByText("isabel@example.com", { selector: "span.min-w-0" })).toBeNull();
    await userEvent.click(screen.getByTestId("cash-section-data"));
    expect(within(screen.getByTestId("cash-session-summary")).getAllByText("Gs. 100.000").length).toBeGreaterThan(0);
  });
});
