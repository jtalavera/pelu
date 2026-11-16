import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import type { Overview, OverviewRow, RateException, RateItem, RatesView } from "../../api/commissions";
import CommissionsLayout from "./CommissionsLayout";
import HomePage from "./HomePage";
import LiquidarPage from "./LiquidarPage";
import ProfessionalPage from "./ProfessionalPage";
import { AguinaldoGuard, TeamLayout, TeamList } from "./TeamPage";

const api = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getSettings: vi.fn(),
  getRates: vi.fn(),
  getProfessionalsSummary: vi.fn(),
  getAguinaldo: vi.fn(),
  getAguinaldoDetail: vi.fn(),
  getEntries: vi.fn(),
  getSettlementPreview: vi.fn(),
  getApplyModeOptions: vi.fn(),
  applyChanges: vi.fn(),
  generateSettlements: vi.fn(),
  approveSettlement: vi.fn(),
  paySettlement: vi.fn(),
  voidSettlement: vi.fn(),
  downloadCommissionFile: vi.fn(),
}));
vi.mock("../../api/commissions", async (orig) => ({ ...(await orig<typeof import("../../api/commissions")>()), ...api }));
vi.mock("../../api/femmeClient", () => ({ femmeJson: vi.fn(async () => []), femmePostJson: vi.fn(), femmePutJson: vi.fn() }));
vi.mock("../../hooks/useFeatureFlags", () => ({
  useFeatureFlag: () => true,
  useFeatureFlagsState: () => ({ loading: false }),
}));
vi.mock("../../hooks/useMe", () => ({ useMe: () => ({ me: { role: "ADMIN" } }) }));

const person = (id: number, name: string, over: Partial<OverviewRow> = {}): OverviewRow => ({
  professionalId: id,
  professionalName: name,
  status: "UNSETTLED",
  amount: 100000,
  retention: 0,
  settlementId: null,
  ruleCount: 2,
  lineCount: 1,
  paidOn: null,
  ...over,
});

const overview = (over: Partial<Overview> = {}): Overview => ({
  period: { periodicity: "BIWEEKLY", from: "2026-11-01", to: "2026-11-15", nextFrom: "2026-11-16" },
  offset: 0,
  rows: [
    person(1, "Gaby", { status: "UNSETTLED", amount: 120000 }),
    person(2, "Migue", { status: "DRAFT", amount: 80000, settlementId: 7 }),
    person(3, "Norma", { status: "APPROVED", amount: 50000, settlementId: 8, ruleCount: 0 }),
    person(4, "Laura", { status: "PAID", amount: 30000, settlementId: 9, paidOn: "2026-11-12" }),
    person(5, "Rosa", { status: "NONE", amount: 0, lineCount: 0 }),
  ],
  total: 280000,
  retentionTotal: 0,
  unsettled: 1,
  drafts: 1,
  approved: 1,
  paid: 1,
  linesWithoutProfessional: 0,
  ungroupedServices: 0,
  groupsWithoutPercent: 1,
  groupCount: 3,
  aguinaldoEnabled: false,
  aguinaldoBalance: 0,
  professionalsRetaining: 0,
  ...over,
});

const item = (serviceId: number, name: string, over: Partial<RateItem> = {}): RateItem => ({
  serviceId,
  name,
  kind: "SERVICE",
  ownPercent: null,
  ownFixedAmount: null,
  ownFixedDestination: null,
  normalPercent: 35,
  normalFixedAmount: 0,
  normalFixedDestination: "PROFESSIONAL",
  source: "GROUP",
  scheduled: false,
  exceptions: [],
  ...over,
});
const gabyPaid = (percent: number): RateException => ({ professionalId: 1, professionalName: "Gaby", percent, fixedAmount: 0, fixedDestination: null, scheduled: false });

/** Corte pays 35 % (Gaby 40 % in three of its four services); Alisado pays 40 %, «pelo largo» 30 % and Gaby 50 % there. */
const rates: RatesView = {
  date: "2026-11-15",
  baseType: "TAX_INCLUDED",
  generalServicePercent: 10,
  generalProductPercent: 5,
  defaultFixedDestination: "PROFESSIONAL",
  groups: [
    {
      id: 1,
      name: "Corte",
      percent: 35,
      fixedAmount: null,
      fixedDestination: null,
      scheduled: false,
      items: [
        item(1, "Corte dama", { exceptions: [gabyPaid(40)] }),
        item(2, "Corte caballero", { exceptions: [gabyPaid(40)] }),
        item(3, "Corte niño", { exceptions: [gabyPaid(40)] }),
        item(4, "Corte con tijera"),
      ],
    },
    {
      id: 2,
      name: "Alisado",
      percent: 40,
      fixedAmount: null,
      fixedDestination: null,
      scheduled: false,
      items: [
        item(5, "Alisado pelo mediano", { normalPercent: 40 }),
        item(6, "Alisado pelo largo", { ownPercent: 30, normalPercent: 30, source: "SERVICE", exceptions: [gabyPaid(50)] }),
      ],
    },
  ],
  ungrouped: [item(7, "Baño de crema", { normalPercent: 10, source: "GENERAL" })],
};

/** What the «how to apply» dialog says is changing (its summary is the description of the dialog). */
const applyText = async () => (await screen.findByTestId("commission-apply-dialog")).closest('[role="dialog"]')?.textContent ?? "";

function mount(initial: string, ov: Overview = overview()) {
  api.getOverview.mockResolvedValue(ov);
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/app/commissions" element={<CommissionsLayout />}>
              <Route index element={<HomePage />} />
              <Route path="liquidar" element={<LiquidarPage />} />
              <Route path="equipo" element={<TeamLayout />}>
                <Route index element={<TeamList />} />
                <Route path="aguinaldo" element={<AguinaldoGuard><div data-testid="aguinaldo-stub" /></AguinaldoGuard>} />
                <Route path=":professionalId" element={<ProfessionalPage />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("es");
  api.getProfessionalsSummary.mockResolvedValue({
    aguinaldoEnabled: false,
    professionals: [
      { professionalId: 1, name: "Gaby", ruleCount: 2, retentionPercent: 5 },
      { professionalId: 2, name: "Migue", ruleCount: 2, retentionPercent: null },
      { professionalId: 3, name: "Norma", ruleCount: 0, retentionPercent: null },
    ],
  });
  api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 0, balances: [] });
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

