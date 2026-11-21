import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";
import {
  AssistantApiError,
  type AssistantDraft,
  type AssistantStreamEvent,
} from "../../api/assistant";
import { AssistantProvider } from "../../assistant/AssistantContext";
import { AssistantButton } from "./AssistantButton";
import { AssistantPanel } from "./AssistantPanel";

let flagOn = true;
vi.mock("../../hooks/useFeatureFlags", () => ({
  useFeatureFlag: (key: string) => key === "ASSISTANT_CHATBOT" && flagOn,
}));

const api = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  startNew: vi.fn(),
  stream: vi.fn(),
  confirm: vi.fn(),
  discard: vi.fn(),
  complete: vi.fn(),
}));
vi.mock("../../api/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/assistant")>()),
  getCurrentAssistantConversation: api.getCurrent,
  startAssistantConversation: api.startNew,
  streamAssistantMessage: api.stream,
  confirmAssistantDraft: api.confirm,
  discardAssistantDraft: api.discard,
  completeAssistantDraft: api.complete,
}));

type StreamScript = (emit: (e: AssistantStreamEvent) => void) => Promise<void> | void;

/** The answer of the next message: the script emits events, like the SSE stream would. */
function scriptAnswer(script: StreamScript) {
  api.stream.mockImplementationOnce(
    async (_req: unknown, onEvent: (e: AssistantStreamEvent) => void) => script(onEvent),
  );
}

