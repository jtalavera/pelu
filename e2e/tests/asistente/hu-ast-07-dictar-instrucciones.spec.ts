import { expect, test } from "@playwright/test";

import { API_BASE, authHeaders, loginAsDemoApi } from "../../fixtures/api";
import {
  assistantAnswers,
  assistantInput,
  assistantPanel,
  currentConversationApi,
  dictatedMarks,
  dictationStarts,
  enableAssistantGlobally,
  failDictation,
  failNextDictationStart,
  micButton,
  microphoneOpen,
  openAssistantPanel,
  restoreAssistantGlobal,
  speakFinal,
  speakPartial,
  startDictating,
  startNewConversationUi,
  userBubbles,
} from "../../fixtures/assistant";
import { loginAs, loginAsDemo } from "../../fixtures/auth";
import { loginApi, PASSWORD, professionalWithAccess } from "../../fixtures/commissions";

// HU-AST-07 · Dictar instrucciones al asistente
// requirements/user_stories/HU-AST-07-dictar-instrucciones.md
//
// Playwright cannot speak: the e2e build swaps Azure AI Speech for a simulated engine that the test
// drives (fixtures/assistant.ts · `window.__assistantDictation`). That covers every rule of the
// screen; the quality of the REAL recognition (microphone, accent, noise) is tested by hand.
// The UI is English here; the assistant answers in Spanish.

test.describe.configure({ mode: "serial" });