describe("HU-COM-15 · estructura", () => {
  it("muestra los cinco lugares con los contadores de lo pendiente", async () => {
    mount("/app/commissions");
    await screen.findByTestId("home-hero");
    for (const id of ["home", "settle", "team", "activity", "setup"]) {
      expect(screen.getByTestId(`commissions-nav-${id}`)).toBeTruthy();
    }
    // 1 sin liquidar + 1 borrador + 1 aprobada
    expect(screen.getByTestId("commissions-nav-badge-settle").textContent).toBe("3");
  });

  it("Aguinaldo solo aparece dentro de Equipo cuando el salón lo activó", async () => {
    mount("/app/commissions/equipo");
    await screen.findByTestId("team-list");
    expect(screen.queryByTestId("team-tab-aguinaldo")).toBeNull();
    cleanup();
    mount("/app/commissions/equipo", overview({ aguinaldoEnabled: true }));
    await screen.findByTestId("team-tab-aguinaldo");
  });

  it("entrar a /equipo/aguinaldo con Aguinaldo apagado vuelve a la lista", async () => {
    mount("/app/commissions/equipo/aguinaldo");
    await screen.findByTestId("team-list");
    expect(screen.queryByTestId("aguinaldo-stub")).toBeNull();
  });
});

describe("HU-COM-15 · Inicio", () => {
  it("separa lo pagado de lo que falta pagar y dice de cuántas profesionales es el total", async () => {
    mount("/app/commissions");
    expect((await screen.findByTestId("home-total")).textContent).toContain("280.000");
    expect(screen.getByTestId("home-progress-text").textContent).toContain("4 profesionales con comisiones");
    // Laura is paid (30.000); the rest (120.000 + 80.000 + 50.000) is left to pay.
    expect(screen.getByTestId("home-paid-amount").textContent).toContain("30.000");
    expect(screen.getByTestId("home-pending-amount").textContent).toContain("250.000");
  });

  it("la barra se explica con una leyenda por estado y el monto de cada uno", async () => {
    mount("/app/commissions");
    await screen.findByTestId("home-bar");
    expect(screen.getByTestId("home-legend-UNSETTLED").textContent).toContain("120.000");
    expect(screen.getByTestId("home-legend-DRAFT").textContent).toContain("80.000");
    expect(screen.getByTestId("home-legend-APPROVED").textContent).toContain("50.000");
    expect(screen.getByTestId("home-legend-PAID").textContent).toContain("30.000");
  });

  it("«Qué falta hacer» muestra los 4 pasos con personas, plata y la acción siguiente", async () => {
    mount("/app/commissions");
    await screen.findByTestId("home-steps");
    const unsettled = screen.getByTestId("home-step-UNSETTLED");
    expect(within(unsettled).getByTestId("home-step-people").textContent).toBe("1 profesional");
    expect(within(unsettled).getByTestId("home-step-amount").textContent).toBe("Gs. 120.000 por generar");
    expect(within(screen.getByTestId("home-step-DRAFT")).getByTestId("home-step-amount").textContent).toContain("por aprobar");
    expect(within(screen.getByTestId("home-step-APPROVED")).getByTestId("home-step-amount").textContent).toContain("por pagar");
    expect(screen.getByTestId("home-step-PAID-action").textContent).toBe("Ver pagos");
    expect(screen.getByTestId("home-step-DRAFT-action").getAttribute("href")).toBe("/app/commissions/liquidar?state=DRAFT");
  });

  it("«Tu equipo» cuenta las activas, las que tienen comisiones y nombra a las que no tienen movimientos", async () => {
    mount("/app/commissions");
    await screen.findByTestId("home-team");
    expect(screen.getByTestId("home-team-counts").textContent).toBe("5 profesionales activas · 4 con comisiones · 1 sin movimientos");
    expect(screen.getAllByTestId("home-team-row")).toHaveLength(4); // only the ones with movements are listed
    expect(screen.getByTestId("home-team-none").textContent).toContain("Rosa");
    expect(screen.getByTestId("home-team-none-link").getAttribute("href")).toBe("/app/commissions/liquidar?state=NONE");
  });

  it("lista solo lo que hay para revisar", async () => {
    mount("/app/commissions");
    await screen.findByTestId("home-hero");
    expect(screen.getByTestId("home-review-noPercent")).toBeTruthy();
    expect(screen.getByTestId("home-review-drafts")).toBeTruthy();
    expect(screen.queryByTestId("home-review-lines")).toBeNull();
    expect(screen.queryByTestId("home-review-ungrouped")).toBeNull();
  });

  it("«Para revisar» es un panel de filas: el número una vez, la consecuencia, un ícono por tipo y solo la primera con botón relleno", async () => {
    api.getSettings.mockResolvedValue({ defaultPercentService: 12, defaultPercentProduct: 5 });
    mount("/app/commissions", overview({ linesWithoutProfessional: 20, groupsWithoutPercent: 13, drafts: 3 }));
    await screen.findByTestId("home-review-lines");
    const rows = [...screen.getByTestId("home-review").querySelectorAll("li")];
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["home-review-lines", "home-review-noPercent", "home-review-drafts"]);
    // Money lost (amber) / to set up (teal, the general % is not 0) / paperwork (gray).
    expect(rows.map((r) => r.getAttribute("data-tone"))).toEqual(["money", "setup", "paperwork"]);
    expect(screen.queryByTestId("home-review-tag")).toBeNull(); // the old tag is gone: the sentence says it
    const lines = screen.getByTestId("home-review-lines");
    expect(within(lines).getByTestId("home-review-count").textContent).toBe("20");
    expect(within(lines).getByTestId("home-review-title").textContent).toBe("20 líneas de venta sin profesional");
    expect(within(lines).getByTestId("home-review-help").textContent).toBe("No generan comisión hasta que les asignes una profesional.");
    expect(within(lines).getByTestId("home-review-lines-action").textContent).toBe("Asignar profesional");
    const noPercent = screen.getByTestId("home-review-noPercent");
    expect(within(noPercent).getByTestId("home-review-title").textContent).toBe("13 grupos sin su propio %");
    await waitFor(() => expect(within(noPercent).getByTestId("home-review-help").textContent).toBe("Hoy cobran el % general de servicios: 12\u00a0%."));
    expect(within(noPercent).getByTestId("home-review-noPercent-action").textContent).toBe("Poner los %");
    expect(within(screen.getByTestId("home-review-drafts")).getByTestId("home-review-drafts-action").textContent).toBe("Revisar borradores");
    // Only the first one is filled: it is the one to do first.
    const filled = (key: string) => /(^|\s)bg-primary(\s|$)/.test(screen.getByTestId(`home-review-${key}-action`).className);
    expect([filled("lines"), filled("noPercent"), filled("drafts")]).toEqual([true, false, false]);
  });

  it("«Para revisar»: si el % general es 0 % dice sin rodeos que hoy no pagan comisión (en ámbar) y el 0 % no se parte", async () => {
    api.getSettings.mockResolvedValue({ defaultPercentService: 0, defaultPercentProduct: 10 });
    mount("/app/commissions", overview({ linesWithoutProfessional: 0, groupsWithoutPercent: 11, drafts: 0 }));
    const noPercent = await screen.findByTestId("home-review-noPercent");
    await waitFor(() => expect(within(noPercent).getByTestId("home-review-help").textContent).toBe("Hoy no pagan comisión: el % general de servicios es 0\u00a0%."));
    expect(noPercent.getAttribute("data-tone")).toBe("money");
    expect(within(noPercent).getByTestId("home-review-help").className).toContain("text-warning");
    // It is the only row, so it is the filled one.
    expect(screen.getByTestId("home-review-noPercent-action").className).toMatch(/(^|\s)bg-primary(\s|$)/);
  });

  it("«Para revisar» con una sola liquidación en borrador usa el singular y, sin leer el % general, no inventa un número", async () => {
    api.getSettings.mockRejectedValue(new Error("NETWORK"));
    mount("/app/commissions", overview({ linesWithoutProfessional: 0, groupsWithoutPercent: 1, drafts: 1 }));
    await screen.findByTestId("home-review-drafts");
    expect(screen.getByTestId("home-review-drafts").textContent).toContain("1 liquidación en borrador");
    expect(screen.getByTestId("home-review-drafts").textContent).toContain("Hay que aprobarla para poder pagarla.");
    expect(screen.getByTestId("home-review-noPercent").textContent).toContain("1 grupo sin su propio %");
    expect(screen.getByTestId("home-review-noPercent-action").className).toMatch(/(^|\s)bg-primary(\s|$)/);
    expect(within(screen.getByTestId("home-review-noPercent")).getByTestId("home-review-help").textContent).toBe("Hoy cobran el % general de servicios.");
  });

  it("sin grupos muestra la guía de primera vez con tres pasos", async () => {
    mount("/app/commissions", overview({ groupCount: 0, rows: [], unsettled: 0, drafts: 0, approved: 0, paid: 0, total: 0 }));
    expect(await screen.findByTestId("setup-progress")).toBeTruthy();
    for (const n of [1, 2, 3]) expect(screen.getByTestId(`setup-step-${n}`)).toBeTruthy();
    expect(screen.queryByTestId("setup-step-4")).toBeNull();
  });
});

