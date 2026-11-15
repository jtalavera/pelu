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

const overview = { professionalsWithoutRules: 2, groupCount: 2, ungroupedServices: 1 } as unknown as Overview;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const mount = (initial: string) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <OverviewContext.Provider value={{ overview, error: null, refresh: async () => {} }}>
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
      { id: 1, name: "Color", serviceCount: 3, serviceNames: [], professionalsWithRule: 2 },
      { id: 2, name: "Manos", serviceCount: 1, serviceNames: [], professionalsWithRule: 0 },
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

  it("cada paso muestra su estado: grupos, servicios con grupo, sin grupo y profesionales sin reglas", async () => {
    mount("/app/commissions/configurar");
    expect((await screen.findByTestId("config-tile-groups")).textContent).toContain("2");
    expect(screen.getByTestId("config-tile-grouped").textContent).toContain("4 de 5");
    expect(screen.getByTestId("config-tile-ungrouped").textContent).toContain("1");
    expect(screen.getAllByTestId("config-group-chip").map((c) => c.textContent)).toEqual(["Color 3", "Manos 1"]);
    expect(screen.getByTestId("config-step-3-status").textContent).toContain("2 profesionales sin reglas");
    expect(screen.getByTestId("commission-setting-BASE")).toBeTruthy();
  });

  it("los atajos llevan al grupo, a «Sin grupo» y a las excepciones", async () => {
    mount("/app/commissions/configurar");
    await userEvent.click(await screen.findByTestId("config-tile-ungrouped"));
    expect(screen.getByTestId("where").textContent).toBe("/app/commissions/configurar/grupos?group=none");
    cleanup();
    mount("/app/commissions/configurar");
    await userEvent.click((await screen.findAllByTestId("config-group-chip"))[1]);
    expect(screen.getByTestId("where").textContent).toBe("/app/commissions/configurar/grupos?group=2");
    cleanup();
    mount("/app/commissions/configurar");
    await userEvent.click(await screen.findByTestId("config-exceptions-link"));
    expect(screen.getByTestId("where").textContent).toBe("/app/commissions/configurar/grupos?tab=exceptions");
    expect(await screen.findByTestId("commissions-exceptions")).toBeTruthy();
    expect(screen.getByTestId("advanced-precedence").querySelectorAll("li")).toHaveLength(5);
  });

  it("el buscador de Configurar abre «Grupos y servicios» ya buscando", async () => {
    mount("/app/commissions/configurar");
    await screen.findByTestId("config-tile-groups");
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
