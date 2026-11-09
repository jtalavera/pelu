import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import PropinasPage from "./PropinasPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();
const femmePutJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
}));

vi.mock("../api/authHeaders", () => ({ authHeaders: () => ({}) }));

/** `useMe` reads /api/me with a plain fetch: answer it with the given role. */
function stubMe(role: "ADMIN" | "PROFESSIONAL") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ userId: 1, role, email: "a@b.c" }) })),
  );
}

const pros = [
  { id: 1, fullName: "Laura", active: true },
  { id: 2, fullName: "Ana", active: true },
  { id: 3, fullName: "Rosa", active: true },
  { id: 4, fullName: "Inactiva", active: false },
];
let balances: Record<number, number>;

function report(rows: Array<{ professionalId: number; professionalName: string; amount: number; clientName: string; serviceDateTime: string }>) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    rows,
    professionalTotals: [],
    // Like the backend: grandTotal is NET — tips minus the period's withdrawals.
    grandTotal: total - 60000,
    withdrawalsTotal: 60000,
    withdrawalsByProfessional: [],
  };
}

const recent = new Date();
recent.setDate(recent.getDate() - 1);
const wdDate = new Date();
wdDate.setDate(wdDate.getDate() - 2);

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <PropinasPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

function calls(prefix: string): string[] {
  return femmeJson.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix));
}

