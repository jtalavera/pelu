import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import {
  ClientSummaryLists,
  ClientSummaryStats,
  useClientSummary,
  type ClientSummary,
} from "./ClientSummary";

function SummaryHarness() {
  const state = useClientSummary(7);
  return (
    <>
      <ClientSummaryStats {...state} />
      <ClientSummaryLists {...state} />
    </>
  );
}

const femmeJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
}));

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <SummaryHarness />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("ClientSummary (HU-67 / HU-70)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    femmeJson.mockReset();
  });
  afterEach(() => cleanup());

  it("shows empty states when the client has no history", async () => {
    femmeJson.mockResolvedValue({
      usualProfessionals: [],
      lastVisitAt: null,
      spentLast12Months: null,
      averageTicketLast12Months: null,
      lastServices: [],
      lastProducts: [],
    } satisfies ClientSummary);
    renderCard();
    expect(await screen.findByText("Sin servicios en los últimos 12 meses")).toBeTruthy();
    expect(screen.getByText("Sin visitas")).toBeTruthy();
    expect(screen.getByText("Todavía no tiene servicios realizados")).toBeTruthy();
    expect(screen.getByText("Todavía no compró productos")).toBeTruthy();
    // One request feeds both the stats strip and the lists.
    expect(femmeJson).toHaveBeenCalledTimes(1);
    expect(femmeJson).toHaveBeenCalledWith("/api/clients/7/summary");
  });

  it("lists tied usual professionals, inactive label, services and products", async () => {
    femmeJson.mockResolvedValue({
      usualProfessionals: [
        { id: 1, fullName: "ANA", active: false, serviceCount: 2 },
        { id: 2, fullName: "ZOE", active: true, serviceCount: 2 },
      ],
      lastVisitAt: "2026-10-01T15:00:00Z",
      spentLast12Months: 300000,
      averageTicketLast12Months: 150000,
      lastServices: [
        {
          performedAt: "2026-10-01T15:00:00Z",
          serviceName: "Corte",
          professionalId: 2,
          professionalName: "ZOE",
          price: 100000,
        },
      ],
      lastProducts: [
        {
          purchasedAt: "2026-10-01T15:00:00Z",
          productName: "Shampoo",
          quantity: 2,
          unitPrice: 50000,
        },
      ],
    } satisfies ClientSummary);
    renderCard();
    const usual = await screen.findByTestId("client-summary-usual");
    expect(within(usual).getByText("ANA (inactiva) · 2 servicios")).toBeTruthy();
    expect(within(usual).getByText("ZOE · 2 servicios")).toBeTruthy();
    expect(within(screen.getByTestId("client-summary-services")).getByText("Corte")).toBeTruthy();
    expect(within(screen.getByTestId("client-summary-products")).getByText("Shampoo")).toBeTruthy();
  });
});
