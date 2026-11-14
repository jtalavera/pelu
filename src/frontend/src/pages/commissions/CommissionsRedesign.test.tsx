import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import type { GroupRuleRow, Overview, OverviewRow, ProfessionalRulesView } from "../../api/commissions";
import CommissionsLayout from "./CommissionsLayout";
import HomePage from "./HomePage";
import LiquidarPage from "./LiquidarPage";
import ProfessionalPage from "./ProfessionalPage";
import { AguinaldoGuard, TeamLayout, TeamList } from "./TeamPage";

const api = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getProfessionalRules: vi.fn(),
  getProfessionalsSummary: vi.fn(),
  getAguinaldo: vi.fn(),
  getAguinaldoDetail: vi.fn(),
  getSettlementPreview: vi.fn(),
  getApplyModeOptions: vi.fn(),
  applyChanges: vi.fn(),
  generateSettlements: vi.fn(),
  approveSettlement: vi.fn(),
  paySettlement: vi.fn(),
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
  ...over,
});

const overview = (over: Partial<Overview> = {}): Overview => ({
  period: { periodicity: "BIWEEKLY", from: "2026-11-01", to: "2026-11-15", nextFrom: "2026-11-16" },
  offset: 0,
  rows: [
    person(1, "Gaby", { status: "UNSETTLED", amount: 120000 }),
    person(2, "Migue", { status: "DRAFT", amount: 80000, settlementId: 7 }),
    person(3, "Norma", { status: "APPROVED", amount: 50000, settlementId: 8, ruleCount: 0 }),
    person(4, "Laura", { status: "PAID", amount: 30000, settlementId: 9 }),
  ],
  total: 280000,
  retentionTotal: 0,
  unsettled: 1,
  drafts: 1,
  approved: 1,
  paid: 1,
  linesWithoutProfessional: 0,
  ungroupedServices: 0,
  professionalsWithoutRules: 1,
  groupCount: 3,
  aguinaldoEnabled: false,
  aguinaldoBalance: 0,
  ...over,
});

const rule = (over: Partial<GroupRuleRow>): GroupRuleRow => ({
  groupId: 1,
  groupName: "Brushing",
  serviceCount: 2,
  ownRule: true,
  percent: 45,
  retentionPercent: 5,
  fixedAmount: 0,
  fixedDestination: null,
  effectiveFixedDestination: "PROFESSIONAL",
  versionId: 1,
  scheduled: false,
  ...over,
});

const gaby: ProfessionalRulesView = {
  professionalId: 1,
  professionalName: "Gaby",
  active: true,
  baseType: "TAX_INCLUDED",
  aguinaldoEnabled: true,
  retentionProfilePercent: 5,
  defaultFixedDestination: "PROFESSIONAL",
  defaultPercentService: 10,
  groups: [
    rule({}),
    rule({ groupId: 2, groupName: "Pestañas", serviceCount: 3, percent: 40, retentionPercent: 5, fixedAmount: 20000, fixedDestination: "PROFESSIONAL", versionId: 2 }),
    rule({ groupId: 3, groupName: "Manos", ownRule: false, percent: null, retentionPercent: null, fixedAmount: null, versionId: null }),
  ],
};

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
  api.getProfessionalRules.mockResolvedValue(gaby);
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
  it("cuenta cuánto hay para pagar y deja continuar con la liquidación", async () => {
    mount("/app/commissions");
    expect((await screen.findByTestId("home-total")).textContent).toContain("280.000");
    expect(screen.getByTestId("home-continue")).toBeTruthy();
  });

  it("lista solo lo que hay para revisar", async () => {
    mount("/app/commissions");
    await screen.findByTestId("home-hero");
    expect(screen.getByTestId("home-review-noRules")).toBeTruthy();
    expect(screen.getByTestId("home-review-drafts")).toBeTruthy();
    expect(screen.queryByTestId("home-review-lines")).toBeNull();
    expect(screen.queryByTestId("home-review-ungrouped")).toBeNull();
  });

  it("sin grupos muestra la guía de primera vez con cuatro pasos", async () => {
    mount("/app/commissions", overview({ groupCount: 0, rows: [], unsettled: 0, drafts: 0, approved: 0, paid: 0, total: 0 }));
    expect(await screen.findByTestId("setup-progress")).toBeTruthy();
    for (const n of [1, 2, 3, 4]) expect(screen.getByTestId(`setup-step-${n}`)).toBeTruthy();
  });
});

