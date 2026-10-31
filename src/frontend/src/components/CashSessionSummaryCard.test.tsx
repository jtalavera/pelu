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

  it("opening data is folded until opened", async () => {
    renderCard(base);
    expect(screen.queryByText("isabel@example.com", { selector: "span.min-w-0" })).toBeNull();
    await userEvent.click(screen.getByTestId("cash-section-data"));
    expect(within(screen.getByTestId("cash-session-summary")).getAllByText("Gs. 100.000").length).toBeGreaterThan(0);
  });
});
