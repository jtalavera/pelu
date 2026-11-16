import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import { OverviewContext } from "./overview";
import type { Overview, RateItem, RatesView } from "../../api/commissions";
import { RatesPage } from "./RatesPage";

const api = vi.hoisted(() => ({
  getRates: vi.fn(),
  getApplyModeOptions: vi.fn(),
}));
vi.mock("../../api/commissions", async (orig) => ({ ...(await orig<typeof import("../../api/commissions")>()), ...api }));
vi.mock("../../api/femmeClient", () => ({ femmeJson: vi.fn(async () => []), femmePostJson: vi.fn(), femmePutJson: vi.fn() }));

const item = (serviceId: number, name: string, over: Partial<RateItem> = {}): RateItem => ({
  serviceId,
  name,
  kind: "SERVICE",
  ownPercent: null,
  ownFixedAmount: null,
  ownFixedDestination: null,
  normalPercent: 40,
  normalFixedAmount: 0,
  normalFixedDestination: "PROFESSIONAL",
  source: "GROUP",
  scheduled: false,
  exceptions: [],
  ...over,
});

const rates: RatesView = {
  date: "2026-11-15",
  baseType: "TAX_INCLUDED",
  generalServicePercent: 10,
  generalProductPercent: 5,
  defaultFixedDestination: "PROFESSIONAL",
  groups: [
    {
      id: 1,
      name: "Alisado",
      percent: 40,
      fixedAmount: null,
      fixedDestination: null,
      scheduled: false,
      items: [
        item(1, "ALISADO PELO MEDIANO"),
        item(2, "ALISADO PELO LARGO", {
          ownPercent: 30,
          normalPercent: 30,
          source: "SERVICE",
          exceptions: [{ professionalId: 7, professionalName: "Gaby", percent: 50, fixedAmount: 0, fixedDestination: null, scheduled: false }],
        }),
      ],
    },
    { id: 2, name: "Manos y pies", percent: null, fixedAmount: null, fixedDestination: null, scheduled: false, items: [item(3, "MANICURA", { normalPercent: 10, source: "GENERAL" })] },
  ],
  ungrouped: [item(4, "Baño de crema", { normalPercent: 10, source: "GENERAL" }), item(5, "SHAMPOO", { kind: "PRODUCT", normalPercent: 5, source: "GENERAL" })],
};

const overview = { groupCount: 2, groupsWithoutPercent: 1, aguinaldoEnabled: false } as unknown as Overview;

const mount = (initial = "/app/commissions/configurar/comisiones") =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <OverviewContext.Provider value={{ overview, error: null, refresh: async () => {} }}>
          <MemoryRouter initialEntries={[initial]}>
            <Routes>
              <Route path="/app/commissions/configurar/comisiones" element={<RatesPage />} />
            </Routes>
          </MemoryRouter>
        </OverviewContext.Provider>
      </ThemeProvider>
    </I18nextProvider>,
  );

const applyText = async () => (await screen.findByTestId("commission-apply-dialog")).closest('[role="dialog"]')?.textContent ?? "";
const group = (name: string) => screen.getAllByTestId("rates-group").find((g) => g.dataset.groupName === name)!;