describe("HU-COM-15 · Equipo", () => {
  it("lista a cada profesional con su estado y filtra los que no tienen reglas", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo");
    expect(await screen.findAllByTestId("team-card")).toHaveLength(4);
    await user.click(screen.getByTestId("team-filter-norules"));
    const cards = screen.getAllByTestId("team-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("Norma");
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
  it("resume los tres pasos y filtra por estado", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/liquidar");
    await screen.findByTestId("liquidar-step-1");
    expect(screen.getAllByTestId("liquidar-row")).toHaveLength(4);
    await user.click(screen.getByTestId("liquidar-filter-DRAFT"));
    const rows = screen.getAllByTestId("liquidar-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-status")).toBe("DRAFT");
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

  it("cuenta cada regla en una frase (cobra, retiene y costo de producto)", async () => {
    mount("/app/commissions/equipo/1?tab=rules");
    const cards = await screen.findAllByTestId("rule-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByTestId("rule-card-sentence").textContent).toContain("Cobra 45 %");
    expect(within(cards[0]).getByTestId("rule-card-sentence").textContent).toContain("retiene 5 %");
    const pestanas = within(cards[1]).getByTestId("rule-card-sentence").textContent ?? "";
    expect(pestanas).toMatch(/costo de producto .*20\.000/);
    expect(pestanas).toContain("para ella");
  });

  it("editar una regla muestra el ejemplo en vivo y pide cómo aplicarla", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo/1?tab=rules");
    const cards = await screen.findAllByTestId("rule-card");
    await user.click(within(cards[0]).getByTestId("rule-card-edit"));
    const paid = await screen.findByTestId("rule-paid");
    await user.clear(paid);
    await user.type(paid, "50");
    // 100.000 al 50 % = 50.000 ahora; 5 % al aguinaldo = 5.000
    expect(screen.getByTestId("example-pays").textContent).toContain("50.000");
    expect(screen.getByTestId("example-retention").textContent).toContain("5.000");
    await user.click(screen.getByTestId("rule-editor-next"));
    expect(await screen.findByTestId("commission-apply-dialog")).toBeTruthy();
  });

  it("valida que lo que se paga más lo que se retiene no pase de 100 %", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo/1?tab=rules");
    const cards = await screen.findAllByTestId("rule-card");
    await user.click(within(cards[0]).getByTestId("rule-card-edit"));
    const paid = await screen.findByTestId("rule-paid");
    await user.clear(paid);
    await user.type(paid, "98");
    await user.click(screen.getByTestId("rule-editor-next"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/100/);
    expect(screen.queryByTestId("commission-apply-dialog")).toBeNull();
  });

  it("agregar una regla ofrece solo los grupos que todavía no tiene y sugiere su retención usual", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo/1?tab=rules");
    await screen.findAllByTestId("rule-card");
    await user.click(screen.getByTestId("rule-add"));
    const select = (await screen.findByTestId("rule-add-group")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Manos"]);
    await user.click(screen.getByTestId("rule-add-confirm"));
    expect(((await screen.findByTestId("rule-retention")) as HTMLInputElement).value).toBe("5");
  });

  it("sin Aguinaldo activado el editor no ofrece retención y la ficha no muestra la solapa", async () => {
    api.getProfessionalRules.mockResolvedValue({ ...gaby, aguinaldoEnabled: false });
    const user = userEvent.setup();
    mount("/app/commissions/equipo/1?tab=rules");
    const cards = await screen.findAllByTestId("rule-card");
    expect(screen.queryByTestId("pro-tab-aguinaldo")).toBeNull();
    await user.click(within(cards[0]).getByTestId("rule-card-edit"));
    await screen.findByTestId("rule-paid");
    expect(screen.queryByTestId("rule-retention")).toBeNull();
  });

  it("quitar una regla pide cómo aplicar el cambio con valor vacío", async () => {
    const user = userEvent.setup();
    mount("/app/commissions/equipo/1?tab=rules");
    const cards = await screen.findAllByTestId("rule-card");
    await user.click(within(cards[0]).getByTestId("rule-card-remove"));
    expect(await screen.findByTestId("commission-apply-dialog")).toBeTruthy();
  });
});