describe("HU-COM-15 · Equipo", () => {
  it("lista a cada profesional con su estado y dice si cobra lo normal o distinto en algo", async () => {
    mount("/app/commissions/equipo");
    expect(await screen.findAllByTestId("team-card")).toHaveLength(5);
    expect(screen.getByTestId("team-counts").textContent).toBe("5 profesionales activas · 4 con comisiones · 1 sin movimientos");
    const byName = (n: string) => screen.getAllByTestId("team-card").find((c) => c.dataset.professional === n)!;
    expect(within(byName("Gaby")).getByTestId("team-card-rules").textContent).toBe("Cobra distinto en 2 servicios");
    // Nothing loaded for her: she is paid the usual % of each service (not a gap to fill).
    expect(within(byName("Norma")).getByTestId("team-card-rules").textContent).toBe("Cobra lo normal de cada servicio");
    expect(screen.queryByTestId("team-filter-norules")).toBeNull();
  });

  it("las que no tienen movimientos se ven con su estado y se filtran aparte; las pagadas dicen cuándo", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo");
    await screen.findAllByTestId("team-card");
    const rosa = screen.getAllByTestId("team-card").find((c) => c.textContent?.includes("Rosa"))!;
    expect(within(rosa).getByTestId("status-chip").textContent).toBe("Sin movimientos");
    expect(within(rosa).getByTestId("team-card-amount").textContent).toBe("—");
    expect(within(rosa).getByTestId("team-card-detail").textContent).toBe("No tiene ventas este período");
    const laura = screen.getAllByTestId("team-card").find((c) => c.textContent?.includes("Laura"))!;
    expect(within(laura).getByTestId("team-card-detail").textContent).toContain("Pagada el");
    await user.click(screen.getByTestId("team-filter-none"));
    expect(screen.getAllByTestId("team-card")).toHaveLength(1);
    await user.click(screen.getByTestId("team-filter-paid"));
    expect(screen.getAllByTestId("team-card")).toHaveLength(1);
  });

  it("busca por nombre sin importar mayúsculas ni tildes", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo");
    await screen.findAllByTestId("team-card");
    await user.type(screen.getByTestId("team-search"), "MIGUE");
    expect(screen.getAllByTestId("team-card")).toHaveLength(1);
  });
});

