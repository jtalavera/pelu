import { expect, test } from "@playwright/test";

import { loginAsDemoApi, setTenantFeatureFlag } from "../fixtures/api";
import {
  NEUTRAL_PUBLIC_BOOKING,
  ONLINE_BOOKING_FLAG,
  getPublicBooking,
  setBookingFlagGlobally,
  setBookingSettings,
  uniqueSlug,
} from "../fixtures/booking";

// RSV A0 · Esqueleto de la reserva online: la página pública `/r/:slug`
// requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md  (§4 RT-01, RT-02, RT-03, RT-05)
//
// A0 no tiene historia propia: deja la ruta pública, el flag ONLINE_BOOKING y la resolución del salón
// solo por su dirección. Lo que se verifica son los requisitos transversales que ya aplican:
//  RT-01 con el flag o el interruptor «Aceptar reservas» apagados, o con una dirección inexistente, la
//        respuesta es EXACTAMENTE la misma (página y JSON neutros): no se revela cuál es el caso
//  RT-02 el salón se resuelve solo por la dirección; nada del llamador (sin sesión, sin tenant)
//  RT-03 la respuesta pública lleva solo lo permitido (disponible y nombre comercial) y no se cachea
//  RT-05 en celular no hay scroll horizontal
// El aislamiento entre dos salones está en `mt-isolation/mt-booking.spec.ts`.
// Pendiente (otros incrementos): servicios y horarios (A3), configuración real (A2).

test.describe.configure({ mode: "serial" });

const TENANT_ID = 1;
// The e2e browser runs in English (playwright.config locale); the Spanish copy is covered by Vitest.
const NEUTRAL_TITLE = "This link is not available";

test.describe("RSV A0 · Página pública de reservas", () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    await setBookingFlagGlobally(request, true);
    await setTenantFeatureFlag(request, TENANT_ID, ONLINE_BOOKING_FLAG, true);
    token = await loginAsDemoApi(request);
  });

  test.afterAll(async ({ request }) => {
    await setBookingSettings(request, token, { accepting: false });
    await setTenantFeatureFlag(request, TENANT_ID, ONLINE_BOOKING_FLAG, true);
    await setBookingFlagGlobally(request, false);
  });

  test("RT-02/03: un salón abierto muestra solo su nombre, sin sesión, y la respuesta no se cachea", async ({
    page,
    request,
  }) => {
    const slug = uniqueSlug();
    await setBookingSettings(request, token, { slug, accepting: true });

    const res = await getPublicBooking(request, slug);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["available", "businessName"]); // lista blanca de campos
    expect(body.available).toBe(true);
    expect(String(body.businessName).length).toBeGreaterThan(0);

    await page.goto(`/r/${slug}`);
    await expect(page.getByTestId("public-booking-name")).toHaveText(String(body.businessName));
    await expect(page.getByTestId("public-booking-unavailable")).toHaveCount(0);
  });

  test("RT-01: una dirección inexistente, malformada o reservada da la página neutra", async ({ page, request }) => {
    for (const slug of ["no-existe-este-salon", "admin", "login", "x"]) {
      const res = await getPublicBooking(request, slug);
      expect(res.status(), slug).toBe(200);
      expect(await res.json(), slug).toEqual(NEUTRAL_PUBLIC_BOOKING);
    }
    await page.goto("/r/no-existe-este-salon");
    await expect(page.getByTestId("public-booking-unavailable")).toContainText(NEUTRAL_TITLE);
    await expect(page.getByTestId("public-booking-open")).toHaveCount(0);
  });

  test("RT-01: con «Aceptar reservas» apagado la respuesta es idéntica a la de una dirección inexistente", async ({
    page,
    request,
  }) => {
    const slug = uniqueSlug();
    await setBookingSettings(request, token, { slug, accepting: false });

    const closed = await getPublicBooking(request, slug);
    const unknown = await getPublicBooking(request, "no-existe-este-salon");
    expect(closed.status()).toBe(unknown.status());
    expect(await closed.json()).toEqual(await unknown.json());

    await page.goto(`/r/${slug}`);
    await expect(page.getByTestId("public-booking-unavailable")).toContainText(NEUTRAL_TITLE);

    // Turning it on opens it at once.
    await setBookingSettings(request, token, { accepting: true });
    await page.goto(`/r/${slug}`);
    await expect(page.getByTestId("public-booking-open")).toBeVisible();
  });

  test("RT-01: con el flag ONLINE_BOOKING apagado para el salón o para toda la plataforma, página neutra", async ({
    page,
    request,
  }) => {
    const slug = uniqueSlug();
    await setBookingSettings(request, token, { slug, accepting: true });
    expect((await (await getPublicBooking(request, slug)).json()).available).toBe(true);

    await setTenantFeatureFlag(request, TENANT_ID, ONLINE_BOOKING_FLAG, false);
    expect(await (await getPublicBooking(request, slug)).json()).toEqual(NEUTRAL_PUBLIC_BOOKING);
    await page.goto(`/r/${slug}`);
    await expect(page.getByTestId("public-booking-unavailable")).toContainText(NEUTRAL_TITLE);

    await setTenantFeatureFlag(request, TENANT_ID, ONLINE_BOOKING_FLAG, true);
    await setBookingFlagGlobally(request, false);
    expect(await (await getPublicBooking(request, slug)).json()).toEqual(NEUTRAL_PUBLIC_BOOKING);

    await setBookingFlagGlobally(request, true);
    expect((await (await getPublicBooking(request, slug)).json()).available).toBe(true);
  });

  test("RT-02: la dirección no distingue mayúsculas de minúsculas", async ({ request }) => {
    const slug = uniqueSlug();
    await setBookingSettings(request, token, { slug, accepting: true });
    expect((await (await getPublicBooking(request, slug.toUpperCase())).json()).available).toBe(true);
  });

  test("RT-05: en un celular la página no tiene scroll horizontal", async ({ page, request }) => {
    const slug = uniqueSlug();
    await setBookingSettings(request, token, { slug, accepting: true });
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`/r/${slug}`);
    await expect(page.getByTestId("public-booking-open")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
