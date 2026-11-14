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
  getUngrouped: vi.fn(),
  assignGroups: vi.fn(),
  assignUngroupedToGroup: vi.fn(),
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

describe("HU-COM-12 · Por profesional", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
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

describe("HU-COM-12 · Grupos", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getGroups.mockResolvedValue([
      { id: 1, name: "Brushing", serviceCount: 2, serviceNames: ["Brushing pelo corto", "Brushing pelo largo"], professionalsWithRule: 4 },
      { id: 2, name: "Tratamiento", serviceCount: 0, serviceNames: [], professionalsWithRule: 0 },
    ]);
    api.getUngrouped.mockImplementation(async (kind: string) =>
      kind === "PRODUCT"
        ? [{ serviceId: 90, name: "Shampoo", suggestion: null }]
        : [
            { serviceId: 10, name: "Baño de crema", suggestion: { groupId: 2, groupName: "Tratamiento", reason: "bano de crema" } },
            { serviceId: 11, name: "Aplicación de ampolla", suggestion: { groupId: 2, groupName: "Tratamiento", reason: "apli" } },
            { serviceId: 12, name: "Maquillaje", suggestion: null },
          ],
    );
    api.assignGroups.mockResolvedValue({ changed: 2 });
    api.assignUngroupedToGroup.mockResolvedValue({ changed: 1 });
    api.createGroup.mockResolvedValue({ id: 3 });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lista los servicios sin grupo con la sugerencia por nombre", async () => {
    wrap(<GroupsPanel />);
    const rows = await screen.findAllByTestId("groups-ungrouped-row");
    expect(rows).toHaveLength(3);
    const suggestions = screen.getAllByTestId("groups-suggestion").map((s) => s.textContent);
    expect(suggestions[0]).toContain("Sugerido: Tratamiento · contiene «bano de crema»");
    expect(suggestions[1]).toContain("«apli»");
    expect(within(rows[2]).queryByTestId("groups-suggestion")).toBeNull();
    const groupRows = screen.getAllByTestId("group-row");
    expect(groupRows[0].textContent).toContain("2 servicios");
    expect(groupRows[0].textContent).toContain("Brushing pelo corto · Brushing pelo largo");
  });

  it("aceptar una sugerencia asigna ese servicio al grupo", async () => {
    wrap(<GroupsPanel />);
    const rows = await screen.findAllByTestId("groups-ungrouped-row");
    await userEvent.click(within(rows[0]).getByTestId("groups-accept"));
    await waitFor(() => expect(api.assignGroups).toHaveBeenCalledWith([{ serviceId: 10, groupId: 2 }]));
    expect((await screen.findByTestId("groups-notice")).textContent).toContain("Se asignó 1 servicio");
  });

  it("aceptar todas las sugerencias asigna solo los que tienen sugerencia", async () => {
    wrap(<GroupsPanel />);
    await userEvent.click(await screen.findByTestId("groups-accept-all"));
    await waitFor(() =>
      expect(api.assignGroups).toHaveBeenCalledWith([
        { serviceId: 10, groupId: 2 },
        { serviceId: 11, groupId: 2 },
      ]),
    );
  });

  it("elegir un grupo a mano asigna el servicio", async () => {
    wrap(<GroupsPanel />);
    const rows = await screen.findAllByTestId("groups-ungrouped-row");
    await userEvent.selectOptions(within(rows[2]).getByTestId("groups-choose"), "1");
    await waitFor(() => expect(api.assignGroups).toHaveBeenCalledWith([{ serviceId: 12, groupId: 1 }]));
  });

  it("crear un grupo pide el nombre y lo crea", async () => {
    wrap(<GroupsPanel />);
    await userEvent.click(await screen.findByTestId("groups-new"));
    await userEvent.click(screen.getByTestId("groups-save"));
    expect((await screen.findByText(/Ingresá el nombre del grupo, por ejemplo Brushing/)).getAttribute("role")).toBe("alert");
    expect(api.createGroup).not.toHaveBeenCalled();
    await userEvent.type(screen.getByTestId("groups-name"), "Color");
    await userEvent.click(screen.getByTestId("groups-save"));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Color"));
  });

  it("asigna todos los productos sin grupo a un solo grupo", async () => {
    wrap(<GroupsPanel />);
    const select = await screen.findByTestId("groups-products-group");
    expect((screen.getByTestId("groups-products-assign") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(select, "1");
    await userEvent.click(screen.getByTestId("groups-products-assign"));
    await waitFor(() => expect(api.assignUngroupedToGroup).toHaveBeenCalledWith(1, "PRODUCT"));
  });
});

describe("HU-COM-12 · Aguinaldo", () => {
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
