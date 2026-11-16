import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import type { EntryView } from "../../api/commissions";
import { MovementsTab } from "./MovementsTab";

const api = vi.hoisted(() => ({ getEntries: vi.fn(), getProfessionals: vi.fn() }));
vi.mock("../../api/commissions", async (orig) => ({ ...(await orig<typeof import("../../api/commissions")>()), ...api }));
vi.mock("../../api/femmeClient", () => ({ femmeJson: vi.fn(async () => []), femmePostJson: vi.fn(), femmePutJson: vi.fn() }));

const entry = (id: number, accrualAt: string, over: Partial<EntryView> = {}): EntryView =>
  ({
    id,
    professionalId: 1,
    professionalName: "Conce",
    sourceType: "INVOICE_LINE",
    revision: 1,
    reasonCode: null,
    invoiceId: 10,
    invoiceLineId: null,
    invoiceNumber: "0001160",
    serviceId: 5,
    itemName: "BRUSHING PELO CORTO",
    itemKind: "SERVICE",
    baseType: "TAX_INCLUDED",
    lineTotal: 100000,
    taxAmount: 0,
    baseAmount: 100000,
    percentApplied: 45,
    ruleOrigin: "GROUP",
    commissionAmount: 45000,
    fixedAmount: 0,
    fixedToProfessional: false,
    retentionPercent: 5,
    retentionAmount: 5000,
    accrualAt,
    reversesEntryId: null,
    settlementId: null,
    settlementStatus: null,
    reassignable: false,
    note: null,
    ...over,
  }) as EntryView;

// Returned oldest first, as the server does.
const entries = [
  entry(1, "2026-11-15T22:21:00Z", { percentApplied: 40, commissionAmount: 40000 }),
  entry(2, "2026-11-15T22:21:00Z", { sourceType: "REVERSAL", reasonCode: "RECALCULATION", percentApplied: 40, commissionAmount: -40000, retentionAmount: -5000 }),
  entry(3, "2026-11-15T22:21:00Z"),
  entry(4, "2026-11-14T10:00:00Z", { professionalName: "Abby", itemName: "MANOS", percentApplied: 20, retentionPercent: 0, retentionAmount: 0, commissionAmount: 20000, invoiceNumber: "0001100", settlementStatus: "PAID" }),
];

const mount = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter>
          <MovementsTab />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );

describe("HU-COM-23 / HU-COM-25 · Movimientos", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getEntries.mockResolvedValue(entries);
    api.getProfessionals.mockResolvedValue([]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const rows = () => screen.getAllByTestId("movement-row");
  const amounts = () => rows().map((r) => within(r).getByTestId("movement-amount").textContent);

  it("sale de lo más reciente a lo más antiguo; a igual hora, lo último registrado arriba (la reversión sobre su línea)", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    expect(rows()).toHaveLength(4);
    // Newest first: the line registered last (45 %), the reversal, the first line, then the older day.
    expect(amounts()).toEqual(["Gs. 45.000", "Gs. -40.000", "Gs. 40.000", "Gs. 20.000"]);
    expect(screen.getByTestId("movements-sort").getAttribute("data-order")).toBe("desc");
  });

  it("no hay lista «Ordenar»: se ordena tocando la columna FECHA, que invierte la lista", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId("movement-row");
    expect(screen.queryByText("Ordenar")).toBeNull();
    expect(screen.queryByText("Más recientes primero")).toBeNull();
    const head = screen.getByTestId("movements-sort");
    expect(head.textContent).toContain("Fecha");
    expect(head.getAttribute("aria-label")).toContain("más recientes primero");
    await user.click(head);
    expect(amounts()).toEqual(["Gs. 20.000", "Gs. 40.000", "Gs. -40.000", "Gs. 45.000"]);
    expect(screen.getByTestId("movements-sort").getAttribute("data-order")).toBe("asc");
    expect(screen.getByTestId("movements-sort").getAttribute("aria-label")).toContain("más antiguos primero");
    // The same order from the phone button (there are no columns there).
    await user.click(screen.getByTestId("movements-sort-mobile"));
    expect(amounts()[0]).toBe("Gs. 45.000");
  });

  it("la lista tiene columnas: fecha, ítem con comprobante, profesional, tipo, cálculo, estado y monto", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    const heads = [...screen.getByTestId("movements-head").children].map((n) => n.textContent?.replace(/[↓↑]/g, "").trim());
    expect(heads).toEqual(["Fecha", "Ítem", "Profesional", "Tipo", "Cálculo", "Estado", "Monto"]);
    const first = rows()[0];
    expect(within(first).getByTestId("movement-item").textContent).toBe("BRUSHING PELO CORTO");
    expect(within(first).getByTestId("movement-invoice").textContent).toBe("0001160");
    expect(within(first).getByTestId("movement-professional").textContent).toBe("Conce");
    expect(within(first).getByTestId("movement-type").textContent).toBe("Comisión");
    expect(within(first).getByTestId("movement-date").textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(within(rows()[1]).getByTestId("movement-type").textContent).toContain("recálculo");
  });

  it("con retención el cálculo dice «Servicio 50 % → 45 %» y debajo «Retención 5 % · Gs. 5.000»", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    const calc = within(rows()[0]).getByTestId("movement-calc");
    expect(within(calc).getByTestId("movement-calc-main").textContent?.replace(/\s/g, " ")).toBe("Servicio 50 % → 45 %");
    expect(within(calc).getByTestId("movement-calc-extra").textContent?.replace(/\s/g, " ")).toBe("Retención 5 % · Gs. 5.000");
    // The reversal shows its negative retention.
    expect(within(within(rows()[1]).getByTestId("movement-calc")).getByTestId("movement-calc-extra").textContent?.replace(/\s/g, " ")).toBe("Retención 5 % · Gs. -5.000");
  });

  it("sin retención el cálculo dice solo el % y no hay segunda línea", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    const calc = within(rows()[3]).getByTestId("movement-calc");
    expect(within(calc).getByTestId("movement-calc-main").textContent?.replace(/\s/g, " ")).toBe("20 %");
    expect(within(calc).queryByTestId("movement-calc-extra")).toBeNull();
  });

  it("el filtro «Pago» muestra Todas, Sin pagar y Pagadas con su cantidad, y vuelve a la primera página", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId("movement-row");
    expect(screen.getByTestId("movements-pay-all").textContent).toBe("Todas · 4");
    expect(screen.getByTestId("movements-pay-unpaid").textContent).toBe("Sin pagar · 3");
    expect(screen.getByTestId("movements-pay-paid").textContent).toBe("Pagadas · 1");
    expect(screen.getByTestId("movements-pay-all").getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByTestId("movements-pay-paid"));
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByTestId("movement-item").textContent).toBe("MANOS");
    expect(screen.getByTestId("movements-pay-paid").getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByTestId("movements-pay-unpaid"));
    expect(rows()).toHaveLength(3);
    expect(rows().every((r) => r.getAttribute("data-status") !== "PAID")).toBe(true);
    await user.click(screen.getByTestId("movements-pay-all"));
    expect(rows()).toHaveLength(4);
  });

  it("el pie suma lo que se ve (todas las páginas) y se recalcula con el filtro; sin retención no muestra «Retenido»", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId("movement-row");
    expect(screen.getByTestId("movements-total-amount").textContent).toBe("Gs. 65.000");
    expect(screen.getByTestId("movements-total-retained").textContent).toBe("Gs. 5.000");
    await user.click(screen.getByTestId("movements-pay-paid"));
    expect(screen.getByTestId("movements-total-amount").textContent).toBe("Gs. 20.000");
    expect(screen.queryByTestId("movements-total-retained")).toBeNull();
  });
});

/** HU-COM-29: one sale, recalculated (40 % → 50 %): the original, its reversal and the new commission. */
const sale = (over: Partial<EntryView> = {}) => entry(0, "2026-11-16T13:48:00Z", { invoiceLineId: 77, retentionPercent: 0, retentionAmount: 0, ...over });
const recalculated = [
  sale({ id: 11, percentApplied: 40, commissionAmount: 32727 }),
  sale({ id: 12, sourceType: "REVERSAL", reasonCode: "RECALCULATION", reversesEntryId: 11, percentApplied: 40, commissionAmount: -32727 }),
  sale({ id: 13, percentApplied: 50, commissionAmount: 40909, reassignable: true }),
  // Another sale with nothing special, and a voided one (its commission was reversed, nothing replaced it).
  entry(20, "2026-11-16T13:30:00Z", { invoiceLineId: 78, itemName: "CORTE", percentApplied: 50, commissionAmount: 15000, retentionPercent: 0, retentionAmount: 0, reassignable: true }),
  entry(30, "2026-11-16T12:10:00Z", { invoiceLineId: 79, itemName: "PEINADO", percentApplied: 50, commissionAmount: 12000, retentionPercent: 0, retentionAmount: 0 }),
  entry(31, "2026-11-16T12:11:00Z", { invoiceLineId: 79, itemName: "PEINADO", sourceType: "REVERSAL", reasonCode: "VOID", reversesEntryId: 30, percentApplied: 50, commissionAmount: -12000, retentionPercent: 0, retentionAmount: 0 }),
];