describe("HU-COM-15 · Liquidar", () => {
  it("tiene una pestaña por etapa con su cantidad, abre en la que toca hacer y muestra solo esa", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-tabs");
    // «Por generar» is next to do: only its rows are shown.
    expect(screen.getByTestId("liquidar-tab-UNSETTLED").getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("liquidar-row")).toHaveLength(1);
    expect(screen.getByTestId("liquidar-tab-UNSETTLED-count").textContent).toBe("1");
    expect(screen.getByTestId("liquidar-tab-PAID-count").textContent).toBe("1");
    await user.click(screen.getByTestId("liquidar-tab-DRAFT"));
    const rows = screen.getAllByTestId("liquidar-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-status")).toBe("DRAFT");
  });

  it("dice cuántas hay y cuánto suman, con un solo botón principal para la etapa", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-tabs");
    expect(screen.getByTestId("liquidar-summary").textContent).toBe("1 profesional · Gs. 120.000");
    expect(screen.getByTestId("liquidar-main-action").textContent).toBe("Generar 1");
    await user.click(screen.getByTestId("liquidar-tab-APPROVED"));
    expect(screen.getByTestId("liquidar-summary").textContent).toContain("50.000");
    expect(screen.getByTestId("liquidar-main-action").textContent).toBe("Pagar 1");
    // «Pagadas» has nothing to do: no main button.
    await user.click(screen.getByTestId("liquidar-tab-PAID"));
    expect(screen.queryByTestId("liquidar-main-action")).toBeNull();
    expect(screen.getByTestId("liquidar-paid-total").textContent).toContain("30.000");
    expect(screen.getByTestId("liquidar-total").textContent).toContain("280.000");
  });

  it("sin carteles de más: no hay aviso de alcance y la periodicidad se abre con el ⓘ", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-tabs");
    expect(screen.queryByTestId("liquidar-scope")).toBeNull();
    expect(screen.queryByTestId("liquidar-period-note")).toBeNull();
    await user.click(screen.getByTestId("liquidar-period-info"));
    expect(screen.getByTestId("liquidar-period-note").textContent).toContain("periodicidad de tu salón");
  });

  it("cada fila dice qué hay detrás del monto: movimientos, liquidación (con enlace) o día de pago", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-tabs");
    expect(screen.getByTestId("liquidar-row-note").textContent).toBe("1 movimiento");
    await user.click(screen.getByTestId("liquidar-tab-DRAFT"));
    expect(screen.getByTestId("liquidar-row-note").textContent).toBe("Liquidación #7");
    expect(screen.getByTestId("liquidar-row-detail").getAttribute("href")).toBe("/app/commissions/settlements/7");
    await user.click(screen.getByTestId("liquidar-tab-PAID"));
    expect(screen.getByTestId("liquidar-row-note").textContent).toContain("Pagada el");
    expect(screen.queryByTestId("liquidar-row-detail")).toBeNull();
  });

  it("«Sin movimientos» queda en una línea al pie que se abre para ver los nombres; no tiene filas ni acciones", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-tabs");
    expect(screen.getAllByTestId("liquidar-row").every((r) => r.getAttribute("data-status") !== "NONE")).toBe(true);
    expect(screen.getByTestId("liquidar-none-toggle").textContent).toContain("1 sin movimientos");
    expect(screen.queryByTestId("liquidar-none-list")).toBeNull();
    await user.click(screen.getByTestId("liquidar-none-toggle"));
    expect(screen.getByTestId("liquidar-none-list").textContent).toContain("Rosa");
    expect(screen.getByTestId("liquidar-none-toggle").getAttribute("aria-expanded")).toBe("true");
  });

  it("una pestaña sin filas dice que no hay nada por hacer", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar", overview({ rows: [person(1, "Gaby", { status: "UNSETTLED", amount: 120000 })], unsettled: 1, drafts: 0, approved: 0, paid: 0 }));
    await screen.findByTestId("liquidar-tabs");
    await user.click(screen.getByTestId("liquidar-tab-DRAFT"));
    expect(screen.getByTestId("liquidar-empty").textContent).toContain("Nada por aprobar");
    expect(screen.getByTestId("liquidar-main-action").hasAttribute("disabled")).toBe(true);
  });

  it("generar la liquidación de una profesional pide confirmar y no repite períodos ya liquidados", async () => {
    const user = userEvent.setup();
    api.generateSettlements.mockResolvedValue({ created: [], skipped: [] });
    mount("/app/commissions/liquidar");
    const rows = await screen.findAllByTestId("liquidar-row");
    await user.click(within(rows[0]).getByTestId("liquidar-row-generate"));
    await user.click(await screen.findByTestId("liquidar-confirm"));
    await waitFor(() => expect(api.generateSettlements).toHaveBeenCalled());
    expect(api.generateSettlements.mock.calls[0][0]).toMatchObject({
      periodFrom: "2026-11-01",
      periodTo: "2026-11-15",
      professionalIds: [1],
      skipOverlapping: true,
    });
  });

  it("aprobar la de una profesional en borrador aprueba esa liquidación", async () => {
    const user = userEvent.setup();
    api.approveSettlement.mockResolvedValue({});
    mount("/app/commissions/liquidar?state=DRAFT");
    const rows = await screen.findAllByTestId("liquidar-row");
    expect(rows).toHaveLength(1);
    await user.click(within(rows[0]).getByTestId("liquidar-row-approve"));
    await user.click(await screen.findByTestId("liquidar-confirm"));
    await waitFor(() => expect(api.approveSettlement).toHaveBeenCalledWith(7));
  });
});

describe("HU-COM-30 · descargar CSV", () => {
  it("el ícono junto al total abre un menú con «este período» (con sus fechas) y «períodos anteriores»", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-tabs");
    expect(screen.getByTestId("liquidar-csv").getAttribute("aria-label")).toBe("Descargar CSV de liquidaciones");
    await user.click(screen.getByTestId("liquidar-csv"));
    expect(screen.getByTestId("liquidar-csv-period").textContent).toContain("Descargar CSV de este período");
    expect(screen.getByTestId("liquidar-csv-period").textContent).toContain("01/11/2026");
    expect(screen.getByTestId("liquidar-csv-period").textContent).toContain("15/11/2026");
    expect(screen.getByTestId("liquidar-csv-previous").textContent).toContain("períodos anteriores");
  });

  it("«este período» descarga el CSV con las fechas del período", async () => {
    const user = userEvent.setup();
    api.downloadCommissionFile.mockResolvedValue(undefined);
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-tabs");
    await user.click(screen.getByTestId("liquidar-csv"));
    await user.click(screen.getByTestId("liquidar-csv-period"));
    await waitFor(() => expect(api.downloadCommissionFile).toHaveBeenCalledTimes(1));
    const path = api.downloadCommissionFile.mock.calls[0][0] as string;
    expect(path).toContain("/api/commissions/settlements.csv");
    expect(path).toContain("from=2026-11-01");
    expect(path).toContain("to=2026-11-15");
  });

  it("«períodos anteriores» pide el rango (tres meses antes hasta el día anterior al período) y descarga ese rango", async () => {
    const user = userEvent.setup();
    api.downloadCommissionFile.mockResolvedValue(undefined);
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-tabs");
    await user.click(screen.getByTestId("liquidar-csv"));
    await user.click(screen.getByTestId("liquidar-csv-previous"));
    expect((await screen.findByTestId("liquidar-csv-dialog")).textContent).toContain("Desde");
    expect((document.getElementById("liquidar-csv-from") as HTMLInputElement).value).toBe("01/08/2026");
    expect((document.getElementById("liquidar-csv-to") as HTMLInputElement).value).toBe("31/10/2026");
    await user.click(screen.getByTestId("liquidar-csv-confirm"));
    await waitFor(() => expect(api.downloadCommissionFile).toHaveBeenCalledTimes(1));
    const path = api.downloadCommissionFile.mock.calls[0][0] as string;
    expect(path).toContain("from=2026-08-01");
    expect(path).toContain("to=2026-10-31");
  });

  it("ya no hay un botón «Descargar CSV» en una franja al pie", async () => {
    mount("/app/commissions/liquidar", overview({ rows: [person(1, "Gaby", { status: "UNSETTLED", amount: 120000 })], unsettled: 1, drafts: 0, approved: 0, paid: 0 }));
    await screen.findByTestId("liquidar-tabs");
    expect(within(screen.getByTestId("liquidar-table")).queryByTestId("liquidar-csv")).toBeNull();
  });
});

