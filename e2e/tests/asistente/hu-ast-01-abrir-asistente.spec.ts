import { expect, test, type Locator } from "@playwright/test";

import {
  API_BASE,
  apiBaseUrl,
  authHeaders,
  loginAsDemoApi,
  loginPlatformAdminApi,
  setTenantFeatureFlag,
} from "../../fixtures/api";
import {
  ASSISTANT_FLAG,
  assistantAnswers,
  askAssistantUi,
  assistantBubbles,
  assistantPanel,
  currentConversationApi,
  askAssistantApi,
  enableAssistantGlobally,
  openAssistantPanel,
  startNewConversationUi,
  restoreAssistantGlobal,
} from "../../fixtures/assistant";
import { loginAsDemo } from "../../fixtures/auth";

// HU-AST-01 · Abrir el asistente desde cualquier pantalla
// requirements/user_stories/HU-AST-01-abrir-asistente.md
//
// The scripted model answers by text patterns (see fixtures/assistant.ts); the assistant is OFF
// globally by default, so the suite switches it on and restores it afterwards.

const DEMO_TENANT_ID = 1;
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 900, height: 800 };
const PHONE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

/** Width of an element once it stops changing (layout and the 150 ms margin transition settled). */
async function settledWidth(locator: Locator): Promise<number> {
  let previous = -1;
  for (let i = 0; i < 25; i++) {
    const width = (await locator.boundingBox())!.width;
    if (Math.abs(width - previous) < 0.5) return width;
    previous = width;
    await locator.page().waitForTimeout(200);
  }
  throw new Error("layout never settled");
}