/** jsdom has no layout: make `(min-width: Npx)` queries answer for a viewport this wide. */
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    const matches = m ? width >= Number(m[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

function renderAssistant(path = "/app/hoy") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <AssistantProvider>
          <AssistantButton isPhone={false} />
          <AssistantPanel />
        </AssistantProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

async function openPanel() {
  await userEvent.click(screen.getByTestId("topbar-assistant"));
  await screen.findByTestId("assistant-panel");
}

async function ask(text: string) {
  await userEvent.type(screen.getByTestId("assistant-input"), `${text}{Enter}`);
}

describe("Assistant (provider + button + panel)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("es");
    flagOn = true;
    setViewport(1280);
    api.getCurrent.mockResolvedValue({ conversationId: 5, messages: [] });
    api.startNew.mockResolvedValue({ conversationId: 6, messages: [] });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    api.stream.mockReset();
    api.confirm.mockReset();
    api.discard.mockReset();
    api.complete.mockReset();
  });

  it("does not exist when the feature flag is off: no button, no panel, no shortcut", async () => {
    flagOn = false;
    renderAssistant();

    expect(screen.queryByTestId("topbar-assistant")).toBeNull();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
    expect(api.getCurrent).not.toHaveBeenCalled();
  });

  it("opens from the topbar button with a welcome and tappable suggestions", async () => {
    renderAssistant();
    expect(screen.queryByTestId("assistant-panel")).toBeNull();

    await openPanel();

    expect(screen.getByTestId("assistant-welcome")).toBeTruthy();
    expect(screen.getAllByTestId("assistant-suggestion")).toHaveLength(3);
    expect(screen.getByTestId("topbar-assistant").getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles with Ctrl+K and Cmd+K", async () => {
    renderAssistant();

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(await screen.findByTestId("assistant-panel")).toBeTruthy();
    await userEvent.keyboard("{Control>}k{/Control}");
    await waitFor(() => expect(screen.queryByTestId("assistant-panel")).toBeNull());
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByTestId("assistant-panel")).toBeTruthy();
  });

  it("restores the history of the current conversation when it opens", async () => {
    api.getCurrent.mockResolvedValue({
      conversationId: 5,
      messages: [
        { id: 1, role: "USER", content: "¿Qué turnos hay hoy?", inputMode: "TEXT", createdAt: "" },
        { id: 2, role: "ASSISTANT", content: "Hay 2 turnos.", inputMode: null, createdAt: "" },
      ],
    });
    renderAssistant();

    await openPanel();

    const bubbles = await screen.findAllByTestId("assistant-message");
    expect(bubbles.map((b) => b.getAttribute("data-role"))).toEqual(["USER", "ASSISTANT"]);
    expect(screen.queryByTestId("assistant-welcome")).toBeNull();
    expect(screen.getByText(/Hay 2 turnos\./)).toBeTruthy();
  });

  it("streams the answer, shows the tool being run, and sends the screen as context", async () => {
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    scriptAnswer(async (emit) => {
      emit({ type: "tool.status", tool: "turnos_del_dia", state: "running" });
      await gate;
      emit({ type: "tool.status", tool: "turnos_del_dia", state: "done" });
      emit({ type: "message.delta", text: "Hay " });
      emit({ type: "message.delta", text: "2 turnos." });
      emit({ type: "message.done", messageId: 9 });
    });
    renderAssistant("/app/hoy");
    await openPanel();

    await ask("¿Qué turnos hay hoy?");

    expect((await screen.findByTestId("assistant-tool-status")).textContent).toBe(
      "Revisando la agenda…",
    );
    // While the assistant answers the box is locked.
    expect((screen.getByTestId("assistant-send") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => finish());

    await waitFor(() => expect(screen.getByText(/Hay 2 turnos\./)).toBeTruthy());
    expect(screen.queryByTestId("assistant-tool-status")).toBeNull();
    expect(api.stream).toHaveBeenCalledWith(
      { conversationId: 5, text: "¿Qué turnos hay hoy?", inputMode: "TEXT", currentPage: "hoy" },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    const bubbles = screen.getAllByTestId("assistant-message");
    expect(bubbles.map((b) => b.getAttribute("data-role"))).toEqual(["USER", "ASSISTANT"]);
  });

  it("tapping a suggestion sends it as the message", async () => {
    scriptAnswer((emit) => {
      emit({ type: "message.delta", text: "Servicios: Corte." });
      emit({ type: "message.done", messageId: 1 });
    });
    renderAssistant();
    await openPanel();

    await userEvent.click(screen.getByText("¿Qué servicios tenemos?"));

    await waitFor(() => expect(screen.getByText(/Servicios: Corte\./)).toBeTruthy());
    expect(api.stream.mock.calls[0][0].text).toBe("¿Qué servicios tenemos?");
  });

  it("translates an error of the stream, in the bubble that failed", async () => {
    scriptAnswer((emit) => emit({ type: "error", code: "ASSISTANT_MODEL_UNAVAILABLE" }));
    renderAssistant();
    await openPanel();

    await ask("hola");

    const alert = await screen.findByTestId("assistant-error");
    expect(alert.textContent).toContain("El asistente no está disponible en este momento");
    // The composer is usable again.
    await waitFor(() =>
      expect((screen.getByTestId("assistant-input") as HTMLTextAreaElement).disabled).toBe(false),
    );
  });

  it("translates a refusal before the stream starts (flag turned off meanwhile)", async () => {
    api.stream.mockRejectedValueOnce(new Error('{"error":"ASSISTANT_DISABLED"}'));
    renderAssistant();
    await openPanel();

    await ask("hola");

    expect((await screen.findByTestId("assistant-error")).textContent).toContain(
      "El asistente no está habilitado para tu salón",
    );
  });

  it("keeps the conversation when the panel is closed and opened again", async () => {
    scriptAnswer((emit) => {
      emit({ type: "message.delta", text: "Respuesta uno." });
      emit({ type: "message.done", messageId: 1 });
    });
    renderAssistant();
    await openPanel();
    await ask("pregunta uno");
    await waitFor(() => expect(screen.getByText(/Respuesta uno\./)).toBeTruthy());

    await userEvent.click(screen.getByTestId("assistant-close"));
    await waitFor(() => expect(screen.queryByTestId("assistant-panel")).toBeNull());
    await openPanel();

    expect(screen.getByText(/Respuesta uno\./)).toBeTruthy();
  });

  it("«Nueva conversación» empties the panel and starts a fresh conversation", async () => {
    scriptAnswer((emit) => {
      emit({ type: "message.delta", text: "Respuesta uno." });
      emit({ type: "message.done", messageId: 1 });
    });
    renderAssistant();
    await openPanel();
    await ask("pregunta uno");
    await waitFor(() => expect(screen.getByText(/Respuesta uno\./)).toBeTruthy());

    await userEvent.click(screen.getByTestId("assistant-new-conversation"));

    await waitFor(() => expect(screen.queryByText(/Respuesta uno\./)).toBeNull());
    expect(api.startNew).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("assistant-welcome")).toBeTruthy();
    // The next message goes to the new conversation.
    scriptAnswer((emit) => emit({ type: "message.done", messageId: 2 }));
    await ask("otra");
    await waitFor(() => expect(api.stream.mock.calls[1][0].conversationId).toBe(6));
  });

  it("locks the box while «Nueva conversación» is being created, so no message goes to the old one", async () => {
    let created: (c: { conversationId: number; messages: [] }) => void = () => {};
    api.startNew.mockReturnValueOnce(new Promise((resolve) => (created = resolve)));
    renderAssistant();
    await openPanel();

    await userEvent.click(screen.getByTestId("assistant-new-conversation"));
    await userEvent.type(screen.getByTestId("assistant-input"), "demasiado pronto{Enter}");

    expect(api.stream).not.toHaveBeenCalled();
    expect((screen.getByTestId("assistant-send") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => created({ conversationId: 6, messages: [] }));
    scriptAnswer((emit) => emit({ type: "message.done", messageId: 1 }));
    await userEvent.type(screen.getByTestId("assistant-input"), "{Enter}");

    await waitFor(() => expect(api.stream).toHaveBeenCalledTimes(1));
    expect(api.stream.mock.calls[0][0]).toMatchObject({ conversationId: 6, text: "demasiado pronto" });
  });

  // ── Drafts (phase 2): the card, drawn from the backend's draft ────────────────────────────────

  function draft(over: Partial<AssistantDraft> = {}): AssistantDraft {
    return {
      id: "d-1",
      type: "INVOICE",
      status: "DRAFT",
      createdAt: "2026-11-20T10:00:00Z",
      expiresAt: "2026-11-21T10:00:00Z",
      missing: ["PAYMENT_METHOD"],
      resultType: null,
      resultId: null,
      payload: {
        clientId: 42,
        clientName: "MARIA GOMEZ",
        receiverIdentified: false,
        lines: [
          {
            serviceId: 1,
            name: "Corte",
            quantity: 2,
            unitPrice: 55000,
            lineTotal: 110000,
            professionalId: null,
            professionalName: null,
          },
        ],
        serviceRecordId: null,
        appointmentId: null,
        paymentMethod: null,
        cardBrand: null,
        email: null,
        total: 110000,
      },
      ...over,
    };
  }

  async function proposeDraft(d: AssistantDraft = draft()) {
    scriptAnswer((emit) => {
      emit({ type: "card.draft", draft: d });
      emit({ type: "message.delta", text: "Preparé el borrador." });
      emit({ type: "message.done", messageId: 1 });
    });
    renderAssistant();
    await openPanel();
    await ask("facturale a maria");
    return screen.findByTestId("assistant-draft-card");
  }

  it("draws the proposed invoice as a draft card from the backend's data, with a formatted total", async () => {
    const card = await proposeDraft();

    expect(card.getAttribute("data-status")).toBe("DRAFT");
    expect(within(card).getByTestId("assistant-draft-client").textContent).toBe("MARIA GOMEZ");
    expect(within(card).getByTestId("assistant-draft-lines").textContent).toContain("Corte × 2");
    // Money like the rest of the app: «Gs.», point as thousands separator, no decimals.
    expect(within(card).getByTestId("assistant-draft-total").textContent).toBe("Gs. 110.000");
    expect(within(card).getByTestId("assistant-draft-lines").textContent).toContain("Gs. 110.000");
    // Missing data is completed on the card; confirming is blocked until then.
    expect(within(card).getByTestId("assistant-draft-missing").textContent).toContain("medio de pago");
    expect((within(card).getByTestId("assistant-draft-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("completes the payment method on the card and then allows confirming", async () => {
    const card = await proposeDraft();
    api.complete.mockResolvedValue(
      draft({ missing: [], payload: { ...draft().payload, paymentMethod: "CASH" } }),
    );

    await userEvent.click(within(card).getByTestId("assistant-draft-payment-CASH"));

    expect(api.complete).toHaveBeenCalledWith("d-1", { paymentMethod: "CASH" });
    await waitFor(() =>
      expect(
        (within(card).getByTestId("assistant-draft-confirm") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(within(card).getByTestId("assistant-draft-payment-CASH").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("asks for the card brand only when paying by card", async () => {
    const card = await proposeDraft();
    expect(within(card).queryByTestId("assistant-draft-brand-VISA")).toBeNull();
    api.complete.mockResolvedValue(
      draft({
        missing: ["CARD_BRAND"],
        payload: { ...draft().payload, paymentMethod: "CREDIT_CARD" },
      }),
    );

    await userEvent.click(within(card).getByTestId("assistant-draft-payment-CREDIT_CARD"));

    expect(await within(card).findByTestId("assistant-draft-brand-VISA")).toBeTruthy();
    expect(within(card).getByTestId("assistant-draft-missing").textContent).toContain("marca de la tarjeta");
  });

  it("confirming issues the invoice once and offers to view and share it", async () => {
    const ready = draft({ missing: [], payload: { ...draft().payload, paymentMethod: "CASH" } });
    const card = await proposeDraft(ready);
    api.confirm.mockResolvedValue({
      type: "INVOICE",
      invoiceId: 482,
      invoiceNumberFormatted: "0000482",
      sifenSubmissionStatus: "QUEUED",
      draft: { ...ready, status: "CONFIRMED", resultType: "INVOICE", resultId: 482 },
    });

    await userEvent.click(within(card).getByTestId("assistant-draft-confirm"));

    await waitFor(() => expect(card.getAttribute("data-status")).toBe("CONFIRMED"));
    expect(api.confirm).toHaveBeenCalledWith("d-1");
    expect(card.textContent).toContain("Factura 0000482 emitida");
    expect(within(card).getByTestId("assistant-draft-sifen")).toBeTruthy();
    expect(within(card).getByTestId("assistant-draft-view-invoice")).toBeTruthy();
    expect(within(card).getByTestId("assistant-draft-share")).toBeTruthy();
    // Done: no more confirm / discard buttons.
    expect(within(card).queryByTestId("assistant-draft-confirm")).toBeNull();
  });

  it("the second tap of a double tap shows the original result instead of an error", async () => {
    const ready = draft({ missing: [], payload: { ...draft().payload, paymentMethod: "CASH" } });
    const card = await proposeDraft(ready);
    const confirmed = { ...ready, status: "CONFIRMED" as const, resultType: "INVOICE", resultId: 482 };
    api.confirm.mockRejectedValue(
      new AssistantApiError(
        JSON.stringify({
          error: "ASSISTANT_DRAFT_ALREADY_CONFIRMED",
          draft: confirmed,
          type: "INVOICE",
          invoiceId: 482,
        }),
      ),
    );

    await userEvent.click(within(card).getByTestId("assistant-draft-confirm"));

    await waitFor(() => expect(card.getAttribute("data-status")).toBe("CONFIRMED"));
    expect(within(card).queryByTestId("assistant-draft-error")).toBeNull();
  });

  it("a price that changed is shown on the card, recalculated, asking to review before confirming again", async () => {
    const ready = draft({ missing: [], payload: { ...draft().payload, paymentMethod: "CASH" } });
    const card = await proposeDraft(ready);
    api.confirm.mockRejectedValue(
      new AssistantApiError(
        JSON.stringify({
          error: "ASSISTANT_PRICE_CHANGED",
          draft: { ...ready, payload: { ...ready.payload, total: 130000 } },
        }),
      ),
    );

    await userEvent.click(within(card).getByTestId("assistant-draft-confirm"));

    await waitFor(() => expect(within(card).getByTestId("assistant-draft-total").textContent).toBe("Gs. 130.000"));
    expect(within(card).getByTestId("assistant-draft-price-changed")).toBeTruthy();
    expect(card.getAttribute("data-status")).toBe("DRAFT");
  });

  it("an issuing error stays on the card, translated, and the draft is still confirmable", async () => {
    const ready = draft({ missing: [], payload: { ...draft().payload, paymentMethod: "CASH" } });
    const card = await proposeDraft(ready);
    api.confirm.mockRejectedValue(new AssistantApiError('{"error":"CASH_SESSION_NOT_OPEN"}'));

    await userEvent.click(within(card).getByTestId("assistant-draft-confirm"));

    const alert = await within(card).findByTestId("assistant-draft-error");
    expect(alert.textContent).not.toContain("CASH_SESSION_NOT_OPEN");
    expect(card.getAttribute("data-status")).toBe("DRAFT");
    expect((within(card).getByTestId("assistant-draft-confirm") as HTMLButtonElement).disabled).toBe(false);
  });

  it("discarding dims the card and removes its buttons", async () => {
    const card = await proposeDraft();
    api.discard.mockResolvedValue(draft({ status: "DISCARDED", missing: [] }));

    await userEvent.click(within(card).getByTestId("assistant-draft-discard"));

    await waitFor(() => expect(card.getAttribute("data-status")).toBe("DISCARDED"));
    expect(within(card).getByTestId("assistant-draft-inactive")).toBeTruthy();
    expect(within(card).queryByTestId("assistant-draft-confirm")).toBeNull();
  });

  it("a new proposal dims the previous card (card.draft.updated)", async () => {
    const first = await proposeDraft();
    scriptAnswer((emit) => {
      emit({ type: "card.draft.updated", id: "d-1", status: "SUPERSEDED" });
      emit({ type: "card.draft", draft: draft({ id: "d-2" }) });
      emit({ type: "message.done", messageId: 2 });
    });

    await ask("mejor con tintura");

    await waitFor(() => expect(screen.getAllByTestId("assistant-draft-card")).toHaveLength(2));
    expect(first.getAttribute("data-status")).toBe("SUPERSEDED");
    expect(screen.getAllByTestId("assistant-draft-card")[1].getAttribute("data-status")).toBe("DRAFT");
  });

  it("a waiting draft puts a dot on the button while the panel is closed", async () => {
    await proposeDraft();
    expect(screen.queryByTestId("assistant-pending-dot")).toBeNull();

    await userEvent.click(screen.getByTestId("assistant-close"));

    expect(await screen.findByTestId("assistant-pending-dot")).toBeTruthy();
  });

  it("redraws the cards when the conversation is reloaded, under the message they belong to", async () => {
    api.getCurrent.mockResolvedValue({
      conversationId: 5,
      messages: [
        { id: 1, role: "USER", content: "facturale a maria", inputMode: "TEXT", createdAt: "" },
        { id: 2, role: "ASSISTANT", content: "Preparé el borrador.", inputMode: null, createdAt: "" },
      ],
      drafts: [draft({ messageId: 2 })],
    });
    renderAssistant();

    await openPanel();

    const card = await screen.findByTestId("assistant-draft-card");
    const assistantMessage = screen.getAllByTestId("assistant-message")[1];
    expect(assistantMessage.contains(card)).toBe(true);
  });

  it.each([
    [1280, "docked", false],
    [900, "overlay", false],
    [390, "fullscreen", true],
  ])("at %ipx the panel is %s", async (width, layout, hasBack) => {
    setViewport(width);
    renderAssistant();

    await openPanel();

    const panel = screen.getByTestId("assistant-panel");
    expect(panel.getAttribute("data-layout")).toBe(layout);
    expect(within(panel).queryByTestId("assistant-back") !== null).toBe(hasBack);
    expect(within(panel).queryByTestId("assistant-close") !== null).toBe(!hasBack);
  });

  it("on a phone «Volver» closes the full-screen panel", async () => {
    setViewport(390);
    renderAssistant();
    await openPanel();

    await userEvent.click(screen.getByTestId("assistant-back"));

    await waitFor(() => expect(screen.queryByTestId("assistant-panel")).toBeNull());
  });
});
