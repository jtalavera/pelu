import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { KebabMenu } from "@design-system";

afterEach(() => cleanup());

describe("KebabMenu", () => {
  it("opens, lists items, runs the chosen action and closes", async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    const remove = vi.fn();
    render(
      <KebabMenu
        triggerAriaLabel="Acciones"
        id="row-1"
        items={[
          { id: "edit", label: "Editar", onSelect: edit },
          { id: "delete", label: "Borrar", onSelect: remove, destructive: true },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /acciones/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("menu", { name: /acciones/i })).toBeTruthy();
    });
    expect(screen.getByRole("menuitem", { name: /editar/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /borrar/i })).toBeTruthy();

    await user.click(screen.getByRole("menuitem", { name: /editar/i }));
    expect(edit).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and refocuses the trigger", async () => {
    const user = userEvent.setup();
    render(
      <KebabMenu
        triggerAriaLabel="Acciones"
        items={[{ id: "edit", label: "Editar", onSelect: () => {} }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: /acciones/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeTruthy();
    });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