describe("HU-COM-19 · anular borradores", () => {
  it("solo las filas en Borrador tienen «Anular» (en «Más acciones»), junto a «Aprobar»", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findAllByTestId("liquidar-row");
    // Not settled yet: nothing to void.
    expect(screen.queryByTestId("liquidar-row-more")).toBeNull();
    await user.click(screen.getByTestId("liquidar-tab-DRAFT"));
    const migue = screen.getAllByTestId("liquidar-row").find((r) => r.dataset.professional === "Migue")!;
    expect(within(migue).getByTestId("liquidar-row-approve")).toBeTruthy();
    await user.click(within(migue).getByTestId("liquidar-row-more"));
    expect(await screen.findByTestId("liquidar-row-void")).toBeTruthy();
  });

  it("anular una fila pide confirmar, el motivo es opcional y ofrece generar de nuevo", async () => {
    const user = userEvent.setup();
    api.voidSettlement.mockResolvedValue({});
    mount("/app/commissions/liquidar?state=DRAFT");
    await user.click(await screen.findByTestId("liquidar-row-more"));
    await user.click(await screen.findByTestId("liquidar-row-void"));
    expect(await screen.findByTestId("liquidar-confirm")).toHaveProperty("textContent", "Anular borrador");
    expect(screen.getByTestId("liquidar-dialog-summary").textContent).toContain("Migue");
    // Without a reason it is valid: the field is empty and nothing is flagged.
    api.getOverview.mockResolvedValue(
      overview({ rows: [person(2, "Migue", { status: "UNSETTLED", amount: 80000 })], unsettled: 1, drafts: 0 }),
    );
    await user.click(screen.getByTestId("liquidar-confirm"));
    await waitFor(() => expect(api.voidSettlement).toHaveBeenCalledWith(7, ""));
    expect((await screen.findByTestId("liquidar-notice")).textContent).toContain("Borrador anulado");
    expect(screen.getByTestId("liquidar-regenerate")).toBeTruthy();
  });

  it("un motivo frecuente se carga con un toque y se envía", async () => {
    const user = userEvent.setup();
    api.voidSettlement.mockResolvedValue({});
    mount("/app/commissions/liquidar?state=DRAFT");
    await user.click(await screen.findByTestId("liquidar-row-more"));
    await user.click(await screen.findByTestId("liquidar-row-void"));
    await user.click(await screen.findByTestId("liquidar-void-reason-rule"));
    expect((screen.getByTestId("liquidar-void-reason") as HTMLInputElement).value).toBe("Cambió una regla");
    await user.click(screen.getByTestId("liquidar-confirm"));
    await waitFor(() => expect(api.voidSettlement).toHaveBeenCalledWith(7, "Cambió una regla"));
  });

  it("en lote: la barra de selección anula solo los borradores marcados y avisa de las demás", async () => {
    const user = userEvent.setup();
    api.voidSettlement.mockResolvedValue({});
    const ov = overview({
      rows: [
        person(1, "Gaby", { status: "UNSETTLED", amount: 120000 }),
        person(2, "Migue", { status: "DRAFT", amount: 80000, settlementId: 7 }),
        person(3, "Nora", { status: "DRAFT", amount: 12000, settlementId: 8 }),
      ],
      drafts: 2,
      unsettled: 1,
      approved: 0,
      paid: 0,
    });
    mount("/app/commissions/liquidar", ov);
    await screen.findAllByTestId("liquidar-row");
    expect(screen.queryByTestId("liquidar-selection")).toBeNull();
    // The header checkbox of the «Por aprobar» tab marks both drafts.
    await user.click(screen.getByTestId("liquidar-tab-DRAFT"));
    await user.click(screen.getByTestId("liquidar-group-check-DRAFT"));
    expect(screen.getByTestId("liquidar-selection-count").textContent).toBe("2 seleccionadas");
    // A non-draft in the selection is left alone.
    await user.click(screen.getByTestId("liquidar-tab-UNSETTLED"));
    await user.click(screen.getAllByTestId("liquidar-row-check")[0]);
    await user.click(screen.getByTestId("liquidar-bulk-void"));
    expect(await screen.findByTestId("liquidar-confirm")).toHaveProperty("textContent", "Anular 2 borradores");
    expect(screen.getByTestId("liquidar-void-skipped").textContent).toContain("la otra marcada no cambia");
    await user.type(screen.getByTestId("liquidar-void-reason"), "Cambió una regla");
    await user.click(screen.getByTestId("liquidar-confirm"));
    await waitFor(() => expect(api.voidSettlement).toHaveBeenCalledTimes(2));
    expect(api.voidSettlement).toHaveBeenCalledWith(7, "Cambió una regla");
    expect(api.voidSettlement).toHaveBeenCalledWith(8, "Cambió una regla");
    await waitFor(() => expect(screen.queryByTestId("liquidar-selection")).toBeNull());
  });

  it("«Limpiar» deja la selección vacía y sin borradores marcados no aparece «Anular borradores»", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findAllByTestId("liquidar-row");
    await user.click(screen.getByTestId("liquidar-group-check-UNSETTLED"));
    expect(screen.getByTestId("liquidar-selection")).toBeTruthy();
    expect(screen.queryByTestId("liquidar-bulk-void")).toBeNull();
    await user.click(screen.getByTestId("liquidar-selection-clear"));
    expect(screen.queryByTestId("liquidar-selection")).toBeNull();
  });
});

