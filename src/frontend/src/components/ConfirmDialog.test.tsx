import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ConfirmDialog } from "./ConfirmDialog";

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