describe("HU-COM-29 · líneas revertidas", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getEntries.mockResolvedValue(recalculated);
    api.getProfessionals.mockResolvedValue([]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  const rows = () => screen.getAllByTestId("movement-row");

  it("una venta recalculada es UNA fila: la comisión vigente, su etiqueta y «antes 40 %»", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    expect(rows()).toHaveLength(3); // the recalculated sale, the plain one and the voided one
    const r = rows().find((x) => within(x).queryByText("BRUSHING PELO CORTO"))!;
    expect(within(r).getByTestId("movement-amount").textContent).toBe("Gs. 40.909");
    expect(within(r).getByTestId("movement-tag").textContent).toBe("Recalculada");
    expect(within(r).getByTestId("movement-calc-main").textContent).toContain("50 %");
    expect(within(r).getByTestId("movement-calc-note").textContent).toBe("antes 40 %");
    expect(within(r).queryByTestId("movement-changes")).toBeNull();
  });

  it("«Ver cambios» abre el recorrido: original (revertida) → reversión → vigente, con el neto", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId("movement-row");
    const r = rows().find((x) => within(x).queryByText("BRUSHING PELO CORTO"))!;
    const toggle = within(r).getByTestId("movement-changes-toggle");
    expect(toggle.textContent).toContain("Ver cambios · 3 filas");
    await user.click(toggle);
    const steps = within(r).getAllByTestId("movement-step");
    expect(steps.map((x) => x.getAttribute("data-kind"))).toEqual(["reverted", "reversal", "current"]);
    expect(steps[0].textContent).toContain("Comisión inicial");
    expect(steps[1].textContent).toContain("Reversión por recálculo");
    expect(steps[1].textContent).toContain("anula el paso 1");
    expect(steps[2].textContent).toContain("Comisión actual");
    expect(within(r).getAllByTestId("movement-step-amount").map((x) => x.textContent)).toEqual(["Gs. 32.727", "Gs. -32.727", "Gs. 40.909"]);
    expect(within(r).getByTestId("movement-changes-net").textContent).toBe("Neto de esta venta: Gs. 40.909.");
    await user.click(within(r).getByTestId("movement-changes-toggle"));
    expect(within(r).queryByTestId("movement-changes")).toBeNull();
  });

  it("una venta cuyo comprobante se anuló queda en Gs. 0, «Anulada» y sin comisión vigente", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId("movement-row");
    const r = rows().find((x) => within(x).queryByText("PEINADO"))!;
    expect(within(r).getByTestId("movement-tag").textContent).toBe("Anulada");
    expect(within(r).getByTestId("movement-amount").textContent).toBe("Gs. 0");
    expect(within(r).getByTestId("movement-calc-note").textContent).toBe("comprobante anulado");
    await user.click(within(r).getByTestId("movement-changes-toggle"));
    expect(within(r).getByTestId("movement-changes-net").textContent).toContain("No hay comisión vigente");
  });

  it("una venta sin cambios no tiene etiqueta ni «Ver cambios»", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    const r = rows().find((x) => within(x).queryByText("CORTE"))!;
    expect(within(r).queryByTestId("movement-tag")).toBeNull();
    expect(within(r).queryByTestId("movement-changes-toggle")).toBeNull();
  });

  it("el interruptor «Mostrar también las líneas revertidas» abre el recorrido de todas a la vez", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId("movement-row");
    expect(screen.queryAllByTestId("movement-changes")).toHaveLength(0);
    const sw = screen.getByTestId("movements-show-reversed");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await user.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByTestId("movement-changes")).toHaveLength(2);
    await user.click(sw);
    expect(screen.queryAllByTestId("movement-changes")).toHaveLength(0);
  });

  it("el pie suma el neto (la reversión resta lo anulado) y dice cuántas tuvieron cambios", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    expect(screen.getByTestId("movements-total-amount").textContent).toBe("Gs. 55.909"); // 40.909 + 15.000 + 0
    expect(screen.getByTestId("movements-changed-count").textContent).toBe("2 con cambios");
    expect(screen.getByTestId("movements-pay-all").textContent).toBe("Todas · 3");
  });
});
