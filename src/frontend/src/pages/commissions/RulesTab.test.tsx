import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import type { RuleItem, RulesView } from "../../api/commissions";
import { RulesTab } from "./RulesTab";

const api = vi.hoisted(() => ({ getRulesView: vi.fn(), getItemRules: vi.fn(), getApplyModeOptions: vi.fn() }));
vi.mock("../../api/commissions", async (orig) => ({ ...(await orig<typeof import("../../api/commissions")>()), ...api }));
vi.mock("../../api/femmeClient", () => ({ femmeJson: vi.fn(async () => []), femmePostJson: vi.fn(), femmePutJson: vi.fn() }));

const item = (serviceId: number, name: string, over: Partial<RuleItem> = {}): RuleItem => ({
  serviceId,
  name,
  price: 100000,
  baseAmount: 100000,
  standardPercent: 0,
  ownStandard: false,
  inheritedPercent: 0,
  inheritedFrom: "GENERAL",
  inheritedGroupName: null,
  exceptions: [],
  scheduled: false,
  ...over,
});

const view = (items: RuleItem[]): RulesView => ({
  kind: "SERVICE",
  date: "2026-11-15",
  baseType: "TAX_INCLUDED",
  generalPercent: 0,
  itemCount: items.length,
  itemsWithExceptions: 0,
  professionals: [],
  categories: [{ categoryId: 1, name: "Manos", exceptions: 0, items }],
});

describe("HU-COM-20 · Excepciones por servicio: de dónde viene el % que paga cada servicio", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getRulesView.mockImplementation(async (kind: string) =>
      kind === "PRODUCT"
        ? { ...view([]), kind: "PRODUCT" }
        : view([
            // In a group that pays 50 %, without a % of its own: it pays the group's, not the general 0 %.
            item(1, "MANOS", { standardPercent: 50, inheritedPercent: 50, inheritedFrom: "GROUP", inheritedGroupName: "Manos y pies" }),
            // Its own 30 % (the group would pay 50 %).
            item(2, "PINTURA DE MANOS", { ownStandard: true, standardPercent: 30, inheritedPercent: 50, inheritedFrom: "GROUP", inheritedGroupName: "Manos y pies" }),
            // Without a group it pays the general %.
            item(3, "Baño de crema", { standardPercent: 10, inheritedPercent: 10, inheritedFrom: "GENERAL" }),
          ]),
    );
    api.getItemRules.mockResolvedValue({ versions: [] });
    api.getApplyModeOptions.mockResolvedValue({
      currentPeriod: { periodicity: "BIWEEKLY", from: "2026-11-01", to: "2026-11-15", nextFrom: "2026-11-16" },
      immediateFrom: "2026-11-14T12:00:00Z",
      nextPeriodFrom: "2026-11-16T00:00:00Z",
      periodStartFrom: "2026-11-01T00:00:00Z",
      availableModes: ["IMMEDIATE", "NEXT_PERIOD", "PERIOD_START"],
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mount = () =>
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <MemoryRouter>
            <RulesTab />
          </MemoryRouter>
        </ThemeProvider>
      </I18nextProvider>,
    );

  it("un servicio sin % propio muestra el del grupo (no el general) y dice «del grupo»", async () => {
    mount();
    const standard = await screen.findByTestId("rules-standard-1");
    expect(standard.textContent).toContain("50 %");
    expect(screen.getByTestId("rules-source-1").textContent).toBe("del grupo");
    expect(screen.getByTestId("rules-source-1").getAttribute("data-source")).toBe("GROUP");
    // With its own %, nothing is said about where it comes from.
    expect(screen.getByTestId("rules-standard-2").textContent).toBe("30 %");
    expect(screen.queryByTestId("rules-source-2")).toBeNull();
    // Without a group it still says «general».
    expect(screen.getByTestId("rules-standard-3").textContent).toContain("10 %");
    expect(screen.getByTestId("rules-source-3").textContent).toBe("general");
  });

  it("el panel del servicio dice de dónde hereda y, con % propio, ofrece volver al del grupo (no al general)", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("rules-row-1"));
    const panel = await screen.findByTestId("rules-panel");
    expect(within(panel).getByTestId("rules-panel-standard").textContent).toBe("50 %");
    expect(panel.textContent).toContain("Hereda el % del grupo Manos y pies (50 %)");
    cleanup();

    mount();
    await user.click(await screen.findByTestId("rules-row-2"));
    const own = await screen.findByTestId("rules-panel");
    expect(own.textContent).toContain("30 %");
    await user.click(within(own).getByTestId("rules-change-standard"));
    expect(within(own).getByText("Usar el % del grupo (50 %)")).toBeTruthy();
    expect(within(own).queryByText(/Usar la comisión general/)).toBeNull();
    await waitFor(() => expect(api.getRulesView).toHaveBeenCalled());
  });

  it("un servicio sin grupo hereda la comisión general, como antes", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("rules-row-3"));
    const panel = await screen.findByTestId("rules-panel");
    expect(panel.textContent).toContain("Hereda la comisión general (10 %)");
  });
});