describe("PropinasPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    femmePutJson.mockReset();
    stubMe("ADMIN");
    balances = { 1: 180000, 2: 95000, 3: 0 };
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s === "/api/professionals/options") return Promise.resolve(pros);
      if (s.startsWith("/api/propinas/balance")) {
        const id = Number(new URL(s, "http://x").searchParams.get("professionalId"));
        return Promise.resolve({ professionalId: id, professionalName: "x", balance: balances[id] ?? 0 });
      }
      if (s.startsWith("/api/propinas/report?")) {
        return Promise.resolve(
          report([
            {
              professionalId: 1,
              professionalName: "Laura",
              amount: 20000,
              clientName: "Marta Benítez",
              serviceDateTime: recent.toISOString(),
            },
          ]),
        );
      }
      if (s.startsWith("/api/propinas/withdrawals?")) {
        return Promise.resolve({
          content: [{ id: 9, professionalName: "Rosa", amount: 60000, withdrawnAt: wdDate.toISOString() }],
          page: 0,
          size: 200,
          totalElements: 1,
          totalPages: 1,
        });
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is one screen (no tabs) with a card per active professional showing the accumulated tips", async () => {
    renderPage();
    expect(await screen.findByTestId("propinas-card-1")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByTestId("propinas-card-4")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
    expect(screen.getByTestId("propinas-balance-2").textContent).toMatch(/95\.000/);
  });

  it("Withdraw is disabled when the balance is zero", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
    expect((screen.getByTestId("propinas-withdraw-3") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("propinas-withdraw-1") as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens on 30 days and the period chips reload the report", async () => {
    renderPage();
    await screen.findByTestId("propinas-card-1");
    expect(screen.getByTestId("propinas-period-30").getAttribute("aria-pressed")).toBe("true");
    const before = calls("/api/propinas/report?").length;
    await userEvent.click(screen.getByTestId("propinas-period-7"));
    expect(screen.getByTestId("propinas-period-7").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(calls("/api/propinas/report?").length).toBeGreaterThan(before));
    expect(screen.getByTestId("propinas-summary").textContent).toMatch(/in 7 days/);
  });

  it("the 'tips' figure is the gross tips of the period, not the report's net total", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("propinas-movement")).toHaveLength(2));
    // One tip of 20.000 and one withdrawal of 60.000: net is −40.000, but the tips figure stays 20.000.
    expect(screen.getByTestId("propinas-tips-total").textContent).toMatch(/Gs\. 20\.000/);
    expect(screen.getByTestId("propinas-withdrawn-total").textContent).toMatch(/Gs\. 60\.000/);
  });

  it("shows the period summary and one compact list mixing tips and withdrawals", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("propinas-movement")).toHaveLength(2));
    expect(screen.getByTestId("propinas-tips-total").textContent).toMatch(/20\.000/);
    expect(screen.getByTestId("propinas-withdrawn-total").textContent).toMatch(/60\.000/);
    const items = screen.getAllByTestId("propinas-movement");
    // Newest first: the tip (1 day ago) then the withdrawal (2 days ago).
    expect(items.map((el) => el.getAttribute("data-kind"))).toEqual(["tip", "withdrawal"]);
    expect(within(items[0]).getByText(/Marta Benítez/)).toBeTruthy();
    expect(items[1].textContent).toMatch(/Withdrawal/);
    expect(items[1].textContent).toMatch(/− Gs\. 60\.000/);
  });

  it("dates and professional filters are folded behind 'Filters' and changing them clears the period chip", async () => {
    renderPage();
    await screen.findByTestId("propinas-card-1");
    expect(screen.queryByLabelText(/date from/i)).toBeNull();
    const toggle = screen.getByTestId("propinas-filters-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.selectOptions(screen.getByLabelText(/^professional$/i), "2");
    await waitFor(() =>
      expect(calls("/api/propinas/report?").some((u) => u.includes("professionalIds=2"))).toBe(true),
    );
    // The filter belongs to «Movimientos»: the balances list is untouched and the active filter is labelled.
    expect(screen.getByTestId("propinas-card-1")).toBeTruthy();
    expect(screen.getByTestId("propinas-card-2")).toBeTruthy();
    expect(screen.getByTestId("propinas-balances-caption").textContent).toMatch(/does not change with the period/i);
    expect(screen.getByTestId("propinas-active-filter").textContent).toMatch(/Last 30 days/);
    expect(within(screen.getByTestId("propinas-movements")).getByTestId("propinas-filters-toggle")).toBeTruthy();
  });

  it("withdrawing with no open register tells the user it will be recorded on the last closed one", async () => {
    const base = femmeJson.getMockImplementation()!;
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s.startsWith("/api/cash-sessions/current")) return Promise.resolve(undefined);
      if (s.startsWith("/api/cash-sessions?")) {
        return Promise.resolve({
          content: [{ id: 14, openedAt: "2026-10-30T10:00:00Z", closedAt: "2026-10-31T22:00:00Z" }],
          page: 0,
          size: 1,
          totalElements: 1,
          totalPages: 1,
        });
      }
      return base(url);
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
    await userEvent.click(screen.getByTestId("propinas-withdraw-1"));
    const note = await screen.findByTestId("propinas-register-note");
    expect(note.textContent).toMatch(/last closed register \(#14/i);
    expect(note.textContent).toMatch(/after close/i);
  });

  it("withdrawing: validates, 'withdraw all' fills the balance, and confirming posts and shows a toast", async () => {
    femmePostJson.mockResolvedValue({
      withdrawal: { id: 10, professionalName: "Laura", amount: 180000, withdrawnAt: new Date().toISOString() },
      newBalance: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
    await userEvent.click(screen.getByTestId("propinas-withdraw-1"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("propinas-dialog-balance").textContent).toMatch(/180\.000/);

    await userEvent.click(within(dialog).getByTestId("propinas-withdraw-confirm"));
    expect(await within(dialog).findByText(/amount greater than zero/i)).toBeTruthy();

    await userEvent.type(within(dialog).getByLabelText(/amount to withdraw/i), "999999");
    await userEvent.click(within(dialog).getByTestId("propinas-withdraw-confirm"));
    expect(await within(dialog).findByText(/cannot exceed/i)).toBeTruthy();
    expect(femmePostJson).not.toHaveBeenCalled();

    balances[1] = 0;
    await userEvent.click(within(dialog).getByTestId("propinas-withdraw-all"));
    expect((within(dialog).getByLabelText(/amount to withdraw/i) as HTMLInputElement).value).toBe("180.000");
    await userEvent.click(within(dialog).getByTestId("propinas-withdraw-confirm"));
    await waitFor(() =>
      expect(femmePostJson).toHaveBeenCalledWith("/api/propinas/withdrawals", {
        professionalId: 1,
        amount: 180000,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByTestId("propinas-toast")).toBeTruthy();
    // The card refreshes: nothing left to withdraw.
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/Gs\. 0/));
    expect((screen.getByTestId("propinas-withdraw-1") as HTMLButtonElement).disabled).toBe(true);
  });

  it("movements are a table with pagination (page size + pager), not an endless list", async () => {
    const rows = Array.from({ length: 23 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - 1 - (i % 20));
      d.setMinutes(d.getMinutes() - i);
      return {
        professionalId: 1,
        professionalName: "Laura",
        amount: 10000 + i,
        clientName: `Cliente ${i}`,
        serviceDateTime: d.toISOString(),
      };
    });
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s === "/api/professionals/options") return Promise.resolve(pros);
      if (s.startsWith("/api/propinas/balance")) return Promise.resolve({ balance: 0 });
      if (s.startsWith("/api/propinas/report?")) return Promise.resolve(report(rows));
      if (s.startsWith("/api/propinas/withdrawals?")) {
        return Promise.resolve({ content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 });
      }
      return Promise.resolve([]);
    });
    renderPage();
    const table = await screen.findByTestId("propinas-table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent).filter(Boolean)).toEqual([
      "Date",
      "Concept",
      "Professional",
      "Amount",
    ]);
    await waitFor(() => expect(screen.getAllByTestId("propinas-movement")).toHaveLength(10));
    expect(screen.queryByTestId("propinas-more")).toBeNull();
    expect(screen.getByText(/^1.10 of 23$/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => expect(screen.getByText(/^11.20 of 23$/)).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => expect(screen.getAllByTestId("propinas-movement")).toHaveLength(3));
  });

  it("balances are listed most-to-withdraw first and paged five at a time", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: 10 + i, fullName: `Pro ${i}`, active: true }));
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s === "/api/professionals/options") return Promise.resolve(many);
      if (s.startsWith("/api/propinas/balance")) {
        const id = Number(new URL(s, "http://x").searchParams.get("professionalId"));
        return Promise.resolve({ professionalId: id, professionalName: "x", balance: (id - 9) * 1000 });
      }
      if (s.startsWith("/api/propinas/report?")) return Promise.resolve(report([]));
      if (s.startsWith("/api/propinas/withdrawals?")) {
        return Promise.resolve({ content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 });
      }
      return Promise.resolve([]);
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("propinas-balance-16").textContent).toMatch(/7\.000/));
    // Highest balance first (Pro 6 = 7.000), five per page, the rest on page 2.
    const cards = screen.getAllByTestId(/^propinas-card-/);
    expect(cards).toHaveLength(5);
    expect(cards[0].getAttribute("data-testid")).toBe("propinas-card-16");
    expect(screen.queryByTestId("propinas-card-10")).toBeNull();
    expect(screen.getByTestId("propinas-balances-pager").textContent).toMatch(/1.?5 of 7 professionals/);
    await userEvent.click(screen.getByTestId("propinas-balances-next"));
    await waitFor(() => expect(screen.getAllByTestId(/^propinas-card-/)).toHaveLength(2));
    expect(screen.getByTestId("propinas-card-10")).toBeTruthy();
    expect((screen.getByTestId("propinas-balances-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an empty message when there are no movements", async () => {
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s === "/api/professionals/options") return Promise.resolve(pros);
      if (s.startsWith("/api/propinas/balance")) return Promise.resolve({ balance: 0 });
      if (s.startsWith("/api/propinas/report?")) {
        return Promise.resolve({ ...report([]), withdrawalsTotal: 0 });
      }
      if (s.startsWith("/api/propinas/withdrawals?")) {
        return Promise.resolve({ content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 });
      }
      return Promise.resolve([]);
    });
    renderPage();
    expect(await screen.findByTestId("propinas-empty")).toBeTruthy();
  });

  it("loads in one go: movements stay hidden until the balances card is ready", async () => {
    let releaseBalances: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseBalances = resolve;
    });
    const base = femmeJson.getMockImplementation()!;
    femmeJson.mockImplementation((url: unknown) => {
      if (String(url).startsWith("/api/propinas/balance")) {
        return gate.then(() => base(url));
      }
      return base(url);
    });
    renderPage();
    // Report + withdrawals resolve right away, but the page must not show them on their own.
    expect(await screen.findByTestId("propinas-initial-loading")).toBeTruthy();
    await waitFor(() => expect(calls("/api/propinas/report?")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("propinas-movements")).toBeNull();
    expect(screen.queryByTestId("propinas-card-1")).toBeNull();

    releaseBalances();
    expect(await screen.findByTestId("propinas-movements")).toBeTruthy();
    // Balances and movements appear together, already sorted — no later re-ordering.
    expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/);
    expect(screen.queryByTestId("propinas-initial-loading")).toBeNull();
  });

  describe("search over the professionals' accumulated tips", () => {
    it("filters the list on submit, ignoring case and accents, and totals what it shows", async () => {
      renderPage();
      await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
      // 180.000 + 95.000 + 0 over the three active professionals.
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/275\.000/);

      await userEvent.type(screen.getByTestId("propinas-balances-search-input"), "LAU{Enter}");

      expect(screen.getByTestId("propinas-card-1")).toBeTruthy();
      expect(screen.queryByTestId("propinas-card-2")).toBeNull();
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/180\.000/);
      expect(screen.getByTestId("propinas-balances-total").textContent).toMatch(/1 of 3 professionals/);

      await userEvent.click(screen.getByTestId("propinas-balances-search-clear"));
      expect(screen.getByTestId("propinas-card-2")).toBeTruthy();
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/275\.000/);
    });

    it("says so when nobody matches and the total is Gs. 0", async () => {
      renderPage();
      await screen.findByTestId("propinas-card-1");
      await userEvent.type(screen.getByTestId("propinas-balances-search-input"), "zzz{Enter}");
      expect(screen.getByTestId("propinas-balances-no-match").textContent).toMatch(/zzz/);
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/0/);
      expect(screen.queryByTestId("propinas-card-1")).toBeNull();
    });
  });

  describe("manual tips", () => {
    it("the administrator adds one from the + of a row, with the professional preselected", async () => {
      femmePostJson.mockResolvedValue({ tip: { id: 1 }, newBalance: 200000 });
      renderPage();
      await userEvent.click(await screen.findByTestId("propinas-add-1"));

      expect((screen.getByTestId("propinas-manual-professional") as HTMLSelectElement).value).toBe("1");
      await userEvent.type(screen.getByTestId("propinas-manual-amount"), "20000");
      // 180.000 accumulated + 20.000
      expect(screen.getByTestId("propinas-manual-new-balance-amount").textContent).toMatch(/200\.000/);
      await userEvent.type(screen.getByTestId("propinas-manual-note"), "Efectivo");
      await userEvent.click(screen.getByTestId("propinas-manual-confirm"));

      await waitFor(() => expect(femmePostJson).toHaveBeenCalledTimes(1));
      const [url, body] = femmePostJson.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toBe("/api/propinas/manual");
      expect(body).toMatchObject({ professionalId: 1, amount: 20000, note: "Efectivo" });
      expect(typeof body.tippedAt).toBe("string");
      await waitFor(() => expect(screen.queryByTestId("propinas-manual-dialog")).toBeNull());
    });

    it("validates professional and amount before calling the API", async () => {
      renderPage();
      await userEvent.click(await screen.findByTestId("propinas-add-manual"));
      await userEvent.click(screen.getByTestId("propinas-manual-confirm"));
      expect(screen.getByText("Select a professional.")).toBeTruthy();
      expect(screen.getByText(/The amount must be greater than 0\. Example: 20\.000/)).toBeTruthy();
      expect(femmePostJson).not.toHaveBeenCalled();
    });

    it("shows manual tips tagged, lets the admin edit and void them, and strikes voided ones", async () => {
      const base = femmeJson.getMockImplementation()!;
      femmeJson.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/propinas/report?")) {
          return Promise.resolve({
            ...report([]),
            rows: [
              {
                professionalId: 1,
                professionalName: "Laura",
                amount: 20000,
                clientName: null,
                serviceDateTime: recent.toISOString(),
                manualTipId: 7,
                note: "Efectivo",
                createdByName: "Tania",
                voided: false,
              },
              {
                professionalId: 2,
                professionalName: "Ana",
                amount: 50000,
                clientName: null,
                serviceDateTime: wdDate.toISOString(),
                manualTipId: 8,
                note: "Error",
                createdByName: "Tania",
                voided: true,
                voidReason: "Monto mal cargado",
                voidedByName: "Tania",
              },
            ],
          });
        }
        return base(url);
      });
      femmePutJson.mockResolvedValue({ tip: { id: 7 }, newBalance: 1 });
      femmePostJson.mockResolvedValue({ tip: { id: 7 }, newBalance: 1 });
      renderPage();

      const rows = await screen.findAllByTestId("propinas-movement");
      const manualRows = rows.filter((r) => r.getAttribute("data-manual") === "true");
      expect(manualRows).toHaveLength(2);
      const voidedRow = manualRows.find((r) => r.getAttribute("data-voided") === "true")!;
      expect(within(voidedRow).getByTestId("propinas-voided-tag")).toBeTruthy();
      expect(voidedRow.textContent).toMatch(/Monto mal cargado/);
      // A voided tip has no actions left.
      expect(within(voidedRow).queryByRole("button")).toBeNull();

      const liveRow = manualRows.find((r) => r.getAttribute("data-voided") !== "true")!;
      await userEvent.click(within(liveRow).getByRole("button"));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
      expect((screen.getByTestId("propinas-manual-professional") as HTMLSelectElement).disabled).toBe(true);
      expect((screen.getByTestId("propinas-manual-amount") as HTMLInputElement).value).toBe("20.000");
      await userEvent.clear(screen.getByTestId("propinas-manual-amount"));
      await userEvent.type(screen.getByTestId("propinas-manual-amount"), "25000");
      await userEvent.click(screen.getByTestId("propinas-manual-confirm"));
      await waitFor(() => expect(femmePutJson).toHaveBeenCalledTimes(1));
      expect(femmePutJson.mock.calls[0][0]).toBe("/api/propinas/manual/7");
      expect(femmePutJson.mock.calls[0][1]).toMatchObject({ amount: 25000, note: "Efectivo" });

      await waitFor(() => expect(screen.queryByTestId("propinas-manual-dialog")).toBeNull());
      const liveRow2 = (await screen.findAllByTestId("propinas-movement")).find(
        (r) => r.getAttribute("data-manual") === "true" && r.getAttribute("data-voided") !== "true",
      )!;
      await userEvent.click(within(liveRow2).getByRole("button"));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Void" }));
      // The reason is mandatory.
      await userEvent.click(screen.getByTestId("propinas-void-confirm"));
      expect(screen.getByText(/Enter the reason for voiding/)).toBeTruthy();
      expect(femmePostJson).not.toHaveBeenCalled();
      await userEvent.type(screen.getByTestId("propinas-void-reason"), "Monto mal cargado");
      await userEvent.click(screen.getByTestId("propinas-void-confirm"));
      await waitFor(() => expect(femmePostJson).toHaveBeenCalledTimes(1));
      expect(femmePostJson.mock.calls[0][0]).toBe("/api/propinas/manual/7/void");
      expect(femmePostJson.mock.calls[0][1]).toEqual({ reason: "Monto mal cargado" });
    });

    it("a non-admin sees no way to add, edit or void tips", async () => {
      stubMe("PROFESSIONAL");
      renderPage();
      await screen.findByTestId("propinas-card-1");
      expect(screen.queryByTestId("propinas-add-1")).toBeNull();
      expect(screen.queryByTestId("propinas-add-manual")).toBeNull();
    });
  });

  it("waits for the user's role too, so the admin buttons do not pop in after the page", async () => {
    let releaseMe: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseMe = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return { ok: true, json: async () => ({ userId: 1, role: "ADMIN", email: "a@b.c" }) };
      }),
    );
    renderPage();
    expect(await screen.findByTestId("propinas-initial-loading")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("propinas-cards")).toBeNull();
    releaseMe();
    expect(await screen.findByTestId("propinas-add-1")).toBeTruthy();
  });
});
