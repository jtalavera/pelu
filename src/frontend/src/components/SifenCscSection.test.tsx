import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { SifenCscSection } from "./SifenCscSection";

const femmeJsonMock = vi.fn();
const femmePostJsonMock = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
  femmePostJson: (...args: unknown[]) => femmePostJsonMock(...args),
}));

const VALID_CSC = "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6";

function row(idCsc: number, active: boolean) {
  return { idCsc, active, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z" };
}

/** Serves GET /api/sifen/csc from `rows` and GET /api/sifen/environment from `environment`. */
function mockServer(rows: ReturnType<typeof row>[], environment = "TEST") {
  femmeJsonMock.mockImplementation((url: string) => {
    if (url === "/api/sifen/csc") return Promise.resolve(rows);
    if (url === "/api/sifen/environment") return Promise.resolve({ environment });
    return Promise.resolve(undefined);
  });
}

function renderSection() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <SifenCscSection />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("SifenCscSection (per-tenant CSC)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJsonMock.mockReset();
    femmePostJsonMock.mockReset();
  });
  afterEach(() => cleanup());

  it("lists the loaded codes by padded IdCSC and never shows a secret", async () => {
    mockServer([row(1, true), row(23, false)]);
    renderSection();

    expect(await screen.findByTestId("sifen-csc-row-1")).toBeTruthy();
    expect(screen.getByTestId("sifen-csc-row-1").textContent).toContain("0001");
    expect(screen.getByTestId("sifen-csc-row-23").textContent).toContain("0023");
    // Only the inactive code offers "Use this code".
    expect(screen.queryByTestId("sifen-csc-activate-1")).toBeNull();
    expect(screen.getByTestId("sifen-csc-activate-23")).toBeTruthy();
  });

  it("warns in PRODUCTION when no CSC is loaded, and says the test CSC is used in TEST", async () => {
    mockServer([], "PRODUCTION");
    const { unmount } = renderSection();
    expect(await screen.findByTestId("sifen-csc-missing-production")).toBeTruthy();
    expect(screen.queryByTestId("sifen-csc-test-fallback")).toBeNull();
    unmount();

    mockServer([], "TEST");
    renderSection();
    expect(await screen.findByTestId("sifen-csc-test-fallback")).toBeTruthy();
    expect(screen.queryByTestId("sifen-csc-missing-production")).toBeNull();
  });

  it("validates the IdCSC and the 32-character format before calling the API", async () => {
    mockServer([]);
    renderSection();
    await screen.findByTestId("sifen-csc-empty");

    await userEvent.type(screen.getByLabelText(/IdCSC \(assigned/i), "0");
    await userEvent.type(screen.getByLabelText(/CSC \(32 characters\)/i), "TOO-SHORT");
    await userEvent.click(screen.getByRole("button", { name: "Save security code" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent).join(" ")).toContain("between 1 and 9999 (e.g. 1)");
    expect(alerts.map((a) => a.textContent).join(" ")).toContain("exactly 32 letters or digits");
    expect(femmePostJsonMock).not.toHaveBeenCalled();
  });

  it("saves the code, clears the secret from the form and reloads the list", async () => {
    mockServer([]);
    femmePostJsonMock.mockResolvedValue(row(7, true));
    renderSection();
    await screen.findByTestId("sifen-csc-empty");

    mockServer([row(7, true)]);
    const csc = screen.getByLabelText(/CSC \(32 characters\)/i) as HTMLInputElement;
    expect(csc.type).toBe("password");
    await userEvent.type(screen.getByLabelText(/IdCSC \(assigned/i), "7");
    await userEvent.type(csc, VALID_CSC);
    await userEvent.click(screen.getByRole("button", { name: "Save security code" }));

    await waitFor(() => {
      expect(femmePostJsonMock).toHaveBeenCalledWith("/api/sifen/csc", {
        idCsc: 7,
        csc: VALID_CSC,
      });
    });
    expect((await screen.findByTestId("sifen-csc-saved")).textContent).toContain("0007");
    expect(csc.value).toBe("");
    expect(await screen.findByTestId("sifen-csc-row-7")).toBeTruthy();
  });

  it("activates another code", async () => {
    mockServer([row(1, true), row(2, false)]);
    femmePostJsonMock.mockResolvedValue(row(2, true));
    renderSection();

    await userEvent.click(await screen.findByTestId("sifen-csc-activate-2"));

    await waitFor(() => {
      expect(femmePostJsonMock).toHaveBeenCalledWith("/api/sifen/csc/2/activate", {});
    });
  });
});
