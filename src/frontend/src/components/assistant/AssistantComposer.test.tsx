import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";
import {
  DictationError,
  type DictationEngine,
  type DictationErrorCode,
  type DictationHandlers,
} from "../../assistant/dictation";
import { AssistantComposer } from "./AssistantComposer";

/** A microphone the test speaks into. */
function fakeMic(startError?: DictationErrorCode) {
  const mic = {
    handlers: null as DictationHandlers | null,
    stops: 0,
    starts: 0,
    engine: (async (_language: string, handlers: DictationHandlers) => {
      if (startError) throw new DictationError(startError);
      mic.starts += 1;
      mic.handlers = handlers;
      return {
        stop: async () => {
          mic.stops += 1;
          mic.handlers = null;
        },
      };
    }) as DictationEngine,
    say: (text: string) => act(() => mic.handlers?.onPartial(text)),
    finish: (text: string) => act(() => mic.handlers?.onFinal(text)),
    fail: (code: DictationErrorCode) => act(() => mic.handlers?.onError(code)),
  };
  return mic;
}

function renderComposer(
  props?: Partial<{
    disabled: boolean;
    onSend: (t: string, mode?: "VOICE") => void;
    dictationEngine: DictationEngine;
  }>,
) {
  const onSend = props?.onSend ?? vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <AssistantComposer
        disabled={props?.disabled ?? false}
        onSend={onSend}
        dictationEngine={props?.dictationEngine}
      />
    </I18nextProvider>,
  );
  return { onSend, ...view };
}

