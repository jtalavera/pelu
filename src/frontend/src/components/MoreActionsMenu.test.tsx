import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MoreActionsMenu, type MoreActionsItem } from "./MoreActionsMenu";

function Harness({ items }: { items: MoreActionsItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MoreActionsMenu label="More actions" items={items} open={open} onOpenChange={setOpen} triggerTestId="t" menuTestId="m" />
      <span>outside</span>
    </>
  );
}

describe("MoreActionsMenu", () => {
  afterEach(() => cleanup());

  it("shows a labeled trigger, opens a menu of buttons and runs the picked option", async () => {
    const onEdit = vi.fn();
    render(
      <Harness
        items={[
          { id: "edit", label: "Edit", onSelect: onEdit },
          { id: "cancel", label: "Cancel", onSelect: vi.fn(), destructive: true },
        ]}
      />,
    );
    const trigger = screen.getByTestId("t");
    expect(trigger.textContent).toContain("More actions");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(trigger);
    expect(await screen.findByTestId("m")).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.getByRole("separator")).toBeTruthy();
    await userEvent.click(screen.getByTestId("more-action-edit"));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("m")).toBeNull();
  });

  it("closes with Escape and with an outside click, and skips disabled options", async () => {
    render(
      <Harness
        items={[
          { id: "a", label: "A", onSelect: vi.fn(), disabled: true },
          { id: "b", label: "B", onSelect: vi.fn() },
        ]}
      />,
    );
    await userEvent.click(screen.getByTestId("t"));
    expect(await screen.findByTestId("m")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("m")).toBeNull();
    await userEvent.click(screen.getByTestId("t"));
    expect(await screen.findByTestId("m")).toBeTruthy();
    await userEvent.click(screen.getByText("outside"));
    expect(screen.queryByTestId("m")).toBeNull();
  });
});
