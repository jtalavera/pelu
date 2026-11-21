import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";
import { AssistantComposer } from "./AssistantComposer";

function renderComposer(props?: Partial<{ disabled: boolean; onSend: (t: string) => void }>) {
  const onSend = props?.onSend ?? vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <AssistantComposer disabled={props?.disabled ?? false} onSend={onSend} />
    </I18nextProvider>,
  );
  return { onSend };
}

describe("AssistantComposer", () => {
  beforeEach(() => {
    void i18n.changeLanguage("es");
  });
  afterEach(cleanup);

  it("sends on Enter and clears the box", async () => {
    const { onSend } = renderComposer();
    const input = screen.getByLabelText("Mensaje para el asistente");

    await userEvent.type(input, "¿Qué turnos hay hoy?{Enter}");

    expect(onSend).toHaveBeenCalledWith("¿Qué turnos hay hoy?");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("sends with the submit button too", async () => {
    const { onSend } = renderComposer();

    await userEvent.type(screen.getByLabelText("Mensaje para el asistente"), "hola");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(onSend).toHaveBeenCalledWith("hola");
  });

  it("Shift+Enter adds a line break instead of sending", async () => {
    const { onSend } = renderComposer();
    const input = screen.getByLabelText("Mensaje para el asistente") as HTMLTextAreaElement;

    await userEvent.type(input, "uno{Shift>}{Enter}{/Shift}dos");

    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("uno\ndos");
  });

  it("does not send an empty or blank message, and the button stays disabled", async () => {
    const { onSend } = renderComposer();
    const input = screen.getByLabelText("Mensaje para el asistente");

    await userEvent.type(input, "   {Enter}");

    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("cannot send while the assistant is answering", async () => {
    const { onSend } = renderComposer({ disabled: true });

    await userEvent.type(screen.getByLabelText("Mensaje para el asistente"), "hola{Enter}");

    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
