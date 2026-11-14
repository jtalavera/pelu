import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import type { ConfigChange, GroupRuleRow, ProfessionalRulesView } from "../../api/commissions";
import { ProfessionalRulesPanel } from "./ProfessionalRulesPanel";
import { GroupsPanel } from "./GroupsPanel";
import { AguinaldoTab } from "./AguinaldoTab";

const api = vi.hoisted(() => ({
  getProfessionalRules: vi.fn(),
  getGroups: vi.fn(),
  getGroupServices: vi.fn(),
  getProfessionalsSummary: vi.fn(),
  assignGroups: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  deleteGroup: vi.fn(),
  getAguinaldo: vi.fn(),
  getAguinaldoDetail: vi.fn(),
  payAguinaldo: vi.fn(),
  payAguinaldoToAll: vi.fn(),
  adjustAguinaldo: vi.fn(),
}));
vi.mock("../../api/commissions", async (orig) => ({ ...(await orig<typeof import("../../api/commissions")>()), ...api }));
vi.mock("../../api/femmeClient", () => ({
  femmeJson: vi.fn(async (url: string) =>
    url.startsWith("/api/professionals")
      ? [
          { id: 1, fullName: "Gaby", active: true },
          { id: 2, fullName: "Migue", active: true },
        ]
      : [],
  ),
  femmePostJson: vi.fn(),
  femmePutJson: vi.fn(),
}));

const wrap = (ui: React.ReactElement) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>{ui}</ThemeProvider>
    </I18nextProvider>,
  );

const row = (over: Partial<GroupRuleRow>): GroupRuleRow => ({
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
    row({}),
    row({ groupId: 2, groupName: "Pestañas", serviceCount: 3, fixedAmount: 20000, fixedDestination: "PROFESSIONAL", versionId: 2 }),
    row({ groupId: 3, groupName: "Manos", ownRule: false, percent: null, retentionPercent: null, fixedAmount: null, versionId: null }),
    row({ groupId: 4, groupName: "Lavado", ownRule: false, percent: null, retentionPercent: null, fixedAmount: null, versionId: null }),
  ],
};

/** Keeps the staged changes like the Rules tab does. */
function Harness({ onChange }: { onChange: (all: ConfigChange[]) => void }) {
  const [pending, setPending] = useState<Record<string, ConfigChange>>({});
  const key = (c: Pick<ConfigChange, "scope" | "serviceId" | "professionalId" | "groupId">) =>
    `${c.scope}|${c.serviceId ?? ""}|${c.professionalId ?? ""}|${c.groupId ?? ""}`;
  return (
    <ProfessionalRulesPanel
      pending={pending}
      reloadKey={0}
      stage={(c) =>
        setPending((p) => {
          const next = { ...p, [key(c)]: c };
          onChange(Object.values(next));
          return next;
        })
      }
      unstage={(c) =>
        setPending((p) => {
          const next = { ...p };
          delete next[key(c)];
          onChange(Object.values(next));
          return next;
        })
      }
    />
  );
}

