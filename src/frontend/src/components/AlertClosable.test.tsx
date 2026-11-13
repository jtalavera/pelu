import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Alert } from "@design-system";
import i18n from "../i18n";

describe("Alert · closable (onClose)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(() => cleanup());

  it("has no «×» unless onClose is given, and then its text is still exactly the message", () => {
    render(<Alert title="Saved">Done</Alert>);
    const alert = screen.getByRole("alert");
    expect(screen.queryByRole("button")).toBeNull();
    expect(alert.textContent).toBe("SavedDone");
    expect(alert.className).not.toMatch(/\bpr-14\b/);
  });

  it("shows a «×» button with the translated default name and keeps clear of the text", () => {
    render(
      <Alert variant="success" title="Saved" onClose={vi.fn()}>
        Done
      </Alert>,
    );
    const close = screen.getByRole("button", { name: "Close notice" });
    expect(close.textContent).toBe("×");
    expect(close.getAttribute("data-testid")).toBe("alert-close");
    // The text leaves room on the right so it never runs under the button.
    expect(screen.getByRole("alert").className).toMatch(/\bpr-14\b/);
  });

  it("the default name follows the language", async () => {
    await i18n.changeLanguage("es");
    render(<Alert onClose={vi.fn()}>Listo</Alert>);
    expect(screen.getByRole("button", { name: "Cerrar aviso" })).toBeTruthy();
  });

  it("closeLabel overrides the accessible name", () => {
    render(
      <Alert onClose={vi.fn()} closeLabel="Dismiss">
        Done
      </Alert>,
    );
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close notice" })).toBeNull();
  });

  it("is a 44 px touch target", () => {
    render(<Alert onClose={vi.fn()}>Done</Alert>);
    expect(screen.getByTestId("alert-close").className).toMatch(/\bsize-11\b/);
  });

  it("calls onClose when pressed, and the screen decides when the alert goes", async () => {
    const onClose = vi.fn();
    render(<Alert onClose={onClose}>Done</Alert>);
    await userEvent.click(screen.getByRole("button", { name: "Close notice" }));
    expect(onClose).toHaveBeenCalledOnce();
    // The alert does not remove itself.
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("works with the keyboard", async () => {
    const onClose = vi.fn();
    render(<Alert onClose={onClose}>Done</Alert>);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByTestId("alert-close"));
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a controlled alert disappears once the screen stops rendering it", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? <Alert onClose={() => setOpen(false)}>Done</Alert> : <span>gone</span>;
    }
    render(<Harness />);
    await userEvent.click(screen.getByTestId("alert-close"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("gone")).toBeTruthy();
  });

  it("still forwards the rest of the props (data-testid, className)", () => {
    render(
      <Alert onClose={vi.fn()} data-testid="mine" className="mx-2">
        Done
      </Alert>,
    );
    const alert = screen.getByTestId("mine");
    expect(alert.className).toMatch(/mx-2/);
    expect(alert.querySelector('[data-testid="alert-close"]')).not.toBeNull();
  });
});
