import { expect, test } from "@playwright/test";

import {
  createAppointmentApi,
  loginAsDemoApi,
  putProfessionalSchedules,
  seedCategoryServiceProfessional,
  type SeededSalon,
} from "../../fixtures/api";
import {
  askAssistantApi,
  askAssistantUi,
  assistantAnswers,
  businessInstant,
  businessTomorrow,
  createClientWithPhone,
  currentConversationApi,
  enableAssistantGlobally,
  isoWeekday,
  openAssistantPanel,
  optionChips,
  optionLabels,
  restoreAssistantGlobal,
  startNewConversationUi,
  workingWeek,
} from "../../fixtures/assistant";
import { loginAsDemo } from "../../fixtures/auth";
import { createProfessional } from "../../fixtures/commissions";

// HU-AST-05 · Consultar disponibilidad por chat
// requirements/user_stories/HU-AST-05-consultar-disponibilidad-por-chat.md
//
// The scripted model understands «availability <day> [morning|afternoon] for <service> [with <pro>]».
// Each test gets its own professional so no test sees another's appointments. The seeded service
// lasts 60 minutes; professionals work 09:00–17:00. AC8 (isolation) lives in
// tests/mt-isolation/mt-asistente.spec.ts.

const SUFFIX = String(Date.now()).slice(-7);

test.describe.configure({ mode: "serial" });

test.describe("HU-AST-05 · Consultar disponibilidad por chat", () => {
  let token: string;
  let salon: SeededSalon;
  let clientId: number;
  let n = 0;
  const tomorrow = businessTomorrow();

  async function newProfessional(request: Parameters<typeof createProfessional>[0], hours = workingWeek()) {
    const pro = await createProfessional(request, token, `E2E Disp ${SUFFIX} ${++n}`);
    if (hours.length) await putProfessionalSchedules(request, token, pro.id, hours);
    return pro;
  }

  async function bookAt(
    request: Parameters<typeof createProfessional>[0],
    professionalId: number,
    hhmm: string,
  ) {
    await createAppointmentApi(request, token, {
      clientId,
      professionalId,
      serviceId: salon.serviceId,
      startAt: businessInstant(tomorrow, hhmm).toISOString(),
    });
  }

  async function ask(request: Parameters<typeof createProfessional>[0], text: string) {
    const { conversationId } = await currentConversationApi(request, token);
    return askAssistantApi(request, token, conversationId, text);
  }

  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
    token = await loginAsDemoApi(request);
    salon = await seedCategoryServiceProfessional(request, token);
    clientId = (await createClientWithPhone(request, token, `Asistente Disp ${SUFFIX}`)).id;
  });
  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  test("AC1 · los horarios libres llegan como botones y el servicio entra completo en el bloque", async ({
    page,
    request,
  }) => {
    const pro = await newProfessional(request);
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await askAssistantUi(page, `availability tomorrow for ${salon.serviceFullName} with ${pro.name}`);

    await expect(optionChips(page).first()).toBeVisible({ timeout: 20_000 });
    expect(await optionChips(page).count()).toBeLessThanOrEqual(8);
    await expect(optionChips(page).first()).toHaveText("09:00");
    await expect(assistantAnswers(page).last()).toContainText("Horarios libres para");

    // 60-minute service in a 09:00–17:00 block: with 09:00–15:00 full, 16:00 is the last start
    // (16:30 would end after closing), so only three times are left.
    const tail = await newProfessional(request);
    for (const hhmm of ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"]) await bookAt(request, tail.id, hhmm);
    const labels = optionLabels(await ask(request, `availability tomorrow for ${salon.serviceFullName} with ${tail.name}`));
    expect(labels).toEqual(["15:00", "15:30", "16:00"]);
  });

  test("AC2 · los horarios solapados con un turno no se ofrecen; el que termina justo cuando otro empieza sí", async ({
    request,
  }) => {
    const pro = await newProfessional(request);
    await bookAt(request, pro.id, "10:00"); // 10:00–11:00

    const labels = optionLabels(await ask(request, `availability tomorrow for ${salon.serviceFullName} with ${pro.name}`));

    expect(labels).toContain("09:00"); // 09:00–10:00 ends exactly when the appointment starts
    expect(labels).toContain("11:00");
    for (const taken of ["09:30", "10:00", "10:30"]) expect(labels).not.toContain(taken);
  });

  test("AC3 · la franja de la mañana o de la tarde filtra los horarios", async ({ request }) => {
    const pro = await newProfessional(request);

    const morning = optionLabels(await ask(request, `availability tomorrow morning for ${salon.serviceFullName} with ${pro.name}`));
    const afternoon = optionLabels(await ask(request, `availability tomorrow afternoon for ${salon.serviceFullName} with ${pro.name}`));

    expect(morning.length).toBeGreaterThan(0);
    expect(morning.every((t) => t < "12:00")).toBe(true);
    expect(afternoon.length).toBeGreaterThan(0);
    expect(afternoon.every((t) => t >= "12:00")).toBe(true);
  });

  test("AC4 · con profesional solo sus horarios; sin profesional se indica de quién es cada uno", async ({ request }) => {
    const a = await newProfessional(request);
    const b = await newProfessional(request);
    await bookAt(request, a.id, "09:00");
    await bookAt(request, a.id, "10:00"); // 09:00–11:00 busy: her first free start is 11:00

    const onlyA = optionLabels(await ask(request, `availability tomorrow for ${salon.serviceFullName} with ${a.name}`));
    expect(onlyA[0]).toBe("11:00");
    expect(onlyA.every((t) => !t.includes("·"))).toBe(true);

    const all = await ask(request, `availability tomorrow for ${salon.serviceFullName}`);
    expect(all.status).toBe(200);
    expect(all.text).toContain(`- ${b.name}: `);
    expect(optionLabels(all).some((l) => l.includes(" · "))).toBe(true);
  });

  test("AC5 · sin lugar ese día, ofrece el próximo día con horarios libres", async ({ request }) => {
    const pro = await newProfessional(request, workingWeek(isoWeekday(tomorrow))); // never works tomorrow's weekday

    const res = await ask(request, `availability tomorrow for ${salon.serviceFullName} with ${pro.name}`);

    expect(res.text).toContain("No hay horarios libres");
    expect(res.text).toMatch(/Probá el \d{4}-\d{2}-\d{2}/);
    expect(optionLabels(res)).toHaveLength(0);
  });

  test("AC6 · una profesional sin horario cargado: lo dice en vez de inventar horarios", async ({ request }) => {
    const pro = await newProfessional(request, []);

    const res = await ask(request, `availability tomorrow for ${salon.serviceFullName} with ${pro.name}`);

    expect(res.text).toContain("sin horario cargado");
    expect(optionLabels(res)).toHaveLength(0);
  });

  test("AC7 · tocar un horario lo envía como mensaje y el asistente pregunta el cliente", async ({ page, request }) => {
    const pro = await newProfessional(request);
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    await askAssistantUi(page, `availability tomorrow for ${salon.serviceFullName} with ${pro.name}`);
    await expect(optionChips(page).first()).toBeVisible({ timeout: 20_000 });

    await optionChips(page).nth(1).click(); // 09:30

    await expect(page.getByTestId("assistant-message").filter({ hasText: "Quiero el turno del" }).last()).toContainText(
      `a las 09:30 con ${pro.name}`,
    );
    await expect(assistantAnswers(page).last()).toContainText("¿Para qué cliente", { timeout: 20_000 });
  });
});