describe("HU-COM-14 · Por profesional", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getProfessionalsSummary.mockResolvedValue({
      aguinaldoEnabled: true,
      professionals: [
        { professionalId: 1, name: "Gaby", ruleCount: 2, retentionPercent: 5 },
        { professionalId: 2, name: "Migue", ruleCount: 1, retentionPercent: null },
        { professionalId: 3, name: "Norma", ruleCount: 0, retentionPercent: null },
      ],
    });
    api.getProfessionalRules.mockImplementation(async (id: number) =>
      id === 1
        ? gaby
        : { ...gaby, professionalId: 2, professionalName: "Migue", groups: [row({ groupId: 3, groupName: "Manos", percent: 45, fixedAmount: 3000 })] },
    );
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("muestra una fila por grupo con regla (se paga, retención, total, monto fijo y para quién)", async () => {
    wrap(<Harness onChange={() => {}} />);
    const rows = await screen.findAllByTestId("pro-rule-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("pro-rule-group").textContent).toContain("Brushing");
    expect((within(rows[0]).getByTestId("pro-rule-paid") as HTMLInputElement).value).toBe("45");
    expect((within(rows[0]).getByTestId("pro-rule-retention") as HTMLInputElement).value).toBe("5");
    expect(within(rows[0]).getByTestId("pro-rule-total").textContent).toContain("50");
    expect((within(rows[1]).getByTestId("pro-rule-fixed") as HTMLInputElement).value).toBe("20.000");
    expect((within(rows[1]).getByTestId("pro-rule-destination") as HTMLSelectElement).value).toBe("PROFESSIONAL");
    expect(screen.getByTestId("pro-rules-retains").textContent).toContain("Retiene 5 %");
    expect(screen.getByTestId("pro-rules-others-toggle").textContent).toContain("2 grupos más sin regla propia");
  });

  it("los demás grupos quedan plegados y al escribir un % se crea la regla con la retención de la profesional", async () => {
    const changes: ConfigChange[][] = [];
    wrap(<Harness onChange={(c) => changes.push(c)} />);
    await userEvent.click(await screen.findByTestId("pro-rules-others-toggle"));
    const others = within(screen.getByTestId("pro-rules-others")).getAllByTestId("pro-rule-row");
    expect(others).toHaveLength(2);
    await userEvent.type(within(others[0]).getByTestId("pro-rule-paid"), "45");
    const last = changes[changes.length - 1]!;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ scope: "GROUP_RULE", professionalId: 1, groupId: 3, value: "45|5|0|" });
    // The row stays where it was (and keeps focus) while typing.
    expect(within(screen.getByTestId("pro-rules-others")).getAllByTestId("pro-rule-row")).toHaveLength(2);
  });

  it("un monto fijo con destino se guarda como regla 'pago|retención|fijo|destino'", async () => {
    const changes: ConfigChange[][] = [];
    wrap(<Harness onChange={(c) => changes.push(c)} />);
    const rows = await screen.findAllByTestId("pro-rule-row");
    const fixed = within(rows[0]).getByTestId("pro-rule-fixed");
    await userEvent.type(fixed, "3000");
    await userEvent.selectOptions(within(rows[0]).getByTestId("pro-rule-destination"), "SALON");
    expect(changes[changes.length - 1]![0]).toMatchObject({ groupId: 1, value: "45|5|3000|S" });
  });

  it("si lo escrito deja la regla igual a la guardada no queda ningún cambio", async () => {
    const changes: ConfigChange[][] = [];
    wrap(<Harness onChange={(c) => changes.push(c)} />);
    const rows = await screen.findAllByTestId("pro-rule-row");
    const paid = within(rows[0]).getByTestId("pro-rule-paid");
    await userEvent.clear(paid);
    await userEvent.type(paid, "50");
    expect(changes[changes.length - 1]).toHaveLength(1);
    expect(changes[changes.length - 1]![0].value).toBe("50|5|0|");
    await userEvent.clear(paid);
    await userEvent.type(paid, "45");
    expect(changes[changes.length - 1]).toHaveLength(0);
  });

  it("valida que lo que se paga más la retención no supere 100 %", async () => {
    const changes: ConfigChange[][] = [];
    wrap(<Harness onChange={(c) => changes.push(c)} />);
    const rows = await screen.findAllByTestId("pro-rule-row");
    const paid = within(rows[0]).getByTestId("pro-rule-paid");
    await userEvent.clear(paid);
    await userEvent.type(paid, "99");
    const alert = await screen.findByText(/no puede superar 100 %/);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(within(rows[0]).getByTestId("pro-rule-paid").getAttribute("aria-invalid")).toBe("true");
    expect(changes[changes.length - 1]?.some((c) => c.groupId === 1) ?? false).toBe(false);
  });

  it("valida el monto fijo con un ejemplo de formato", async () => {
    wrap(<Harness onChange={() => {}} />);
    const rows = await screen.findAllByTestId("pro-rule-row");
    const fixed = within(rows[0]).getByTestId("pro-rule-fixed");
    await userEvent.type(fixed, "3,5");
    expect(await screen.findByText(/monto entero en guaraníes, por ejemplo 3\.000/)).toBeTruthy();
  });

  it("quitar la regla de un grupo con regla guardada deja un cambio con valor vacío", async () => {
    const changes: ConfigChange[][] = [];
    wrap(<Harness onChange={(c) => changes.push(c)} />);
    await screen.findAllByTestId("pro-rule-row");
    await userEvent.click(screen.getByRole("button", { name: "Acciones de Brushing" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Quitar regla" }));
    expect(changes[changes.length - 1]![0]).toMatchObject({ scope: "GROUP_RULE", groupId: 1, value: null });
  });

  it("el ejemplo en vivo calcula las Pestañas de Gaby: 33.500 ahora y 1.500 al aguinaldo", async () => {
    wrap(<Harness onChange={() => {}} />);
    const rows = await screen.findAllByTestId("pro-rule-row");
    await userEvent.click(within(rows[1]).getByTestId("pro-rule-group"));
    const price = screen.getByTestId("pro-rules-example-price");
    await userEvent.clear(price);
    await userEvent.type(price, "50000");
    expect(screen.getByTestId("example-base").textContent).toContain("30.000");
    expect(screen.getByTestId("example-paid").textContent).toContain("13.500");
    expect(screen.getByTestId("example-retention").textContent).toContain("1.500");
    expect(screen.getByTestId("example-pays").textContent).toContain("33.500");
    expect(screen.getByTestId("example-salon").textContent).toContain("15.000");
  });

  it("copiar reglas de otra profesional deja sus reglas propias listas para guardar", async () => {
    const changes: ConfigChange[][] = [];
    wrap(<Harness onChange={(c) => changes.push(c)} />);
    await screen.findAllByTestId("pro-rule-row");
    await userEvent.click(screen.getByTestId("pro-rules-copy"));
    await userEvent.selectOptions(await screen.findByTestId("pro-rules-copy-from"), "2");
    await userEvent.click(screen.getByTestId("pro-rules-copy-confirm"));
    await waitFor(() => expect(screen.getByTestId("pro-rules-notice").textContent).toContain("Se copió 1 regla"));
    expect(changes[changes.length - 1]![0]).toMatchObject({ groupId: 3, professionalId: 1, value: "45|5|3000|" });
  });

  it("sin retención de aguinaldo oculta la columna y lo avisa", async () => {
    api.getProfessionalRules.mockResolvedValue({ ...gaby, aguinaldoEnabled: false });
    wrap(<Harness onChange={() => {}} />);
    await screen.findAllByTestId("pro-rule-row");
    expect(screen.queryByTestId("pro-rule-retention")).toBeNull();
    expect(screen.getByTestId("pro-rules-retention-off")).toBeTruthy();
    expect(screen.queryByTestId("pro-rules-retains")).toBeNull();
  });
});

describe("HU-COM-14 · selector de profesional", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getProfessionalsSummary.mockResolvedValue({
      aguinaldoEnabled: true,
      professionals: [
        { professionalId: 1, name: "Gaby", ruleCount: 2, retentionPercent: 5 },
        { professionalId: 2, name: "Migue", ruleCount: 1, retentionPercent: null },
        { professionalId: 3, name: "Norma", ruleCount: 0, retentionPercent: null },
      ],
    });
    api.getProfessionalRules.mockImplementation(async (id: number) => ({ ...gaby, professionalId: id, professionalName: ["", "Gaby", "Migue", "Norma"][id] }));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("muestra a la profesional elegida con cuántas reglas tiene y su retención, en una sola fila", async () => {
    wrap(<Harness onChange={() => {}} />);
    expect((await screen.findByTestId("pro-rules-name")).textContent).toBe("Gaby");
    expect(screen.getByTestId("pro-rules-selector-detail").textContent).toBe("2 reglas · retiene 5 %");
    // No chips any more: the only professional controls are the selector and its arrows.
    expect(screen.queryByTestId("pro-rules-professional-1")).toBeNull();
  });

  it("el desplegable lista a todas ordenadas, con reglas por persona, y elegir una carga la suya", async () => {
    wrap(<Harness onChange={() => {}} />);
    await userEvent.click(await screen.findByTestId("pro-rules-selector-trigger"));
    const options = within(screen.getByTestId("pro-rules-dropdown")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["GAGaby2 reglas · retiene 5 %", "MIMigue1 regla", "NONormaSin reglas"]);
    await userEvent.click(screen.getByTestId("pro-rules-option-2"));
    await waitFor(() => expect(api.getProfessionalRules).toHaveBeenLastCalledWith(2));
    await waitFor(() => expect(screen.getByTestId("pro-rules-name").textContent).toBe("Migue"));
    expect(screen.queryByTestId("pro-rules-dropdown")).toBeNull();
  });

  it("busca por nombre sin tildes ni mayúsculas; Enter elige la primera coincidencia", async () => {
    wrap(<Harness onChange={() => {}} />);
    await userEvent.click(await screen.findByTestId("pro-rules-selector-trigger"));
    await userEvent.type(screen.getByTestId("pro-rules-search"), "NOR");
    expect(within(screen.getByTestId("pro-rules-dropdown")).getAllByRole("option")).toHaveLength(1);
    await userEvent.type(screen.getByTestId("pro-rules-search"), "{Enter}");
    await waitFor(() => expect(screen.getByTestId("pro-rules-name").textContent).toBe("Norma"));
    await userEvent.click(screen.getByTestId("pro-rules-selector-trigger"));
    await userEvent.type(screen.getByTestId("pro-rules-search"), "zzz");
    expect(screen.getByTestId("pro-rules-no-match").textContent).toBe("Ninguna profesional coincide.");
  });

  it("las flechas pasan a la anterior o a la siguiente y se apagan en los extremos", async () => {
    wrap(<Harness onChange={() => {}} />);
    await screen.findByTestId("pro-rules-name");
    expect((screen.getByTestId("pro-rules-prev") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByTestId("pro-rules-next"));
    await waitFor(() => expect(screen.getByTestId("pro-rules-name").textContent).toBe("Migue"));
    await userEvent.click(screen.getByTestId("pro-rules-next"));
    await waitFor(() => expect(screen.getByTestId("pro-rules-name").textContent).toBe("Norma"));
    expect((screen.getByTestId("pro-rules-next") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByTestId("pro-rules-prev"));
    await waitFor(() => expect(screen.getByTestId("pro-rules-name").textContent).toBe("Migue"));
  });

  it("la base se escribe «con IVA» (IVA en mayúsculas)", async () => {
    wrap(<Harness onChange={() => {}} />);
    await screen.findByTestId("pro-rules-name");
    expect(screen.getByText("Base de cálculo: precio con IVA.")).toBeTruthy();
  });
});

describe("HU-COM-14 · Grupos", () => {
  const svc = (serviceId: number, name: string, over: Record<string, unknown> = {}) => ({
    serviceId,
    name,
    categoryName: "Peluquería",
    price: 100000,
    groupId: null,
    groupName: null,
    suggestion: null,
    ...over,
  });
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getGroups.mockResolvedValue([
      { id: 1, name: "Brushing", serviceCount: 1, serviceNames: ["Brushing pelo corto"], professionalsWithRule: 4 },
      { id: 2, name: "Tratamiento", serviceCount: 0, serviceNames: [], professionalsWithRule: 0 },
    ]);
    api.getGroupServices.mockImplementation(async (kind: string) =>
      kind === "PRODUCT"
        ? [svc(90, "Shampoo"), svc(91, "Acondicionador")]
        : [
            svc(10, "Baño de crema", { suggestion: { groupId: 2, groupName: "Tratamiento", reason: "bano de crema" } }),
            svc(11, "Aplicación de ampolla", { suggestion: { groupId: 2, groupName: "Tratamiento", reason: "apli" } }),
            svc(12, "Maquillaje"),
            svc(13, "Brushing pelo corto", { groupId: 1, groupName: "Brushing" }),
          ],
    );
    api.assignGroups.mockResolvedValue({ changed: 2 });
    api.createGroup.mockResolvedValue({ id: 3, name: "Color" });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const rowOf = (name: string) => screen.getAllByTestId("groups-row").find((r) => r.getAttribute("data-name") === name)!;

  it("abre en «Sin grupo» con contadores y la sugerencia por nombre de cada servicio", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    expect(screen.getAllByTestId("groups-row")).toHaveLength(3);
    expect(screen.getByTestId("groups-scope-UNGROUPED").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("groups-scope-UNGROUPED").textContent).toBe("Sin grupo · 3");
    expect(screen.getByTestId("groups-scope-GROUPED").textContent).toBe("Con grupo · 1");
    expect(screen.getByTestId("groups-scope-ALL").textContent).toBe("Todos · 4");
    expect(screen.getByTestId("groups-kind-SERVICE").textContent).toBe("Servicios · 4");
    expect(screen.getByTestId("groups-kind-PRODUCT").textContent).toBe("Productos · 2");
    const suggestions = screen.getAllByTestId("groups-suggestion").map((s) => s.textContent);
    expect(suggestions[0]).toContain("Sugerido: Tratamiento · contiene «bano de crema»");
    expect(suggestions[1]).toContain("«apli»");
    expect(within(rowOf("Maquillaje")).queryByTestId("groups-suggestion")).toBeNull();
    expect(screen.getByTestId("groups-new")).toBeTruthy(); // «+ Nuevo grupo» a la vista, arriba
  });

  it("busca por nombre sin importar tildes ni mayúsculas y muestra todos con «Todos»", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    await userEvent.click(screen.getByTestId("groups-scope-ALL"));
    expect(screen.getAllByTestId("groups-row")).toHaveLength(4);
    await userEvent.type(screen.getByTestId("groups-search"), "BANO");
    expect(screen.getAllByTestId("groups-row").map((r) => r.getAttribute("data-name"))).toEqual(["Baño de crema"]);
    await userEvent.clear(screen.getByTestId("groups-search"));
    await userEvent.type(screen.getByTestId("groups-search"), "zzz");
    expect(screen.getByTestId("groups-no-matches").textContent).toContain("Ningún ítem coincide");
  });

  it("filtra por grupo y tocar un grupo de la lista filtra sus servicios", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    await userEvent.selectOptions(screen.getByTestId("groups-group-filter"), "1");
    expect(screen.getAllByTestId("groups-row").map((r) => r.getAttribute("data-name"))).toEqual(["Brushing pelo corto"]);
    await userEvent.selectOptions(screen.getByTestId("groups-group-filter"), "");
    await userEvent.click(screen.getByTestId("groups-scope-UNGROUPED"));
    expect(screen.getAllByTestId("groups-row")).toHaveLength(3);
    await userEvent.click(screen.getAllByTestId("group-open")[0]);
    expect(screen.getAllByTestId("groups-row").map((r) => r.getAttribute("data-name"))).toEqual(["Brushing pelo corto"]);
    expect((screen.getByTestId("groups-group-filter") as HTMLSelectElement).value).toBe("1");
  });

  it("aceptar una sugerencia asigna ese servicio; aceptar todas, solo las que tienen sugerencia", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    await userEvent.click(within(rowOf("Baño de crema")).getByTestId("groups-accept"));
    await waitFor(() => expect(api.assignGroups).toHaveBeenCalledWith([{ serviceId: 10, groupId: 2 }]));
    expect((await screen.findByTestId("groups-notice")).textContent).toContain("Se asignó 1 servicio");
    expect(screen.getByTestId("groups-accept-all").textContent).toBe("Aceptar las 2 sugerencias");
    await userEvent.click(screen.getByTestId("groups-accept-all"));
    await waitFor(() =>
      expect(api.assignGroups).toHaveBeenLastCalledWith([
        { serviceId: 10, groupId: 2 },
        { serviceId: 11, groupId: 2 },
      ]),
    );
  });

  it("elegir un grupo en la fila asigna; un servicio con grupo se puede quitar del grupo", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    await userEvent.selectOptions(within(rowOf("Maquillaje")).getByTestId("groups-row-select"), "1");
    await waitFor(() => expect(api.assignGroups).toHaveBeenCalledWith([{ serviceId: 12, groupId: 1 }]));
    await userEvent.click(screen.getByTestId("groups-scope-GROUPED"));
    await userEvent.selectOptions(within(rowOf("Brushing pelo corto")).getByTestId("groups-row-select"), "");
    await waitFor(() => expect(api.assignGroups).toHaveBeenLastCalledWith([{ serviceId: 13, groupId: null }]));
    expect((await screen.findByTestId("groups-notice")).textContent).toContain("Se quitó 1 ítem del grupo");
  });

  it("selecciona varios y los asigna de una vez desde la barra", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    expect(screen.queryByTestId("groups-bulk-bar")).toBeNull();
    await userEvent.click(within(rowOf("Maquillaje")).getByTestId("groups-row-check"));
    await userEvent.click(within(rowOf("Baño de crema")).getByTestId("groups-row-check"));
    expect(screen.getByTestId("groups-selected").textContent).toBe("2 seleccionados");
    expect((screen.getByTestId("groups-bulk-assign") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(screen.getByTestId("groups-bulk-select"), "2");
    await userEvent.click(screen.getByTestId("groups-bulk-assign"));
    await waitFor(() =>
      expect(api.assignGroups).toHaveBeenCalledWith([
        { serviceId: 12, groupId: 2 },
        { serviceId: 10, groupId: 2 },
      ]),
    );
    await waitFor(() => expect(screen.queryByTestId("groups-bulk-bar")).toBeNull());
  });

  it("«Seleccionar los que coinciden» marca los filtrados y «Quitar selección» los suelta", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    await userEvent.click(screen.getByTestId("groups-select-all"));
    expect(screen.getByTestId("groups-selected").textContent).toBe("3 seleccionados");
    await userEvent.click(screen.getByTestId("groups-bulk-clear"));
    expect(screen.queryByTestId("groups-bulk-bar")).toBeNull();
  });

  it("crear un grupo desde la barra lo crea y asigna los seleccionados", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    await userEvent.click(within(rowOf("Maquillaje")).getByTestId("groups-row-check"));
    await userEvent.selectOptions(screen.getByTestId("groups-bulk-select"), "__new__");
    expect((screen.getByTestId("groups-assign-selected") as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByTestId("groups-save"));
    expect((await screen.findByText(/Ingresá el nombre del grupo, por ejemplo Brushing/)).getAttribute("role")).toBe("alert");
    expect(api.createGroup).not.toHaveBeenCalled();
    await userEvent.type(screen.getByTestId("groups-name"), "Color");
    await userEvent.click(screen.getByTestId("groups-save"));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Color"));
    await waitFor(() => expect(api.assignGroups).toHaveBeenCalledWith([{ serviceId: 12, groupId: 3 }]));
    expect((await screen.findByTestId("groups-notice")).textContent).toContain("Se creó el grupo y se asignaron los seleccionados");
  });

  it("«+ Nuevo grupo» sin selección crea un grupo vacío (sin casilla de asignar)", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    await userEvent.click(screen.getByTestId("groups-new"));
    expect(screen.queryByTestId("groups-assign-selected")).toBeNull();
    await userEvent.type(screen.getByTestId("groups-name"), "Color");
    await userEvent.click(screen.getByTestId("groups-save"));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Color"));
    expect(api.assignGroups).not.toHaveBeenCalled();
  });

  it("los productos están en la misma pantalla y se asignan en lote", async () => {
    wrap(<GroupsPanel />);
    await screen.findAllByTestId("groups-row");
    await userEvent.click(screen.getByTestId("groups-kind-PRODUCT"));
    expect(screen.getAllByTestId("groups-row").map((r) => r.getAttribute("data-name"))).toEqual(["Shampoo", "Acondicionador"]);
    await userEvent.click(screen.getByTestId("groups-select-all"));
    await userEvent.selectOptions(screen.getByTestId("groups-bulk-select"), "1");
    await userEvent.click(screen.getByTestId("groups-bulk-assign"));
    await waitFor(() =>
      expect(api.assignGroups).toHaveBeenCalledWith([
        { serviceId: 90, groupId: 1 },
        { serviceId: 91, groupId: 1 },
      ]),
    );
    expect((await screen.findByTestId("groups-notice")).textContent).toContain("Se asignaron 2 productos");
  });
});

