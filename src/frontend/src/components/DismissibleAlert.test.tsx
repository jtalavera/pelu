import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@design-system";
import { DismissibleAlert } from "./DismissibleAlert";

function renderAlert(onDismiss = vi.fn()) {
  render(
    <ThemeProvider>
      <DismissibleAlert
        variant="destructive"
        title="Error"
        closeLabel="Close notice"
        onDismiss={onDismiss}
        data-testid="n"
      >
        Something failed
      </DismissibleAlert>
    </ThemeProvider>,
  );
  return onDismiss;
}

describe("DismissibleAlert", () => {
  afterEach(() => cleanup());

  it("shows the alert with a «×» button named by closeLabel", () => {
    renderAlert();
    expect(screen.getByTestId("n").textContent).toContain("Something failed");
    const close = screen.getByRole("button", { name: "Close notice" });
    expect(close.textContent).toBe("×");
    expect(close.getAttribute("data-testid")).toBe("n-close");
  });

  it("calls onDismiss when the «×» is pressed", async () => {
    const onDismiss = renderAlert();
    await userEvent.click(screen.getByRole("button", { name: "Close notice" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("the «×» is reachable with the keyboard", async () => {
    const onDismiss = renderAlert();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close notice" }));
    await userEvent.keyboard("{Enter}");
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