describe("HU-COM-20 · Configurar › Comisiones", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getRates.mockResolvedValue(rates);
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

  it("lista el % general, cada grupo con su % (o «Sin %») y lo que no tiene grupo", async () => {
    mount();
    expect((await screen.findByTestId("rates-general-SERVICE-percent")).textContent).toBe("10 %");
    expect(screen.getByTestId("rates-general-PRODUCT-percent").textContent).toBe("5 %");
    expect(within(group("Alisado")).getByTestId("rates-group-percent").textContent).toBe("40 %");
    expect(within(group("Alisado")).getByTestId("rates-group-edit").textContent).toBe("Cambiar");
    // A group without its % says so and puts the primary button on it.
    expect(within(group("Manos y pies")).getByTestId("rates-group-percent").textContent).toBe("Sin %");
    expect(within(group("Manos y pies")).getByTestId("rates-group-edit").textContent).toBe("Poner %");
    expect(screen.getByTestId("rates-ungrouped-help").textContent).toBe("2 servicios · pagan el % general (10 %)");
    expect(screen.getByTestId("rates-order-link").getAttribute("href")).toBe("/app/commissions/configurar/grupos?group=none");
  });

  it("al abrir un grupo cada servicio dice si paga el del grupo o uno propio, y quién cobra distinto", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("rates-general-SERVICE");
    expect(screen.queryAllByTestId("rates-item")).toHaveLength(0);
    await user.click(within(group("Alisado")).getByTestId("rates-group-toggle"));
    const rows = screen.getAllByTestId("rates-item");
    expect(rows.map((r) => r.dataset.itemName)).toEqual(["ALISADO PELO MEDIANO", "ALISADO PELO LARGO"]);
    expect(rows[0].dataset.source).toBe("GROUP");
    expect(within(rows[0]).getByTestId("rates-item-percent").textContent).toContain("40 %");
    expect(within(rows[0]).getByTestId("rates-item-percent").textContent).toContain("del grupo");
    expect(within(rows[0]).getByTestId("rates-item-own").textContent).toBe("Poner un % propio");
    expect(rows[1].dataset.source).toBe("SERVICE");
    expect(within(rows[1]).getByTestId("rates-item-percent").textContent).toContain("propio");
    expect(within(rows[1]).getByTestId("rates-item-exceptions").textContent).toBe("1 profesional cobra distinto: Gaby 50 %");
    expect(within(rows[1]).getByTestId("rates-item-edit")).toBeTruthy();
    expect(within(rows[1]).getByTestId("rates-item-remove")).toBeTruthy();
  });

  it("cambiar el % de un grupo valida, y al guardar pide desde cuándo aplica", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(await screen.findByTestId("rates-general-SERVICE").then(() => group("Alisado"))).findByTestId("rates-group-edit"));
    const input = await screen.findByTestId("rates-percent");
    expect((input as HTMLInputElement).value).toBe("40");
    await user.clear(input);
    await user.type(input, "150");
    await user.click(screen.getByTestId("rates-save"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/entre 0 y 100/);
    expect(screen.queryByTestId("commission-apply-dialog")).toBeNull();
    await user.clear(input);
    await user.type(input, "45");
    await user.click(screen.getByTestId("rates-save"));
    expect(await applyText()).toContain("Comisión del grupo Alisado: 45 %");
  });

  it("un servicio puede tener su % propio, con el costo de producto en «Más opciones»", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(await screen.findByTestId("rates-general-SERVICE").then(() => group("Alisado"))).findByTestId("rates-group-toggle"));
    await user.click(within(screen.getAllByTestId("rates-item")[0]).getByTestId("rates-item-own"));
    // It starts from what it pays now, so only what differs is changed.
    const input = await screen.findByTestId("rates-percent");
    expect((input as HTMLInputElement).value).toBe("40");
    await user.clear(input);
    await user.type(input, "35");
    await user.click(screen.getByTestId("rates-more-toggle"));
    await user.type(screen.getByTestId("rates-fixed"), "3000");
    await user.selectOptions(screen.getByTestId("rates-destination"), "SALON");
    await user.click(screen.getByTestId("rates-save"));
    expect(await applyText()).toContain("Comisión de ALISADO PELO MEDIANO: 35 %");
  });

  it("quitar el % propio de un servicio pide desde cuándo y dice que vuelve al del grupo", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(await screen.findByTestId("rates-general-SERVICE").then(() => group("Alisado"))).findByTestId("rates-group-toggle"));
    await user.click(within(screen.getAllByTestId("rates-item")[1]).getByTestId("rates-item-remove"));
    expect(await applyText()).toContain("vuelve a pagar el de su grupo");
  });

  it("el % general de servicios y de productos se cambia ahí mismo", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("rates-general-PRODUCT-edit"));
    const input = await screen.findByTestId("rates-percent");
    await user.clear(input);
    await user.type(input, "8");
    // The general % has no product cost.
    expect(screen.queryByTestId("rates-more-toggle")).toBeNull();
    await user.click(screen.getByTestId("rates-save"));
    expect(await applyText()).toContain("Nuevo % general de productos: 8 %");
  });

  it("el buscador abre los grupos donde está lo buscado y oculta el resto", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("rates-general-SERVICE");
    await user.type(screen.getByTestId("rates-search"), "largo");
    expect(screen.getAllByTestId("rates-group")).toHaveLength(1);
    expect(screen.getAllByTestId("rates-item").map((r) => r.dataset.itemName)).toEqual(["ALISADO PELO LARGO"]);
    await user.clear(screen.getByTestId("rates-search"));
    await user.type(screen.getByTestId("rates-search"), "baño");
    expect(screen.queryAllByTestId("rates-group")).toHaveLength(0);
    expect(screen.getAllByTestId("rates-item").map((r) => r.dataset.itemName)).toEqual(["Baño de crema"]);
  });

  it("?q= abre la pantalla ya buscando el grupo", async () => {
    mount("/app/commissions/configurar/comisiones?q=manos");
    expect((await screen.findAllByTestId("rates-group")).map((g) => g.dataset.groupName)).toEqual(["Manos y pies"]);
  });

  it("si lo buscado es el nombre de un grupo se ven todos sus servicios (no «sin servicios»), y «Sin grupo» no aparece si nada de lo que no tiene grupo coincide", async () => {
    mount("/app/commissions/configurar/comisiones?q=manos%20y%20pies");
    expect(await screen.findAllByTestId("rates-group")).toHaveLength(1);
    expect(screen.getByTestId("rates-group-items").textContent).not.toContain("todavía no tiene servicios");
    expect(screen.getAllByTestId("rates-item").map((r) => r.dataset.itemName)).toEqual(["MANICURA"]);
    expect(screen.queryByTestId("rates-ungrouped")).toBeNull();
  });

  it("si lo buscado es un servicio, el grupo muestra solo los que coinciden y «Sin grupo» aparece si hay uno que coincide", async () => {
    mount("/app/commissions/configurar/comisiones?q=ba%C3%B1o");
    await screen.findByTestId("rates-ungrouped");
    expect(screen.queryAllByTestId("rates-group")).toHaveLength(0);
    expect(screen.getAllByTestId("rates-item").map((r) => r.dataset.itemName)).toEqual(["Baño de crema"]);
  });
});
