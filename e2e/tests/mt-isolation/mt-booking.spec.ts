import { expect, test } from "@playwright/test";

import { setTenantFeatureFlag } from "../../fixtures/api";
import {
  NEUTRAL_PUBLIC_BOOKING,
  ONLINE_BOOKING_FLAG,
  getPublicBooking,
  setBookingFlagGlobally,
  setBookingSettings,
  uniqueSlug,
} from "../../fixtures/booking";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

/**
 * mt-booking — RSV A0: the public page reaches a salon ONLY through its address (RT-02).
 *
 *  Two salons (A and B): the mt world's third tenant is suspended by design and cannot log in.
 *
 *  1. Each address answers with its own salon's name, never the other's.
 *  2. Turning the booking flag off for one salon makes only that address neutral.
 *  3. A salon's «Aceptar reservas» switch is its own.
 *
 * All raw HTTP goes to the :8081 mt backend. The salon's address is set by the e2e support endpoint,
 * which only ever acts on the CALLER's salon.
 */

test.describe.configure({ mode: "serial" });

const world = getMtWorld();
const MT_API = process.env.MT_API_BASE ?? "http://127.0.0.1:8081";

test.describe("mt-booking · aislamiento de la página pública", () => {
  let tokenA: string;
  let tokenB: string;
  let slugA: string;
  let slugB: string;

  test.beforeAll(async ({ request }) => {
    await setBookingFlagGlobally(request, true);
    for (const t of [world.tenantA, world.tenantB]) {
      await setTenantFeatureFlag(request, t.id, ONLINE_BOOKING_FLAG, true);
    }
    tokenA = await mtLoginToken(request, world.tenantA);
    tokenB = await mtLoginToken(request, world.tenantB);
    slugA = uniqueSlug("mt-a");
    slugB = uniqueSlug("mt-b");
    await setBookingSettings(request, tokenA, { slug: slugA, accepting: true }, MT_API);
    await setBookingSettings(request, tokenB, { slug: slugB, accepting: true }, MT_API);
  });

  test.afterAll(async ({ request }) => {
    for (const t of [world.tenantA, world.tenantB]) {
      await setTenantFeatureFlag(request, t.id, ONLINE_BOOKING_FLAG, true);
    }
    await setBookingFlagGlobally(request, false);
  });

  const nameOf = async (request: import("@playwright/test").APIRequestContext, slug: string) =>
    ((await (await getPublicBooking(request, slug, MT_API)).json()) as { businessName?: string }).businessName;

  test("cada dirección responde con el nombre de su propio salón", async ({ request }) => {
    const nameA = await nameOf(request, slugA);
    const nameB = await nameOf(request, slugB);
    expect(nameA).toBeTruthy();
    expect(nameB).toBeTruthy();
    expect(nameA).not.toEqual(nameB);
  });

  test("apagar el flag de un salón vuelve neutra solo su dirección", async ({ request }) => {
    await setTenantFeatureFlag(request, world.tenantB.id, ONLINE_BOOKING_FLAG, false);
    expect(await (await getPublicBooking(request, slugB, MT_API)).json()).toEqual(NEUTRAL_PUBLIC_BOOKING);
    expect(await nameOf(request, slugA)).toBeTruthy();
    await setTenantFeatureFlag(request, world.tenantB.id, ONLINE_BOOKING_FLAG, true);
    expect(await nameOf(request, slugB)).toBeTruthy();
  });

  test("«Aceptar reservas» es de cada salón", async ({ request }) => {
    await setBookingSettings(request, tokenA, { accepting: false }, MT_API);
    expect(await (await getPublicBooking(request, slugA, MT_API)).json()).toEqual(NEUTRAL_PUBLIC_BOOKING);
    expect(await nameOf(request, slugB)).toBeTruthy();
    await setBookingSettings(request, tokenA, { accepting: true }, MT_API);
    expect(await nameOf(request, slugA)).toBeTruthy();
  });
});