describe("HU-COM-14 · Aguinaldo", () => {
  const balance = (id: number, name: string, amount: number) => ({
    professionalId: id,
    professionalName: name,
    active: true,
    retained: amount,
    paid: 0,
    balance: amount,
    lastPaymentOn: null,
  });
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getAguinaldo.mockResolvedValue({
      enabled: true,
      totalBalance: 1_000_000,
      balances: [balance(1, "Gaby", 600_000), balance(2, "Migue", 400_000)],
    });
    api.getAguinaldoDetail.mockResolvedValue({
      professionalId: 2,
      professionalName: "Migue",
      balance: 400_000,
      movements: [
        { kind: "PAYMENT", date: "2026-12-20", concept: null, amount: -100_000, balance: 400_000, settlementId: null, movementId: 5, paymentMethod: "CASH", closesFund: false, note: null },
        { kind: "ACCRUAL", date: "2026-11-14", concept: null, amount: 500_000, balance: 500_000, settlementId: 9, movementId: null, paymentMethod: null, closesFund: false, note: "2026-11-01 – 2026-11-14" },
      ],
    });
    api.payAguinaldo.mockResolvedValue({});
    api.payAguinaldoToAll.mockResolvedValue({ paid: 2 });
    api.adjustAguinaldo.mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("muestra el total del fondo y el saldo de cada profesional", async () => {
    wrap(<AguinaldoTab />);
    expect((await screen.findByTestId("aguinaldo-total")).textContent).toContain("1.000.000");
    expect(screen.getByTestId("aguinaldo-count").textContent).toBe("2");
    const rows = screen.getAllByTestId("aguinaldo-row");
    expect(rows[0].textContent).toContain("Gaby");
    expect(within(rows[0]).getByTestId("aguinaldo-balance").textContent).toContain("600.000");
  });

  it("avisa cuando la retención está desactivada", async () => {
    api.getAguinaldo.mockResolvedValue({ enabled: false, totalBalance: 0, balances: [] });
    wrap(<AguinaldoTab />);
    expect(await screen.findByTestId("aguinaldo-off")).toBeTruthy();
    expect(screen.getByTestId("aguinaldo-empty")).toBeTruthy();
    expect(screen.queryByTestId("aguinaldo-pay-all")).toBeNull();
  });

  it("los movimientos muestran la liquidación y el pago con su saldo", async () => {
    wrap(<AguinaldoTab />);
    const rows = await screen.findAllByTestId("aguinaldo-row");
    await userEvent.click(within(rows[1]).getByTestId("aguinaldo-view"));
    const moves = await screen.findAllByTestId("aguinaldo-movement");
    expect(moves[0].textContent).toContain("Pago de aguinaldo");
    expect(within(moves[0]).getByTestId("aguinaldo-movement-amount").textContent).toContain("100.000");
    expect(moves[1].textContent).toContain("Liquidación");
    expect(within(moves[1]).getByTestId("aguinaldo-movement-balance").textContent).toContain("500.000");
  });

  it("un pago parcial mayor al saldo se rechaza con el saldo en el mensaje", async () => {
    wrap(<AguinaldoTab />);
    const rows = await screen.findAllByTestId("aguinaldo-row");
    await userEvent.click(within(rows[1]).getByTestId("aguinaldo-pay"));
    await userEvent.click(await screen.findByTestId("aguinaldo-mode-PARTIAL"));
    await userEvent.type(screen.getByTestId("aguinaldo-amount"), "500000");
    await userEvent.click(screen.getByTestId("aguinaldo-pay-confirm"));
    expect(await screen.findByText(/no puede superar el saldo \(Gs\. 400\.000\)/)).toBeTruthy();
    expect(api.payAguinaldo).not.toHaveBeenCalled();
  });

  it("registra un pago parcial y uno por salida de la profesional", async () => {
    wrap(<AguinaldoTab />);
    const rows = await screen.findAllByTestId("aguinaldo-row");
    await userEvent.click(within(rows[1]).getByTestId("aguinaldo-pay"));
    await userEvent.click(await screen.findByTestId("aguinaldo-mode-PARTIAL"));
    await userEvent.type(screen.getByTestId("aguinaldo-amount"), "150000");
    expect(screen.getByTestId("aguinaldo-balance-after").textContent).toContain("250.000");
    await userEvent.click(screen.getByTestId("aguinaldo-pay-confirm"));
    await waitFor(() =>
      expect(api.payAguinaldo).toHaveBeenCalledWith(
        expect.objectContaining({ professionalId: 2, amount: 150000, closesFund: false, paymentMethod: "CASH" }),
      ),
    );
    await userEvent.click(within((await screen.findAllByTestId("aguinaldo-row"))[0]).getByTestId("aguinaldo-pay"));
    await userEvent.click(await screen.findByTestId("aguinaldo-closes"));
    await userEvent.click(screen.getByTestId("aguinaldo-pay-confirm"));
    await waitFor(() =>
      expect(api.payAguinaldo).toHaveBeenLastCalledWith(
        expect.objectContaining({ professionalId: 1, amount: null, closesFund: true }),
      ),
    );
  });

  it("paga el saldo completo a todas con un solo botón", async () => {
    wrap(<AguinaldoTab />);
    await userEvent.click(await screen.findByTestId("aguinaldo-pay-all"));
    await userEvent.click(await screen.findByTestId("aguinaldo-pay-all-confirm"));
    await waitFor(() => expect(api.payAguinaldoToAll).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: "CASH" })));
    expect((await screen.findByTestId("aguinaldo-notice")).textContent).toContain("Se registraron los pagos a 2 profesionales");
  });

  it("el ajuste manual pide un monto entero y un motivo", async () => {
    wrap(<AguinaldoTab />);
    const rows = await screen.findAllByTestId("aguinaldo-row");
    await userEvent.click(within(rows[1]).getByTestId("aguinaldo-view"));
    await userEvent.click(await screen.findByTestId("aguinaldo-adjust"));
    await userEvent.type(screen.getByTestId("aguinaldo-adjust-amount"), "0");
    await userEvent.click(screen.getByTestId("aguinaldo-adjust-confirm"));
    expect(await screen.findByText(/monto entero distinto de 0, por ejemplo -2\.350 o 5\.000/)).toBeTruthy();
    await userEvent.clear(screen.getByTestId("aguinaldo-adjust-amount"));
    await userEvent.type(screen.getByTestId("aguinaldo-adjust-amount"), "-2.350");
    await userEvent.click(screen.getByTestId("aguinaldo-adjust-confirm"));
    expect(await screen.findByText(/Indicá el motivo del ajuste/)).toBeTruthy();
    await userEvent.type(screen.getByTestId("aguinaldo-adjust-reason"), "factura anulada");
    await userEvent.click(screen.getByTestId("aguinaldo-adjust-confirm"));
    await waitFor(() =>
      expect(api.adjustAguinaldo).toHaveBeenCalledWith({ professionalId: 2, amount: -2350, reason: "factura anulada" }),
    );
  });
});