describe("HU-COM-15 · ficha de la profesional", () => {
  it("el Resumen (la antigua vista previa) muestra lo que se le paga y lo arrastrado de períodos anteriores", async () => {
    api.getSettlementPreview.mockResolvedValue({
      professionalId: 1,
      professionalName: "Gaby",
      periodFrom: "2026-11-01",
      periodTo: "2026-11-15",
      total: 120000,
      servicesTotal: 100000,
      productsTotal: 20000,
      adjustmentsTotal: 0,
      retentionTotal: 0,
      lines: 3,
      entries: [],
      draftSettlements: [],
      carriedAmount: 30000,
      carriedEntryIds: [1],
    });
    mount("/app/commissions/equipo/1");
    expect((await screen.findByTestId("pro-summary-total")).textContent).toContain("120.000");
    expect(screen.getByTestId("pro-summary-services").textContent).toContain("100.000");
    expect(screen.getByTestId("pro-summary-products").textContent).toContain("20.000");
    expect(screen.getByTestId("pro-summary-carried").textContent).toContain("30.000");
    expect(screen.getByTestId("pro-summary-lines").textContent).toContain("3 líneas");
  });

  const previewOf = (over: Record<string, unknown> = {}) => ({
    professionalId: 1,
    professionalName: "Gaby",
    periodFrom: "2026-11-01",
    periodTo: "2026-11-15",
    total: 45000,
    servicesTotal: 45000,
    productsTotal: 0,
    adjustmentsTotal: 0,
    retentionTotal: 5000,
    lines: 2,
    entries: [],
    draftSettlements: [],
    carriedAmount: 0,
    carriedEntryIds: [],
    ...over,
  });
  const fundOf = (over: Record<string, unknown> = {}) => ({
    professionalId: 1,
    professionalName: "Gaby",
    active: true,
    retained: 37000,
    paid: 5000,
    balance: 32000,
    lastPaymentOn: null,
    ...over,
  });

  it("HU-COM-24 · la ficha tiene tres solapas (Resumen, Reglas y Movimientos): ya no hay «Aguinaldo» ni «Historial»", async () => {
    api.getSettlementPreview.mockResolvedValue(previewOf());
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 32000, balances: [fundOf()] });
    mount("/app/commissions/equipo/1", overview({ aguinaldoEnabled: true }));
    await screen.findByTestId("pro-summary-total");
    const tabs = screen.getByRole("navigation", { name: /solapas|secciones|ficha/i }).querySelectorAll("a");
    expect([...tabs].map((a) => a.textContent)).toEqual(["Resumen", "Reglas", "Movimientos"]);
    expect(screen.queryByTestId("pro-tab-aguinaldo")).toBeNull();
    expect(screen.getByTestId("pro-tab-history").textContent).toBe("Movimientos");
  });

  it("HU-COM-24 · el Resumen muestra lo que se paga y lo retenido, con el saldo, el último pago y las acciones", async () => {
    api.getSettlementPreview.mockResolvedValue(previewOf());
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 32000, balances: [fundOf({ lastPaymentOn: "2026-09-30" })] });
    mount("/app/commissions/equipo/1", overview({ aguinaldoEnabled: true }));
    // What is paid comes from the overview row (Gaby: 120.000 unsettled); the lines and the split, from her preview.
    expect((await screen.findByTestId("pro-summary-total")).textContent).toContain("120.000");
    expect(screen.getByTestId("pro-summary-lines").textContent).toContain("2 líneas");
    expect(screen.getByTestId("pro-summary-services").textContent).toContain("45.000");
    // The retention card: what was retained this period, her % and her balance.
    const card = screen.getByTestId("pro-retention-card");
    expect(within(card).getByTestId("pro-summary-retained").textContent).toContain("5.000");
    expect((await within(card).findByTestId("pro-retention-pill")).textContent).toBe("5 % de cada comisión");
    expect((await within(card).findByTestId("pro-retention-balance")).textContent).toContain("32.000");
    expect(within(card).getByTestId("pro-retention-last-payment").textContent).toMatch(/30\/09\/2026|2026/);
    expect(card.textContent).toContain("Se suma al saldo cuando se aprueba la liquidación");
    // Actions: pay and adjust the balance, and the link to its movements.
    expect(screen.getByTestId("pro-summary-go-settle")).toBeTruthy();
    expect((await screen.findByTestId("pro-retention-pay")).textContent).toBe("Pagar retención");
    expect(screen.getByTestId("pro-retention-adjust").textContent).toBe("Ajustar el saldo");
    expect(screen.getByTestId("pro-retention-movements-link").getAttribute("href")).toBe("/app/commissions/equipo/1?tab=history&view=retention");
  });

  it("HU-COM-24 · sin retención activada el Resumen no muestra la tarjeta ni las acciones de retención", async () => {
    api.getSettlementPreview.mockResolvedValue(previewOf({ retentionTotal: 0 }));
    mount("/app/commissions/equipo/1", overview({ aguinaldoEnabled: false }));
    await screen.findByTestId("pro-summary-total");
    expect(screen.queryByTestId("pro-retention-card")).toBeNull();
    expect(screen.queryByTestId("pro-retention-pay")).toBeNull();
    expect(screen.queryByTestId("pro-retention-movements-link")).toBeNull();
  });

  it("HU-COM-24 · «Pagar retención» desde el Resumen abre el pago con el saldo", async () => {
    const user = userEvent.setup();
    api.getSettlementPreview.mockResolvedValue(previewOf());
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 32000, balances: [fundOf()] });
    mount("/app/commissions/equipo/1", overview({ aguinaldoEnabled: true }));
    await user.click(await screen.findByTestId("pro-retention-pay"));
    const dialog = await screen.findByTestId("aguinaldo-pay-dialog");
    expect(dialog.closest('[role="dialog"]')?.textContent).toContain("Pagar retención · Gaby");
    expect(dialog.closest('[role="dialog"]')?.textContent).toContain("32.000");
  });

  it("HU-COM-24 · Movimientos tiene el interruptor Comisiones | Retención (solo si el salón retiene); Retención muestra el saldo y sus movimientos", async () => {
    const user = userEvent.setup();
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 32000, balances: [fundOf()] });
    api.getAguinaldoDetail.mockResolvedValue({
      professionalId: 1,
      professionalName: "Gaby",
      balance: 32000,
      movements: [
        { kind: "PAYMENT", date: "2026-09-30", amount: -20000, balance: 12000, note: null, closesFund: false, settlementId: null, movementId: 2 },
        { kind: "ACCRUAL", date: "2026-09-15", amount: 32000, balance: 32000, note: "1 al 15", closesFund: false, settlementId: 7, movementId: null },
      ],
    });
    api.getEntries.mockResolvedValue([]);
    mount("/app/commissions/equipo/1?tab=history", overview({ aguinaldoEnabled: true }));
    expect((await screen.findByTestId("pro-movements-view-commissions")).getAttribute("aria-pressed")).toBe("true");
    await screen.findByTestId("commission-movements");
    await user.click(screen.getByTestId("pro-movements-view-retention"));
    expect((await screen.findByTestId("aguinaldo-balance")).textContent).toContain("32.000");
    const moves = await screen.findAllByTestId("aguinaldo-movement");
    expect(moves).toHaveLength(2);
    expect(moves[0].textContent).toContain("Pago de retención");
    expect(screen.getByTestId("aguinaldo-pay").textContent).toBe("Pagar retención");
    expect(screen.getByTestId("aguinaldo-adjust").textContent).toBe("Ajustar el saldo");
  });

  it("HU-COM-26 · el Resumen muestra «Pagar retención» (deshabilitado sin saldo) y «Ajustar el saldo» aunque todavía no tenga movimientos, y el subtítulo dice cuánto retiene", async () => {
    api.getSettlementPreview.mockResolvedValue(previewOf());
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 0, balances: [] }); // nothing approved yet: no row in the fund
    mount("/app/commissions/equipo/1", overview({ aguinaldoEnabled: true }));
    const pay = (await screen.findByTestId("pro-retention-pay")) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    expect(pay.title).toContain("Todavía no hay saldo para pagar");
    expect(screen.getByTestId("pro-retention-nothing-to-pay").textContent).toContain("se suma cuando se aprueba la liquidación");
    expect((screen.getByTestId("pro-retention-adjust") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("pro-retention-balance").textContent).toContain("0");
    // Her retention (5 %) is in the subtitle, as in the mockup.
    await waitFor(() => expect(screen.getByTestId("pro-subtitle").textContent).toContain("Retiene 5 %"));
  });

  it("HU-COM-26 · con saldo «Pagar retención» se habilita y el aviso de «sin saldo» desaparece", async () => {
    api.getSettlementPreview.mockResolvedValue(previewOf());
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 32000, balances: [fundOf()] });
    mount("/app/commissions/equipo/1", overview({ aguinaldoEnabled: true }));
    await waitFor(() => expect((screen.getByTestId("pro-retention-pay") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("pro-retention-nothing-to-pay")).toBeNull();
  });

  it("HU-COM-26 · Movimientos › Retención muestra lo retenido que espera aprobación como una línea gris «Pendiente», aunque el saldo sea 0", async () => {
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 0, balances: [] });
    api.getAguinaldoDetail.mockResolvedValue({ professionalId: 1, professionalName: "Gaby", balance: 0, movements: [] });
    api.getEntries.mockResolvedValue([]);
    mount(
      "/app/commissions/equipo/1?tab=history&view=retention",
      overview({ aguinaldoEnabled: true, rows: [person(1, "Gaby", { status: "UNSETTLED", retention: 5000 })] }),
    );
    const pending = await screen.findByTestId("aguinaldo-pending");
    expect(pending.getAttribute("data-status")).toBe("UNSETTLED");
    expect(pending.textContent).toContain("Pendiente");
    expect(pending.textContent).toContain("sin liquidar");
    expect(screen.getByTestId("aguinaldo-pending-amount").textContent).toBe("+ Gs. 5.000");
    expect(screen.getByTestId("aguinaldo-balance").textContent).toContain("0");
    expect(screen.queryByTestId("aguinaldo-movements-empty")).toBeNull(); // the pending line already explains it
    // The actions are there even with a balance of 0.
    expect((screen.getByTestId("aguinaldo-pay") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("aguinaldo-adjust") as HTMLButtonElement).disabled).toBe(false);
  });

  it("HU-COM-26 · si la retención está en un borrador lo dice; y sin movimientos ni pendientes hay un mensaje en lugar de la caja vacía", async () => {
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 0, balances: [] });
    api.getAguinaldoDetail.mockResolvedValue({ professionalId: 1, professionalName: "Gaby", balance: 0, movements: [] });
    api.getEntries.mockResolvedValue([]);
    mount(
      "/app/commissions/equipo/1?tab=history&view=retention",
      overview({ aguinaldoEnabled: true, rows: [person(1, "Gaby", { status: "DRAFT", retention: 5000, settlementId: 7 })] }),
    );
    expect((await screen.findByTestId("aguinaldo-pending")).textContent).toContain("en un borrador, pendiente de aprobar");
    cleanup();
    mount("/app/commissions/equipo/1?tab=history&view=retention", overview({ aguinaldoEnabled: true, rows: [person(1, "Gaby", { status: "UNSETTLED", retention: 0 })] }));
    expect((await screen.findByTestId("aguinaldo-movements-empty")).textContent).toContain("Todavía no hay movimientos de retención");
    expect(screen.queryByTestId("aguinaldo-pending")).toBeNull();
  });

  it("HU-COM-26 · lo retenido ya aprobado no se muestra como pendiente (ya está en el saldo)", async () => {
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 5000, balances: [fundOf({ balance: 5000 })] });
    api.getAguinaldoDetail.mockResolvedValue({
      professionalId: 1,
      professionalName: "Gaby",
      balance: 5000,
      movements: [{ kind: "ACCRUAL", date: "2026-11-15", amount: 5000, balance: 5000, note: "1 al 15", closesFund: false, settlementId: 7, movementId: null }],
    });
    api.getEntries.mockResolvedValue([]);
    mount(
      "/app/commissions/equipo/1?tab=history&view=retention",
      overview({ aguinaldoEnabled: true, rows: [person(1, "Gaby", { status: "APPROVED", retention: 5000, settlementId: 7 })] }),
    );
    expect(await screen.findAllByTestId("aguinaldo-movement")).toHaveLength(1);
    expect(screen.queryByTestId("aguinaldo-pending")).toBeNull();
  });

  it("HU-COM-24 · la dirección vieja ?tab=aguinaldo abre la lista de Retención de Movimientos; y sin retención no hay interruptor", async () => {
    api.getAguinaldo.mockResolvedValue({ enabled: true, totalBalance: 0, balances: [fundOf({ balance: 0 })] });
    api.getAguinaldoDetail.mockResolvedValue({ professionalId: 1, professionalName: "Gaby", balance: 0, movements: [] });
    api.getEntries.mockResolvedValue([]);
    mount("/app/commissions/equipo/1?tab=aguinaldo", overview({ aguinaldoEnabled: true }));
    expect((await screen.findByTestId("pro-movements-view-retention")).getAttribute("aria-pressed")).toBe("true");
    cleanup();
    mount("/app/commissions/equipo/1?tab=history", overview({ aguinaldoEnabled: false }));
    await screen.findByTestId("commission-movements");
    expect(screen.queryByTestId("pro-movements-view-retention")).toBeNull();
  });

  it("«Comisiones» dice que cobra lo normal y lista solo donde cobra distinto, juntando el grupo", async () => {
    mount("/app/commissions/equipo/1?tab=rules");
    expect(await screen.findByTestId("pro-rates-usual")).toBeTruthy();
    const rows = await screen.findAllByTestId("pro-rate-row");
    expect(rows.map((r) => r.dataset.name)).toEqual(["Corte", "Alisado pelo largo"]);
    expect(screen.getByTestId("pro-differences-count").textContent).toBe("2 casos");
    const corte = rows[0];
    expect(corte.dataset.kind).toBe("GROUP");
    expect(within(corte).getByTestId("pro-rate-title").textContent).toBe("Corte · 3 de 4 servicios");
    expect(within(corte).getByTestId("pro-rate-percent").textContent).toBe("40 %");
    expect(within(corte).getByTestId("pro-rate-normal").textContent).toBe("Lo normal es 35 %");
    // The service added later to the group does not inherit hers: it says so and offers to include it.
    expect(within(corte).getByTestId("pro-rate-missing").textContent).toContain("Corte con tijera");
    expect(within(rows[1]).getByTestId("pro-rate-percent").textContent).toBe("50 %");
    expect(within(rows[1]).getByTestId("pro-rate-normal").textContent).toBe("Lo normal es 30 %");
  });

  it("cambiar, quitar o incluir piden cómo aplicar el cambio y dicen qué cambia", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo/1?tab=rules");
    const rows = await screen.findAllByTestId("pro-rate-row");
    await user.click(within(rows[0]).getByTestId("pro-rate-edit"));
    const input = await screen.findByTestId("pro-rate-percent-input");
    await user.clear(input);
    await user.type(input, "45");
    await user.click(screen.getByTestId("pro-rate-save"));
    expect(await applyText()).toContain("Comisión de Gaby en Corte: 45 %");
    cleanup();
    mount("/app/commissions/equipo/1?tab=rules");
    const again = await screen.findAllByTestId("pro-rate-row");
    await user.click(within(again[1]).getByTestId("pro-rate-remove"));
    expect(await applyText()).toContain("vuelve a lo normal");
    cleanup();
    mount("/app/commissions/equipo/1?tab=rules");
    await user.click(await screen.findByTestId("pro-rate-include"));
    expect(await applyText()).toContain("Incluir 1 servicios de Corte");
  });

  it("agregar: un grupo entero se carga en cada uno de sus servicios y el ejemplo muestra lo que se le paga", async () => {
    const user = userEvent.setup();
    api.getProfessionalsSummary.mockResolvedValue({
      aguinaldoEnabled: true,
      professionals: [{ professionalId: 1, name: "Gaby", ruleCount: 2, retentionPercent: 5 }],
    });
    mount("/app/commissions/equipo/1?tab=rules");
    await screen.findAllByTestId("pro-rate-row");
    await user.click(screen.getByTestId("pro-rates-add"));
    await user.selectOptions(await screen.findByTestId("pro-rate-group"), "2");
    await user.type(screen.getByTestId("pro-rate-percent-input"), "45");
    expect(screen.getByTestId("pro-rate-scope").textContent).toContain("2 servicios");
    // 45 % of Gs. 100.000, with her 5 % retention: 40.000 paid and 5.000 to the fund.
    expect(screen.getByTestId("pro-rate-example").textContent).toContain("40.000");
    expect(screen.getByTestId("pro-rate-example").textContent).toContain("5.000");
    await user.click(screen.getByTestId("pro-rate-save"));
    expect(await applyText()).toContain("Comisión de Gaby en Alisado: 45 %");
  });

  it("agregar valida el %, y un servicio suelto también se puede elegir", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo/1?tab=rules");
    await screen.findAllByTestId("pro-rate-row");
    await user.click(screen.getByTestId("pro-rates-add"));
    await user.click(await screen.findByTestId("pro-rate-mode-SERVICE"));
    await user.selectOptions(screen.getByTestId("pro-rate-service"), "7");
    await user.type(screen.getByTestId("pro-rate-percent-input"), "150");
    await user.click(screen.getByTestId("pro-rate-save"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/entre 0 y 100/);
    expect(screen.queryByTestId("commission-apply-dialog")).toBeNull();
  });

  it("la retención de aguinaldo es de la profesional: solo aparece con Aguinaldo activo y pide desde cuándo aplica", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo/1?tab=rules");
    await screen.findAllByTestId("pro-rate-row");
    expect(screen.queryByTestId("pro-retention")).toBeNull();
    expect(screen.queryByTestId("pro-tab-aguinaldo")).toBeNull();
    cleanup();
    api.getProfessionalsSummary.mockResolvedValue({
      aguinaldoEnabled: true,
      professionals: [{ professionalId: 1, name: "Gaby", ruleCount: 2, retentionPercent: 5 }],
    });
    mount("/app/commissions/equipo/1?tab=rules", overview({ aguinaldoEnabled: true }));
    expect((await screen.findByTestId("pro-retention-current")).textContent).toBe("Retención: 5 %");
    await user.click(screen.getByTestId("pro-retention-edit"));
    const input = await screen.findByTestId("pro-retention-percent");
    await user.clear(input);
    await user.type(input, "7");
    await user.click(screen.getByTestId("pro-retention-save"));
    expect(await applyText()).toContain("Cambiar la retención de Gaby a 7 %");
  });

  it("sin nada cargado dice que cobra lo normal en todo", async () => {
    api.getRates.mockResolvedValue({ ...rates, groups: rates.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, exceptions: [] })) })) });
    mount("/app/commissions/equipo/1?tab=rules");
    expect((await screen.findByTestId("pro-differences-empty")).textContent).toContain("cobra lo normal en todo");
    expect(screen.queryAllByTestId("pro-rate-row")).toHaveLength(0);
  });
});
