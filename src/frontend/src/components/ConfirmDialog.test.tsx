import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ConfirmDialog } from "./ConfirmDialog";

// Explicit cleanup between tests — `vite.config.ts` doesn't set `globals: true`/RTL's automatic
// afterEach hook, so a still-mounted component from an earlier test can otherwise leak into
// `document.body` and pollute later `getByRole`/`getByText` assertions in this file.
afterEach(() => {
  cleanup();
});

describe("ConfirmDialog", () => {
  it("renders title, description, and triggers cancel / confirm", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ConfirmDialog
            open
            title="Title"
            description="Body text"
            cancelLabel="No"
            confirmLabel="Yes"
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        </ThemeProvider>
      </I18nextProvider>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Body text")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /no/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /yes/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
