import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import { OverviewContext } from "./overview";
import type { Overview } from "../../api/commissions";
import { ConfigPage, GroupsPage } from "./ConfigPages";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getGroups: vi.fn(),
  getGroupServices: vi.fn(),
  getRulesView: vi.fn(),
}));
vi.mock("../../api/commissions", async (orig) => ({ ...(await orig<typeof import("../../api/commissions")>()), ...api }));
vi.mock("../../api/femmeClient", () => ({ femmeJson: vi.fn(async () => []), femmePostJson: vi.fn(), femmePutJson: vi.fn() }));

const overview = {
  groupsWithoutPercent: 1,
  groupCount: 2,
  ungroupedServices: 1,
  rows: [{}, {}],
  aguinaldoEnabled: false,
  professionalsRetaining: 0,
} as unknown as Overview;
/** Every group has its %: only the aguinaldo step can still be pending. */
const allSet = { ...overview, groupsWithoutPercent: 0, ungroupedServices: 0 } as Overview;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const mount = (initial: string, ov: Overview = overview) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <OverviewContext.Provider value={{ overview: ov, error: null, refresh: async () => {} }}>
          <MemoryRouter initialEntries={[initial]}>
            <Where />
            <Routes>
              <Route path="/app/commissions/configurar" element={<ConfigPage />} />
              <Route path="/app/commissions/configurar/grupos" element={<GroupsPage />} />
            </Routes>
          </MemoryRouter>
        </OverviewContext.Provider>
      </ThemeProvider>
    </I18nextProvider>,
  );

const svc = (serviceId: number, groupId: number | null) => ({
  serviceId,
  name: `Servicio ${serviceId}`,
  categoryName: null,
  price: null,
  groupId,
  groupName: groupId ? "Color" : null,
  suggestion: null,
});

