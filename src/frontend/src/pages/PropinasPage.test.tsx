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
    // One simple line per movement: what it is (and, for a tip, whose it is).
    expect(items[0].textContent).toMatch(/Tip from Marta Benítez/);
    expect(items[1].textContent).toMatch(/Tips withdrawal/);
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
    expect(screen.getByTestId("propinas-balances-caption").textContent).toMatch(/As of today · 3 professionals/);
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
    expect(screen.getByTestId("propinas-balances-pager").textContent).toMatch(/1.?5 of 7/);
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
    // The search only shows up when the list needs paging (more than five professionals).
    const many = [
      { id: 1, fullName: "Laura", active: true },
      { id: 2, fullName: "Ana", active: true },
      { id: 3, fullName: "Rosa", active: true },
      { id: 4, fullName: "Elena", active: true },
      { id: 5, fullName: "Lucía", active: true },
      { id: 6, fullName: "Mónica", active: true },
    ];
    const manyBalances: Record<number, number> = { 1: 180000, 2: 95000, 3: 0, 4: 5000, 5: 4000, 6: 1000 };
    beforeEach(() => {
      femmeJson.mockImplementation((url: unknown) => {
        const s = String(url);
        if (s === "/api/professionals/options") return Promise.resolve(many);
        if (s.startsWith("/api/propinas/balance")) {
          const id = Number(new URL(s, "http://x").searchParams.get("professionalId"));
          return Promise.resolve({ professionalId: id, professionalName: "x", balance: manyBalances[id] ?? 0 });
        }
        if (s.startsWith("/api/propinas/report?")) return Promise.resolve(report([]));
        if (s.startsWith("/api/propinas/withdrawals?")) {
          return Promise.resolve({ content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 });
        }
        return Promise.resolve([]);
      });
    });

    it("filters the list on submit, ignoring case and accents, and totals what it shows", async () => {
      renderPage();
      await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
      // 180.000 + 95.000 + 0 + 5.000 + 4.000 + 1.000 over the six active professionals.
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/285\.000/);
      expect(screen.getByTestId("propinas-balances-caption").textContent).toMatch(/6 professionals/);

      // «luc» finds «Lucía» (accent-insensitive); «lau» would find «Laura».
      await userEvent.type(screen.getByTestId("propinas-balances-search-input"), "LUCIA{Enter}");

      expect(screen.getByTestId("propinas-card-5")).toBeTruthy();
      expect(screen.queryByTestId("propinas-card-2")).toBeNull();
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/4\.000/);
      expect(screen.getByTestId("propinas-balances-caption").textContent).toMatch(/1 of 6 professionals/);

      await userEvent.click(screen.getByTestId("propinas-balances-search-clear"));
      expect(screen.getByTestId("propinas-card-2")).toBeTruthy();
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/285\.000/);
    });

    it("says so when nobody matches and the total is Gs. 0", async () => {
      renderPage();
      await screen.findByTestId("propinas-card-1");
      await userEvent.type(screen.getByTestId("propinas-balances-search-input"), "zzz{Enter}");
      expect(screen.getByTestId("propinas-balances-no-match").textContent).toMatch(/zzz/);
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/0/);
      expect(screen.queryByTestId("propinas-card-1")).toBeNull();
    });

    it("is hidden while everybody fits on one page", async () => {
      femmeJson.mockImplementation((url: unknown) => {
        const s = String(url);
        if (s === "/api/professionals/options") return Promise.resolve(pros);
        if (s.startsWith("/api/propinas/balance")) {
          const id = Number(new URL(s, "http://x").searchParams.get("professionalId"));
          return Promise.resolve({ professionalId: id, professionalName: "x", balance: balances[id] ?? 0 });
        }
        if (s.startsWith("/api/propinas/report?")) return Promise.resolve(report([]));
        if (s.startsWith("/api/propinas/withdrawals?")) {
          return Promise.resolve({ content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 });
        }
        return Promise.resolve([]);
      });
      renderPage();
      await screen.findByTestId("propinas-card-1");
      expect(screen.queryByTestId("propinas-balances-search")).toBeNull();
      // The total and the subtitle are there regardless.
      expect(screen.getByTestId("propinas-balances-total-amount").textContent).toMatch(/275\.000/);
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
      // Simple table: the voided tip says only «Manual tip» + «Voided»; the reason is a tooltip.
      expect(voidedRow.textContent).not.toMatch(/Monto mal cargado/);
      expect(voidedRow.querySelector("td[title]")?.getAttribute("title")).toMatch(/Monto mal cargado/);
      // A voided tip has no actions left.
      expect(within(voidedRow).queryByRole("button")).toBeNull();

      const liveRow = manualRows.find((r) => r.getAttribute("data-voided") !== "true")!;
      // A live manual tip reads «Manual tip»: the note and who loaded it are not in the table.
      expect(within(liveRow).getByTestId("propinas-movement-concept").textContent).toBe("Manual tip");
      expect(liveRow.textContent).not.toMatch(/Efectivo/);
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

    it("shows tips left after issuing with how they were paid; the admin can only void them (never edit) and voided ones are struck", async () => {
      const base = femmeJson.getMockImplementation()!;
      femmeJson.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/propinas/report?")) {
          return Promise.resolve({
            ...report([]),
            rows: [
              {
                professionalId: 1,
                professionalName: "Laura",
                amount: 10000,
                clientName: "María Gómez",
                serviceDateTime: recent.toISOString(),
                lateTipId: 5,
                paymentMethod: "DEBIT_CARD",
                cardBrand: "VISA",
                invoiceNumberFormatted: "0000126",
                createdByName: "ana@demo.com",
                voided: false,
              },
              {
                professionalId: 2,
                professionalName: "Ana",
                amount: 1000,
                clientName: "María Gómez",
                serviceDateTime: wdDate.toISOString(),
                lateTipId: 6,
                paymentMethod: "CASH",
                invoiceNumberFormatted: "0000126",
                createdByName: "ana@demo.com",
                voided: true,
                voidReason: "Monto mal cargado",
                voidedByName: "admin@demo.com",
              },
            ],
          });
        }
        return base(url);
      });
      femmePostJson.mockResolvedValue({ invoiceId: 30, invoiceStatus: "ISSUED", items: [], total: 0 });
      renderPage();

      const rows = await screen.findAllByTestId("propinas-movement");
      const lateRows = rows.filter((r) =>
        within(r).queryByTestId("propinas-movement-concept")?.textContent?.includes("María Gómez"),
      );
      expect(lateRows).toHaveLength(2);
      const liveRow = lateRows.find((r) => r.getAttribute("data-voided") !== "true")!;
      const voidedRow = lateRows.find((r) => r.getAttribute("data-voided") === "true")!;

      // The detail (tooltip) says it was collected after issuing, how, the invoice and who entered it.
      const tooltip = liveRow.querySelector("td[title]")?.getAttribute("title") ?? "";
      expect(tooltip).toMatch(/Collected after issuing/);
      expect(tooltip).toMatch(/Debit card · Visa/);
      expect(tooltip).toMatch(/#0000126/);
      expect(tooltip).toMatch(/ana@demo\.com/);

      // A voided one is flagged, explained in its tooltip and has no actions left.
      expect(within(voidedRow).getByTestId("propinas-voided-tag")).toBeTruthy();
      expect(voidedRow.querySelector("td[title]")?.getAttribute("title")).toMatch(/Monto mal cargado/);
      expect(within(voidedRow).queryByRole("button")).toBeNull();

      // The live one only offers «Void»: it moved money in the cash register, so it is not editable.
      await userEvent.click(within(liveRow).getByRole("button"));
      expect(await screen.findByRole("menuitem", { name: "Void" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
      await userEvent.click(screen.getByRole("menuitem", { name: "Void" }));

      // The reason is mandatory.
      await userEvent.click(await screen.findByTestId("late-tip-void-confirm"));
      expect(screen.getByText(/Enter the reason for voiding/)).toBeTruthy();
      expect(femmePostJson).not.toHaveBeenCalled();
      await userEvent.type(screen.getByTestId("late-tip-void-reason"), "Monto mal cargado");
      await userEvent.click(screen.getByTestId("late-tip-void-confirm"));
      await waitFor(() => expect(femmePostJson).toHaveBeenCalledTimes(1));
      expect(femmePostJson.mock.calls[0][0]).toBe("/api/propinas/late/5/void");
      expect(femmePostJson.mock.calls[0][1]).toEqual({ reason: "Monto mal cargado" });
      // The list is reloaded after voiding.
      await waitFor(() => expect(calls("/api/propinas/report?").length).toBeGreaterThan(1));
    });

    it("«Agregar propina» is a button of the page header, not of the Movimientos card", async () => {
      renderPage();
      const button = await screen.findByTestId("propinas-add-manual");
      expect(button.closest('[data-testid="propinas-movements"]')).toBeNull();
      expect(button.closest("h1")).toBeNull();
      // Same row as the page title and the ⋯ menu.
      const header = screen.getByRole("heading", { level: 1 }).parentElement!;
      expect(header.contains(button)).toBe(true);
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

  it("changing the period keeps the movements on screen (dimmed) while the new ones load: no jump", async () => {
    const base = femmeJson.getMockImplementation()!;
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    femmeJson.mockImplementation((url: unknown) => {
      if (String(url).startsWith("/api/propinas/report?")) {
        calls += 1;
        // The first (initial) request answers at once; the one after picking a period waits.
        if (calls > 1) return gate.then(() => base(url));
      }
      return base(url);
    });
    renderPage();
    const table = await screen.findByTestId("propinas-table");
    expect(screen.getByTestId("propinas-movements-list").getAttribute("aria-busy")).toBe("false");

    await userEvent.click(screen.getByTestId("propinas-period-7"));

    // While the 7-day request is pending the same table is still there (not replaced by a spinner),
    // marked busy; the chip already shows the new choice.
    await waitFor(() =>
      expect(screen.getByTestId("propinas-movements-list").getAttribute("aria-busy")).toBe("true"),
    );
    expect(screen.getByTestId("propinas-table")).toBe(table);
    expect(screen.queryByText(/loading/i)).toBeNull();
    expect(screen.getByTestId("propinas-period-7").getAttribute("aria-pressed")).toBe("true");

    release();
    await waitFor(() =>
      expect(screen.getByTestId("propinas-movements-list").getAttribute("aria-busy")).toBe("false"),
    );
    expect(screen.getByTestId("propinas-table")).toBeTruthy();
  });

  describe("on a phone", () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query === "(max-width: 639px)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it("movements are a list of two-line rows (no table that overflows the screen)", async () => {
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
                clientName: "Marta Benítez",
                serviceDateTime: recent.toISOString(),
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
      renderPage();

      const cards = await screen.findByTestId("propinas-movements-cards");
      expect(screen.queryByTestId("propinas-table")).toBeNull();
      const items = within(cards).getAllByTestId("propinas-movement");
      const tip = items.find((el) => el.getAttribute("data-kind") === "tip" && el.getAttribute("data-manual") !== "true")!;
      // Line 1: what it is + the amount; line 2: date · time · professional.
      expect(within(tip).getByTestId("propinas-movement-concept").textContent).toBe("Tip from Marta Benítez");
      expect(within(tip).getByTestId("propinas-movement-amount").textContent).toMatch(/20\.000/);
      expect(tip.textContent).toMatch(/Laura/);

      const voided = items.find((el) => el.getAttribute("data-voided") === "true")!;
      expect(within(voided).getByTestId("propinas-voided-tag")).toBeTruthy();
      expect(voided.getAttribute("title")).toMatch(/Monto mal cargado/);
      // A voided manual tip has no menu.
      expect(within(voided).queryByRole("button")).toBeNull();
    });
  });
});