const micButton = () => screen.getByTestId("assistant-mic") as HTMLButtonElement;
const box = () => screen.getByLabelText("Mensaje para el asistente") as HTMLTextAreaElement;

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

  // ── Dictation (HU-AST-07) ──────────────────────────────────────────────────────────────────────

  describe("dictation", () => {
    async function startListening(mic: ReturnType<typeof fakeMic>) {
      await userEvent.click(micButton());
      await waitFor(() => expect(micButton().getAttribute("aria-pressed")).toBe("true"));
      expect(mic.handlers).not.toBeNull();
    }

    it("has a microphone button, at least 44px, that says what it does", () => {
      renderComposer({ dictationEngine: fakeMic().engine });

      expect(micButton().getAttribute("aria-label")).toBe("Dictar un mensaje");
      expect(micButton().getAttribute("aria-pressed")).toBe("false");
      expect(micButton().className).toContain("min-h-11");
      expect(micButton().className).toContain("min-w-11");
    });

    it("shows what it hears in the box as it is heard, and keeps what was already typed", async () => {
      const mic = fakeMic();
      renderComposer({ dictationEngine: mic.engine });
      await userEvent.type(box(), "Hola");
      await startListening(mic);
      expect(screen.getByTestId("assistant-dictation-status").textContent).toContain("Escuchando");

      await mic.say("factura");
      expect(box().value).toBe("Hola factura");
      await mic.say("facturale a maria");
      expect(box().value).toBe("Hola facturale a maria"); // the partial is replaced, not appended
      await mic.finish("facturale a maria gomez");
      expect(box().value).toBe("Hola facturale a maria gomez ");
      await mic.say("por corte");
      expect(box().value).toBe("Hola facturale a maria gomez por corte");
    });

    it("never sends by itself: the text waits in the box until the person sends it", async () => {
      const mic = fakeMic();
      const { onSend } = renderComposer({ dictationEngine: mic.engine });
      await startListening(mic);

      await mic.finish("facturale a maria");
      await userEvent.click(micButton()); // stop

      await waitFor(() => expect(micButton().getAttribute("aria-pressed")).toBe("false"));
      expect(box().value).toBe("facturale a maria ");
      expect(onSend).not.toHaveBeenCalled();
      expect(mic.stops).toBe(1);
    });

    it("a dictated message is sent as VOICE, trimmed; the box is cleared and starts over", async () => {
      const mic = fakeMic();
      const { onSend } = renderComposer({ dictationEngine: mic.engine });
      await startListening(mic);
      await mic.finish("turnos de hoy");

      await userEvent.click(screen.getByTestId("assistant-send"));

      expect(onSend).toHaveBeenCalledWith("turnos de hoy", "VOICE");
      expect(box().value).toBe("");
      expect(mic.stops).toBe(1); // sending turns the microphone off
      // The next typed message is plain text again.
      await userEvent.type(box(), "hola{Enter}");
      expect(onSend).toHaveBeenLastCalledWith("hola");
    });

    it("an edited dictated message is still VOICE (the microphone was used for it)", async () => {
      const mic = fakeMic();
      const { onSend } = renderComposer({ dictationEngine: mic.engine });
      await startListening(mic);
      await mic.finish("facturale a mario");
      await userEvent.type(box(), "{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}maria{Enter}");

      expect(onSend).toHaveBeenCalledWith("facturale a maria", "VOICE");
    });

    it("emptying the box starts over: what is typed afterwards is plain text", async () => {
      const mic = fakeMic();
      const { onSend } = renderComposer({ dictationEngine: mic.engine });
      await startListening(mic);
      await mic.finish("algo dictado");
      await userEvent.clear(box());

      await userEvent.type(box(), "algo escrito{Enter}");

      expect(onSend).toHaveBeenCalledWith("algo escrito");
    });

    it("typing takes over from the microphone", async () => {
      const mic = fakeMic();
      renderComposer({ dictationEngine: mic.engine });
      await startListening(mic);
      await mic.say("hola");

      await userEvent.type(box(), "!");

      await waitFor(() => expect(micButton().getAttribute("aria-pressed")).toBe("false"));
      expect(mic.stops).toBe(1);
      expect(box().value).toBe("hola!");
    });

    it("turns the microphone off when the assistant starts answering", async () => {
      const mic = fakeMic();
      const { rerender } = renderComposer({ dictationEngine: mic.engine });
      await startListening(mic);

      rerender(
        <I18nextProvider i18n={i18n}>
          <AssistantComposer disabled onSend={vi.fn()} dictationEngine={mic.engine} />
        </I18nextProvider>,
      );

      await waitFor(() => expect(mic.stops).toBe(1));
      expect(micButton().disabled).toBe(true);
    });

    it("turns the microphone off when the panel is closed (unmount)", async () => {
      const mic = fakeMic();
      const { unmount } = renderComposer({ dictationEngine: mic.engine });
      await startListening(mic);

      unmount();

      expect(mic.stops).toBe(1);
    });

    it.each([
      ["MIC_DENIED", "Se denegó el acceso al micrófono"],
      ["MIC_UNAVAILABLE", "No se encontró un micrófono"],
      ["UNAVAILABLE", "no está disponible"],
      ["UNSUPPORTED", "no permite dictar"],
      ["NETWORK", "perdió la conexión"],
    ] as const)("a %s error when starting is translated and keeps the text", async (code, copy) => {
      const mic = fakeMic(code);
      renderComposer({ dictationEngine: mic.engine });
      await userEvent.type(box(), "ya escrito");

      await userEvent.click(micButton());

      expect((await screen.findByTestId("assistant-dictation-error")).textContent).toContain(copy);
      expect(box().value).toBe("ya escrito");
      expect(micButton().getAttribute("aria-pressed")).toBe("false");
    });

    it("a failure while listening is translated, ends the session, and keeps what was heard", async () => {
      const mic = fakeMic();
      renderComposer({ dictationEngine: mic.engine });
      await startListening(mic);
      await mic.finish("medio dicho");

      await mic.fail("NETWORK");

      expect(screen.getByTestId("assistant-dictation-error").textContent).toContain("perdió la conexión");
      expect(micButton().getAttribute("aria-pressed")).toBe("false");
      expect(box().value).toBe("medio dicho ");
      // And it can be tried again: the error goes away.
      await userEvent.click(micButton());
      await waitFor(() => expect(mic.starts).toBe(2));
      expect(screen.queryByTestId("assistant-dictation-error")).toBeNull();
    });
  });
});
