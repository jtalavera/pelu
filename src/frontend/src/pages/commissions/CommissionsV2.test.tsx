import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import { AguinaldoTab } from "./AguinaldoTab";

const api = vi.hoisted(() => ({
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
