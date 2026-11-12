import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ClientTechnicalSheetForm } from "./ClientTechnicalSheetForm";

const femmeJson = vi.fn();
const femmePutJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
}));

const sheet = {
  clientId: 4,
  clientName: "ANA",
  active: true,
  notes: "Prefiere café",
  notesUpdatedAt: "2026-10-01T15:00:00Z",
  notesUpdatedBy: "LUCIA",
  colorFormula: null,
  colorFormulaUpdatedAt: null,
  colorFormulaUpdatedBy: null,
};

function renderForm() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ClientTechnicalSheetForm clientId={4} showClientName />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("ClientTechnicalSheetForm (HU-68)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    femmeJson.mockReset();
    femmePutJson.mockReset();
  });
  afterEach(() => cleanup());

  it("loads the sheet, shows who edited it and the char counter", async () => {
    femmeJson.mockResolvedValue(sheet);
    renderForm();
    expect(await screen.findByDisplayValue("Prefiere café")).toBeTruthy();
    expect(screen.getByTestId("technical-sheet-client-name").textContent).toBe("ANA");
    expect(screen.getByTestId("technical-sheet-notes-edited").textContent).toMatch(/^Editado por LUCIA · /);
    expect(screen.getByTestId("technical-sheet-color-formula-edited").textContent).toBe("");
    expect(screen.getByText("13 / 2000 caracteres")).toBeTruthy();
    expect(femmeJson).toHaveBeenCalledWith("/api/clients/4/technical-sheet");
  });

  it("blocks saving over 2000 characters with a field error", async () => {
    femmeJson.mockResolvedValue(sheet);
    renderForm();
    const formula = await screen.findByLabelText("Fórmula de color");
    await userEvent.click(formula);
    await userEvent.paste("x".repeat(2001));
    expect(screen.getByRole("alert").textContent).toContain("Máximo 2000 caracteres");
    expect((screen.getByRole("button", { name: "Guardar ficha técnica" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves and shows the success message", async () => {
    femmeJson.mockResolvedValue(sheet);
    femmePutJson.mockResolvedValue({ ...sheet, colorFormula: "7.1 + 20 vol" });
    renderForm();
    const formula = await screen.findByLabelText("Fórmula de color");
    await userEvent.type(formula, "7.1 + 20 vol");
    await userEvent.click(screen.getByRole("button", { name: "Guardar ficha técnica" }));
    await waitFor(() =>
      expect(femmePutJson).toHaveBeenCalledWith("/api/clients/4/technical-sheet", {
        notes: "Prefiere café",
        colorFormula: "7.1 + 20 vol",
      }),
    );
    expect(await screen.findByText("Ficha técnica guardada.")).toBeTruthy();
  });

  it("is read-only for an inactive client", async () => {
    femmeJson.mockResolvedValue({ ...sheet, active: false });
    renderForm();
    const notes = (await screen.findByDisplayValue("Prefiere café")) as HTMLTextAreaElement;
    expect(notes.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Guardar ficha técnica" })).toBeNull();
  });
});
