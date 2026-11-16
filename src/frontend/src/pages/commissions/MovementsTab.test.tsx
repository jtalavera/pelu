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
  entry(4, "2026-11-14T10:00:00Z", { professionalName: "Abby", itemName: "MANOS", percentApplied: 20, retentionPercent: 0, retentionAmount: 0, commissionAmount: 20000, invoiceNumber: "0001100" }),
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

describe("HU-COM-23 · Movimientos", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    api.getEntries.mockResolvedValue(entries);
    api.getProfessionals.mockResolvedValue([]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const ids = () => screen.getAllByTestId("movement-row").map((r) => r.textContent ?? "");

  it("sale de lo más reciente a lo más antiguo; a igual hora, lo último registrado arriba (la reversión sobre su línea)", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    const rows = screen.getAllByTestId("movement-row");
    expect(rows).toHaveLength(4);
    // Newest first: the line registered last (45 %), the reversal, the first line, then the older day.
    expect(rows[0].textContent).toContain("Gs. 45.000");
    expect(rows[1].textContent).toContain("Gs. -40.000");
    expect(rows[2].textContent).toContain("Gs. 40.000");
    expect(rows[3].textContent).toContain("MANOS");
    expect((screen.getByTestId("movements-sort") as HTMLSelectElement).value).toBe("desc");
  });

  it("«Ordenar» invierte la lista y vuelve a la primera página", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId("movement-row");
    await user.selectOptions(screen.getByTestId("movements-sort"), "asc");
    const rows = screen.getAllByTestId("movement-row");
    expect(rows[0].textContent).toContain("MANOS");
    expect(rows[3].textContent).toContain("Gs. 45.000");
    expect(within(screen.getByTestId("movements-sort")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Más recientes primero", "Más antiguos primero"]);
  });

  it("con retención dice «Servicio 50 % → se paga 45 % · aguinaldo 5 % (Gs. 5.000)» y no repite el % suelto", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    const text = ids()[0].replace(/\s/g, " ");
    expect(text).toContain("Servicio 50 % → se paga 45 % · aguinaldo 5 % (Gs. 5.000)");
    expect(text).not.toContain("Retención");
    expect(text).not.toContain("Comisión · 45 %");
    // The reversal shows its negative retention.
    expect(ids()[1].replace(/\s/g, " ")).toContain("Servicio 45 % → se paga 40 % · aguinaldo 5 % (Gs. -5.000)");
  });

  it("sin retención sigue diciendo solo la comisión y su %", async () => {
    mount();
    await screen.findAllByTestId("movement-row");
    const text = ids()[3].replace(/\s/g, " ");
    expect(text).toContain("Comisión · 20 %");
    expect(text).not.toContain("→");
  });
});