test.describe("HU-AST-01 · Abrir el asistente desde cualquier pantalla", () => {
  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
  });
  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  test("AC1 · el botón solo aparece con el flag habilitado y sin flag la API responde 403 ASSISTANT_DISABLED", async ({
    page,
    request,
  }) => {
    // Off globally: no button, and the API refuses.
    await restoreAssistantGlobal(request);
    await loginAsDemo(page);
    await expect(page.getByTestId("topbar-assistant")).toHaveCount(0);
    const token = await loginAsDemoApi(request);
    const refused = await request.get(`${API_BASE}/api/assistant/conversations/current`, {
      headers: authHeaders(token),
    });
    expect(refused.status()).toBe(403);
    expect(await refused.text()).toContain("ASSISTANT_DISABLED");

    // On globally but switched off for this salon only (tenant override): still no button.
    await enableAssistantGlobally(request);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, ASSISTANT_FLAG, false);
    try {
      await page.reload();
      await expect(page.getByTestId("resumen-title")).toBeVisible();
      await expect(page.getByTestId("topbar-assistant")).toHaveCount(0);
    } finally {
      const platform = await loginPlatformAdminApi(request);
      await request.delete(
        `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/${ASSISTANT_FLAG}`,
        { headers: authHeaders(platform) },
      );
    }

    // Enabled: the button is there.
    await page.reload();
    await expect(page.getByTestId("topbar-assistant")).toBeVisible();
  });

  test("AC2 · el botón abre y cierra el panel, y la «X» también lo cierra", async ({ page }) => {
    await loginAsDemo(page);
    const button = page.getByTestId("topbar-assistant");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.click();
    await expect(assistantPanel(page)).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");

    await button.click();
    await expect(assistantPanel(page)).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.click();
    await expect(assistantPanel(page)).toBeVisible();
    await page.getByTestId("assistant-close").click();
    await expect(assistantPanel(page)).toHaveCount(0);
  });

  test("AC3 · Ctrl/Cmd + K abre y cierra el panel desde cualquier pantalla", async ({ page }) => {
    await loginAsDemo(page);
    // The shortcut exists once the feature flags have loaded (the button appears with them).
    await expect(page.getByTestId("topbar-assistant")).toBeVisible();

    await page.keyboard.press("Control+k");
    await expect(assistantPanel(page)).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(assistantPanel(page)).toHaveCount(0);

    await page.keyboard.press("Meta+k");
    await expect(assistantPanel(page)).toBeVisible();
    await page.keyboard.press("Meta+k");
    await expect(assistantPanel(page)).toHaveCount(0);
  });

  test("AC4 · en escritorio el panel se acopla de 400 px y angosta el contenido; en tableta se superpone", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsDemo(page);
    const main = page.locator("main");
    const widthBefore = await settledWidth(main);

    await openAssistantPanel(page);

    const panel = assistantPanel(page);
    await expect(panel).toHaveAttribute("data-layout", "docked");
    expect((await panel.boundingBox())!.width).toBeCloseTo(400, 0);
    // The screen makes room instead of sitting under the panel (after its 150 ms transition).
    await expect
      .poll(async () => (await main.boundingBox())!.width, { timeout: 5_000 })
      .toBeCloseTo(widthBefore - 400, 0);
    const mainBox = (await main.boundingBox())!;
    expect(mainBox.x + mainBox.width).toBeLessThanOrEqual(DESKTOP.width - 400 + 1);

    // Medium screens: it overlays on the right and the content keeps its width.
    await page.getByTestId("assistant-close").click();
    await page.setViewportSize(TABLET);
    const tabletWidth = await settledWidth(main);
    await openAssistantPanel(page);
    await expect(assistantPanel(page)).toHaveAttribute("data-layout", "overlay");
    expect((await assistantPanel(page).boundingBox())!.width).toBeCloseTo(400, 0);
    expect(await settledWidth(main)).toBeCloseTo(tabletWidth, 0);
  });

  test("AC5 · con el panel abierto, cambiar de pantalla no lo cierra ni pierde la conversación", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await askAssistantUi(page, "services");
    await expect(assistantAnswers(page).last()).toContainText("Servicios:");
    const messagesBefore = await assistantBubbles(page).count();

    const sidebar = page.locator("#app-sidebar");
    await sidebar.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/hoy/);
    await sidebar.getByRole("link", { name: "Agenda", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/calendar/);

    await expect(assistantPanel(page)).toBeVisible();
    await expect(assistantBubbles(page)).toHaveCount(messagesBefore);
    await expect(assistantAnswers(page).last()).toContainText("Servicios:");
  });

  test("AC6 · en teléfono el panel ocupa toda la pantalla y «Volver» lo cierra", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsDemo(page);

    await openAssistantPanel(page);

    const panel = assistantPanel(page);
    await expect(panel).toHaveAttribute("data-layout", "fullscreen");
    const box = (await panel.boundingBox())!;
    expect(box.width).toBeCloseTo(PHONE.width, 0);
    // Hangs under the 56 px top bar and reaches the bottom of the screen.
    expect(box.y).toBeCloseTo(56, 0);
    expect(box.y + box.height).toBeCloseTo(PHONE.height, 0);

    await page.getByTestId("assistant-back").click();
    await expect(panel).toHaveCount(0);
  });

  test("AC7 · una conversación vacía muestra la bienvenida con sugerencias que se envían al tocarlas", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.getByTestId("topbar-assistant").click();
    // Start from an empty conversation whatever earlier tests left behind.
    await startNewConversationUi(page);

    await expect(page.getByTestId("assistant-welcome")).toBeVisible();
    await expect(page.getByText("How can I help?")).toBeVisible();
    const suggestions = page.getByTestId("assistant-suggestion");
    await expect(suggestions).toHaveCount(3);

    await page.getByRole("button", { name: "Which professionals are there?" }).click();

    await expect(page.getByTestId("assistant-welcome")).toHaveCount(0);
    await expect(assistantBubbles(page).first()).toContainText("Which professionals are there?");
    await expect(assistantAnswers(page).last()).toContainText("Profesionales:");
  });

  test("AC8 · «Nueva conversación» vacía el panel y la anterior ya no se puede continuar", async ({
    page,
    request,
  }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await askAssistantUi(page, "services");
    await expect(assistantAnswers(page).last()).toContainText("Servicios:");
    const token = await loginAsDemoApi(request);
    const old = await currentConversationApi(request, token);
    expect(old.messages.length).toBeGreaterThanOrEqual(2);

    await startNewConversationUi(page);

    const fresh = await currentConversationApi(request, token);
    expect(fresh.conversationId).not.toBe(old.conversationId);
    expect(fresh.messages).toHaveLength(0);
    const refused = await askAssistantApi(request, token, old.conversationId, "services");
    expect(refused.status).toBe(404);
    expect(refused.raw).toContain("ASSISTANT_CONVERSATION_NOT_FOUND");
  });

  test("AC9 · al recargar la página y reabrir el asistente se ve la conversación anterior", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    await askAssistantUi(page, "professionals");
    await expect(assistantAnswers(page).last()).toContainText("Profesionales:");

    await page.reload();
    await expect(page.getByTestId("topbar-assistant")).toBeVisible();
    await expect(assistantPanel(page)).toHaveCount(0);
    await openAssistantPanel(page);

    await expect(assistantBubbles(page)).toHaveCount(2);
    await expect(assistantBubbles(page).first()).toContainText("professionals");
    await expect(assistantAnswers(page).last()).toContainText("Profesionales:");
  });

  test("AC10 · en teléfono los controles táctiles miden al menos 44 × 44 px", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsDemo(page);
    await expect(page.getByTestId("topbar-assistant")).toBeVisible();
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    await expect(page.getByTestId("assistant-welcome")).toBeVisible();
    await page.getByTestId("assistant-input").fill("hola");

    const targets = [
      page.getByTestId("topbar-assistant"),
      page.getByTestId("assistant-back"),
      page.getByTestId("assistant-new-conversation"),
      page.getByTestId("assistant-send"),
      ...(await page.getByTestId("assistant-suggestion").all()),
    ];
    for (const target of targets) {
      const box = (await target.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(43.9);
      expect(box.height).toBeGreaterThanOrEqual(43.9);
    }
  });

  test("AC11 · la caja de texto crece hasta 5 líneas, luego se desplaza, y vuelve a una línea al enviar", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await expect(page.getByTestId("topbar-assistant")).toBeVisible();
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    const input = page.getByTestId("assistant-input");
    const metrics = () =>
      input.evaluate((el) => ({ height: el.clientHeight + 2, overflows: el.scrollHeight > el.clientHeight }));

    const oneLine = (await metrics()).height;
    expect(oneLine).toBeLessThan(50);

    await input.fill("uno\ndos\ntres\ncuatro\ncinco");
    const five = await metrics();
    expect(five.height).toBeGreaterThan(oneLine + 60);
    expect(five.overflows).toBe(false);

    await input.fill("1\n2\n3\n4\n5\n6\n7\n8");
    const eight = await metrics();
    expect(eight.height).toBeLessThanOrEqual(five.height + 1);
    expect(eight.overflows).toBe(true);

    await input.fill("professionals");
    await page.getByTestId("assistant-send").click();
    await expect(input).toHaveValue("");
    expect((await metrics()).height).toBeLessThan(50);
  });
});