describe("HU-COM-16 · Configurar", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getSettings.mockResolvedValue({
      base: "TAX_INCLUDED",
      defaultPercentService: 10,
      defaultPercentProduct: 5,
      periodicity: "BIWEEKLY",
      currentPeriod: { periodicity: "BIWEEKLY", from: "2026-11-01", to: "2026-11-15", nextFrom: "2026-11-16" },
      scheduledChanges: [],
      history: [],
      fixedDestination: "PROFESSIONAL",
      aguinaldoEnabled: false,
      aguinaldoDefaultPercent: 0,
      retentionProfiles: [],
    });
    api.getGroups.mockResolvedValue([
      { id: 1, name: "Color", serviceCount: 3, serviceNames: [], percent: 40 },
      { id: 2, name: "Manos", serviceCount: 1, serviceNames: [], percent: null },
    ]);
    api.getGroupServices.mockImplementation(async (kind: string) =>
      kind === "PRODUCT" ? [] : [svc(1, 1), svc(2, 1), svc(3, 1), svc(4, 2), svc(5, null)],
    );
    api.getRulesView.mockResolvedValue({ kind: "SERVICE", date: "2026-11-15", baseType: "TAX_INCLUDED", generalPercent: 10, itemCount: 0, itemsWithExceptions: 0, professionals: [], categories: [] });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("cada paso muestra su estado: ✓ o número, resumen de una línea y qué falta", async () => {
    mount("/app/commissions/configurar");
    await screen.findAllByTestId("config-group-chip");
    const step = (n: number) => screen.getByTestId(`config-step-${n}`);
    expect(step(1).dataset.tone).toBe("done");
    expect(screen.getByTestId("config-step-1-badge").textContent).toBe("✓");
    expect(screen.getByTestId("config-step-1-summary").textContent).toBe("Con IVA · liquidación quincenal");
    expect(screen.getByTestId("config-step-1-pill").textContent).toBe("Al día");
    // Step 2: what each group pays. A group without its % is the only thing that is pending.
    expect(step(2).dataset.tone).toBe("pending");
    expect(screen.getByTestId("config-step-2-badge").textContent).toBe("2");
    expect(screen.getByTestId("config-step-2-summary").textContent).toBe("2 grupos · 1 con su %");
    expect(screen.getByTestId("config-step-2-pill").textContent).toBe("1 grupo sin %");
    // Step 3 is aguinaldo (there is no step «rules per professional» any more).
    expect(step(3).dataset.tone).toBe("optional");
    expect(screen.getByTestId("config-step-3-badge").textContent).toBe("3");
    expect(screen.getByTestId("config-step-3-pill").textContent).toBe("Opcional");
    expect(screen.getByTestId("config-step-3-summary").textContent).toBe("Retención desactivada · el costo de producto va para la profesional");
    expect(screen.queryByTestId("config-step-4")).toBeNull();
    expect(screen.getAllByTestId("config-group-chip").map((c) => c.textContent)).toEqual(["Color 40 %", "Manos Sin %"]);
    expect(screen.getAllByTestId("config-group-chip").map((c) => c.dataset.missing)).toEqual(["false", "true"]);
  });

  it("se abre solo el primer paso pendiente y cada paso se abre y se cierra a mano", async () => {
    mount("/app/commissions/configurar");
    await screen.findAllByTestId("config-group-chip");
    const open = (n: number) => screen.getByTestId(`config-step-${n}-toggle`).getAttribute("aria-expanded");
    expect([1, 2, 3].map(open)).toEqual(["false", "true", "false"]);
    expect(screen.queryByTestId("commission-setting-BASE")).toBeNull();
    await userEvent.click(screen.getByTestId("config-step-1-toggle"));
    // Step 1 is only the base and how often it is settled: the % live in «Comisiones».
    expect(screen.getByTestId("commission-setting-BASE")).toBeTruthy();
    expect(screen.getByTestId("commission-setting-PERIODICITY")).toBeTruthy();
    expect(screen.queryByTestId("commission-setting-DEFAULT_SERVICE")).toBeNull();
    await userEvent.click(screen.getByTestId("config-step-3-toggle"));
    expect(screen.getByTestId("commission-setting-AGUINALDO_ENABLED")).toBeTruthy();
    await userEvent.click(screen.getByTestId("config-step-2-toggle"));
    expect(open(2)).toBe("false");
    expect(screen.queryByTestId("config-group-chip")).toBeNull();
  });

  it("paso 3: gris si el aguinaldo está apagado, ámbar si nadie retiene y verde si alguien retiene", async () => {
    const on = {
      base: "TAX_INCLUDED",
      defaultPercentService: 10,
      defaultPercentProduct: 5,
      periodicity: "BIWEEKLY",
      currentPeriod: { periodicity: "BIWEEKLY", from: "2026-11-01", to: "2026-11-15", nextFrom: "2026-11-16" },
      scheduledChanges: [],
      history: [],
      fixedDestination: "SALON",
      aguinaldoEnabled: true,
      aguinaldoDefaultPercent: 5,
    };
    const profile = (id: number, percent: number | null) => ({ professionalId: id, professionalName: `P${id}`, active: true, percent });
    api.getSettings.mockResolvedValue({ ...on, retentionProfiles: [profile(1, null), profile(2, null)] });
    mount("/app/commissions/configurar", allSet);
    await screen.findByTestId("config-step-3-pill");
    expect(screen.getByTestId("config-step-3").dataset.tone).toBe("pending");
    expect(screen.getByTestId("config-step-3-badge").textContent).toBe("3");
    expect(screen.getByTestId("config-step-3-pill").textContent).toBe("Nadie retiene todavía");
    expect(screen.getByTestId("config-step-3-summary").textContent).toBe("Retención activada · ninguna profesional tiene retención cargada");
    // It is the only pending step, so it opens by itself, with the retention of each professional.
    expect(screen.getByTestId("config-step-3-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByTestId("commission-retention-row")).toHaveLength(2);
    cleanup();
    api.getSettings.mockResolvedValue({ ...on, retentionProfiles: [profile(1, 5), profile(2, null)] });
    mount("/app/commissions/configurar", allSet);
    await screen.findByTestId("config-step-3-pill");
    expect(screen.getByTestId("config-step-3").dataset.tone).toBe("done");
    expect(screen.getByTestId("config-step-3-badge").textContent).toBe("✓");
    expect(screen.getByTestId("config-step-3-pill").textContent).toBe("Al día");
    expect(screen.getByTestId("config-step-3-summary").textContent).toBe("Retiene 5 % por defecto · 1 de 2 profesionales retiene · el costo de producto va para el salón");
    // Nothing is pending: every step stays folded.
    expect([1, 2, 3].map((n) => screen.getByTestId(`config-step-${n}-toggle`).getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
  });

  it("los atajos llevan a poner los %, a ordenar los grupos, a cada grupo y a las excepciones", async () => {
    mount("/app/commissions/configurar");
    await userEvent.click(await screen.findByTestId("config-step-2-link"));
    expect(screen.getByTestId("where").textContent).toBe("/app/commissions/configurar/comisiones");
    cleanup();
    mount("/app/commissions/configurar");
    await userEvent.click(await screen.findByTestId("config-step-2-order-link"));
    expect(screen.getByTestId("where").textContent).toBe("/app/commissions/configurar/grupos");
    cleanup();
    mount("/app/commissions/configurar");
    await userEvent.click((await screen.findAllByTestId("config-group-chip"))[1]);
    expect(screen.getByTestId("where").textContent).toBe("/app/commissions/configurar/comisiones?q=Manos");
    cleanup();
    mount("/app/commissions/configurar");
    await userEvent.click(await screen.findByTestId("config-exceptions-link"));
    expect(screen.getByTestId("where").textContent).toBe("/app/commissions/configurar/grupos?tab=exceptions");
    expect(await screen.findByTestId("commissions-exceptions")).toBeTruthy();
    // The order in which the % apply, from the general to the specific: the last one wins.
    const order = Array.from(screen.getByTestId("advanced-precedence").querySelectorAll("li")).map((li) => li.textContent);
    expect(order).toEqual(["% por defecto", "% del grupo", "% del servicio", "% de la profesional para ese servicio"]);
    expect(screen.getByTestId("advanced-precedence").textContent).toContain("gana la última que corresponda");
  });

  it("el buscador de Configurar abre «Grupos y servicios» ya buscando", async () => {
    mount("/app/commissions/configurar");
    await screen.findAllByTestId("config-group-chip");
    await userEvent.type(screen.getByTestId("config-search"), "pestañas{Enter}");
    expect(screen.getByTestId("where").textContent).toBe("/app/commissions/configurar/grupos?q=pesta%C3%B1as");
    expect(((await screen.findByTestId("groups-search")) as HTMLInputElement).value).toBe("pestañas");
  });

  it("«Grupos y servicios» tiene las solapas Grupos y Excepciones por servicio", async () => {
    mount("/app/commissions/configurar/grupos");
    await screen.findByTestId("commission-groups");
    expect(screen.getByTestId("workspace-tab-groups").getAttribute("aria-current")).toBe("page");
    await userEvent.click(screen.getByTestId("workspace-tab-exceptions"));
    expect(await screen.findByTestId("commissions-exceptions")).toBeTruthy();
    expect(within(screen.getByTestId("commissions-groups-page")).getByTestId("workspace-tab-exceptions").getAttribute("aria-current")).toBe("page");
  });
});