test.describe("HU-AST-07 · Dictar instrucciones al asistente", () => {
  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
  });
  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  async function open(page: import("@playwright/test").Page) {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
  }

  test("AC1 · hay un botón de micrófono junto a «Enviar», accesible y de 44 px", async ({ page }) => {
    await open(page);

    const mic = micButton(page);
    await expect(mic).toBeVisible();
    await expect(mic).toHaveAccessibleName("Dictate a message");
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    const box = (await mic.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("assistant-send")).toBeVisible();
  });

  test("AC2 · al dictar escucha y el texto parcial aparece en el campo, conservando lo ya escrito", async ({
    page,
  }) => {
    await open(page);
    await assistantInput(page).fill("Hello");

    await startDictating(page);

    await expect(micButton(page)).toHaveAccessibleName("Stop dictating");
    await expect(page.getByTestId("assistant-dictation-status")).toHaveText(/Listening/);
    await speakPartial(page, "appoint");
    await expect(assistantInput(page)).toHaveValue("Hello appoint");
    await speakPartial(page, "appointments today"); // the partial is replaced, not appended
    await expect(assistantInput(page)).toHaveValue("Hello appointments today");
    await speakFinal(page, "appointments today");
    await speakPartial(page, "and clients");
    await expect(assistantInput(page)).toHaveValue("Hello appointments today and clients");
  });

  test("AC3 · el dictado nunca envía solo: el texto queda en el campo hasta que la persona envía", async ({
    page,
    request,
  }) => {
    await open(page);
    const token = await loginAsDemoApi(request);
    const before = (await currentConversationApi(request, token)).messages.length;

    await startDictating(page);
    await speakFinal(page, "appointments today");
    await expect(assistantInput(page)).toHaveValue(/appointments today/);
    await micButton(page).click(); // stop dictating
    await expect(micButton(page)).toHaveAttribute("aria-pressed", "false");

    await expect(assistantInput(page)).toHaveValue(/appointments today/);
    await expect(userBubbles(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect((await currentConversationApi(request, token)).messages).toHaveLength(before);
  });

  test("AC4 · enviar un texto dictado lo marca «Dictated» (aunque lo haya editado) y el asistente responde", async ({
    page,
  }) => {
    await open(page);
    await startDictating(page);
    await speakFinal(page, "servicios");

    // The person reviews and corrects it before sending: still dictated.
    await assistantInput(page).fill("services");
    await page.getByTestId("assistant-send").click();

    await expect(userBubbles(page)).toHaveCount(1);
    await expect(dictatedMarks(page)).toHaveCount(1);
    await expect(dictatedMarks(page)).toHaveText("Dictated");
    await expect(assistantAnswers(page).last()).toContainText("Servicios", { timeout: 20_000 });

    // A typed message carries no mark.
    await assistantInput(page).fill("professionals");
    await assistantInput(page).press("Enter");
    await expect(userBubbles(page)).toHaveCount(2);
    await expect(assistantAnswers(page)).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByTestId("assistant-composer")).toHaveAttribute("data-busy", "false");
    await expect(dictatedMarks(page)).toHaveCount(1);
  });

  test("AC5 · al recargar y reabrir, «Dictated» sigue en los dictados y no en los escritos", async ({
    page,
    request,
  }) => {
    await open(page);
    await startDictating(page);
    await speakFinal(page, "services");
    await page.getByTestId("assistant-send").click();
    await expect(assistantAnswers(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId("assistant-composer")).toHaveAttribute("data-busy", "false");
    await assistantInput(page).fill("professionals");
    await assistantInput(page).press("Enter");
    await expect(assistantAnswers(page)).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByTestId("assistant-composer")).toHaveAttribute("data-busy", "false");

    await page.reload();
    await openAssistantPanel(page);

    await expect(userBubbles(page)).toHaveCount(2);
    await expect(dictatedMarks(page)).toHaveCount(1);
    await expect(userBubbles(page).first().locator("..").getByTestId("assistant-message-dictated")).toBeVisible();
    // The mode is saved in the conversation itself.
    const token = await loginAsDemoApi(request);
    const modes = (await currentConversationApi(request, token)).messages
      .filter((m) => m.role === "USER")
      .map((m) => m.inputMode);
    expect(modes).toEqual(["VOICE", "TEXT"]);
  });

  test("AC6 · vaciar el campo empieza de nuevo: lo que se escribe después es texto", async ({ page }) => {
    await open(page);
    await startDictating(page);
    await speakFinal(page, "something dictated");
    await assistantInput(page).fill(""); // typing takes over and the box is emptied

    await assistantInput(page).fill("services");
    await assistantInput(page).press("Enter");

    await expect(userBubbles(page)).toHaveCount(1);
    await expect(dictatedMarks(page)).toHaveCount(0);
  });

  for (const [code, copy] of [
    ["MIC_DENIED", "Microphone access was denied"],
    ["MIC_UNAVAILABLE", "No microphone was found"],
    ["UNSUPPORTED", "This browser cannot dictate"],
    ["UNAVAILABLE", "Dictation is not available right now"],
  ] as const) {
    test(`AC7 · error al iniciar (${code}): mensaje traducido, el texto se conserva y se puede escribir y reintentar`, async ({
      page,
    }) => {
      await open(page);
      await assistantInput(page).fill("already typed");
      await failNextDictationStart(page, code);

      await micButton(page).click();

      await expect(page.getByTestId("assistant-dictation-error")).toContainText(copy);
      await expect(assistantInput(page)).toHaveValue("already typed");
      await expect(micButton(page)).toHaveAttribute("aria-pressed", "false");
      expect(await microphoneOpen(page)).toBe(false);
      // Typing still works, and retrying clears the error and listens.
      await assistantInput(page).fill("already typed, more");
      await startDictating(page);
      await expect(page.getByTestId("assistant-dictation-error")).toHaveCount(0);
    });
  }

  test("AC7 · si se pierde la conexión mientras escucha: error traducido y lo dictado hasta ahí se conserva", async ({
    page,
  }) => {
    await open(page);
    await startDictating(page);
    await speakFinal(page, "appointments today");

    await failDictation(page, "NETWORK");

    await expect(page.getByTestId("assistant-dictation-error")).toContainText("Dictation lost its connection");
    await expect(micButton(page)).toHaveAttribute("aria-pressed", "false");
    expect(await microphoneOpen(page)).toBe(false);
    await expect(assistantInput(page)).toHaveValue(/appointments today/);
    // The text can still be sent.
    await assistantInput(page).press("Enter");
    await expect(userBubbles(page)).toHaveCount(1);
  });

  test("AC8 · el micrófono se apaga al enviar, al escribir, al responder el asistente y al empezar otra conversación", async ({
    page,
  }) => {
    await open(page);

    // Sending turns it off.
    await startDictating(page);
    await speakFinal(page, "services slowly");
    await page.getByTestId("assistant-send").click();
    await expect.poll(() => microphoneOpen(page)).toBe(false);
    await expect(micButton(page)).toBeDisabled(); // while the answer streams
    await expect(assistantAnswers(page).last()).toContainText("Servicios", { timeout: 20_000 });
    await expect(page.getByTestId("assistant-composer")).toHaveAttribute("data-busy", "false", { timeout: 20_000 });
    await expect(micButton(page)).toBeEnabled();

    // Typing with the keyboard takes over.
    await startDictating(page);
    await speakPartial(page, "something");
    await assistantInput(page).pressSequentially("!");
    await expect.poll(() => microphoneOpen(page)).toBe(false);
    await expect(micButton(page)).toHaveAttribute("aria-pressed", "false");

    // A new conversation too.
    await startDictating(page);
    await page.getByTestId("assistant-new-conversation").click();
    await expect.poll(() => microphoneOpen(page)).toBe(false);
  });

  test("AC8 · el micrófono se apaga al cerrar el panel y no vuelve a abrirse solo", async ({ page }) => {
    await open(page);
    await startDictating(page);
    const starts = await dictationStarts(page);

    await page.getByTestId("assistant-close").click();
    await expect(assistantPanel(page)).toHaveCount(0);

    await expect.poll(() => microphoneOpen(page)).toBe(false);
    expect(await dictationStarts(page)).toBe(starts);
  });

  test("AC9 · el token de voz lo emite el backend a quien puede usar el asistente, sin caché", async ({ request }) => {
    const admin = await loginAsDemoApi(request);

    const res = await request.get(`${API_BASE}/api/assistant/speech-token`, { headers: authHeaders(admin) });

    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { token: string; region: string; expiresInSeconds: number };
    expect(body.token).toBeTruthy();
    expect(body.region).toBeTruthy();
    expect(body.expiresInSeconds).toBeGreaterThan(60);
    expect(res.headers()["cache-control"]).toContain("no-store");

    // A professional dictates too; without a session there is nothing.
    const pro = await professionalWithAccess(request, admin, `E2E Dictado Pro ${Date.now()}`);
    const proToken = await loginApi(request, pro.email);
    const proRes = await request.get(`${API_BASE}/api/assistant/speech-token`, { headers: authHeaders(proToken) });
    expect(proRes.status()).toBe(200);
    expect([401, 403]).toContain((await request.get(`${API_BASE}/api/assistant/speech-token`)).status());
  });

  test("AC9 · con el asistente apagado no hay token de voz", async ({ request }) => {
    await restoreAssistantGlobal(request);
    try {
      const admin = await loginAsDemoApi(request);
      const res = await request.get(`${API_BASE}/api/assistant/speech-token`, { headers: authHeaders(admin) });
      expect(res.status()).toBe(403);
      expect(await res.text()).toContain("ASSISTANT_DISABLED");
    } finally {
      await enableAssistantGlobally(request);
    }
  });

  test("AC4/AC8 · una profesional también dicta y su mensaje queda «Dictated»", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const pro = await professionalWithAccess(request, admin, `E2E Dictado Pro2 ${Date.now()}`);
    await loginAs(page, pro.email, PASSWORD);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await startDictating(page);
    await speakFinal(page, "services");
    await page.getByTestId("assistant-send").click();

    await expect(dictatedMarks(page)).toHaveCount(1);
    await expect(assistantAnswers(page).last()).toContainText("Servicios", { timeout: 20_000 });
  });
});
