import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert } from "@design-system";

describe("Alert (estilo A: suave con ícono)", () => {
  it.each(["info", "success", "warning", "destructive"] as const)(
    "%s shows a round coloured icon, a tinted background and no border",
    (variant) => {
      render(<Alert variant={variant}>Mensaje {variant}</Alert>);
      const alert = screen.getByRole("alert");
      expect(alert.querySelector('[data-testid="alert-icon"]')).toBeTruthy();
      expect(alert.className).toMatch(/bg-(primary|success|warning|danger)-lt/);
      expect(alert.className).not.toMatch(/\bborder\b/);
      // The text stays in the normal ink colour (not the variant colour).
      expect(alert.className).toContain("text-ink");
    },
  );

  it("the icon is drawn without text, so the alert's text is exactly the message", () => {
    render(
      <Alert variant="destructive" title="No se pudo emitir">
        La fecha no puede ser anterior a 1 año.
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("No se pudo emitir" + "La fecha no puede ser anterior a 1 año.");
    expect(screen.getByText("No se pudo emitir").className).toContain("font-extrabold");
  });

  it("the default variant has no icon", () => {
    render(<Alert>Aviso</Alert>);
    expect(screen.getByRole("alert").querySelector('[data-testid="alert-icon"]')).toBeNull();
  });

  it("a custom icon replaces the round one", () => {
    render(
      <Alert variant="info" icon={<span data-testid="mine">★</span>}>
        Con ícono propio
      </Alert>,
    );
    expect(screen.getByTestId("mine")).toBeTruthy();
    expect(screen.queryByTestId("alert-icon")).toBeNull();
  });
});
