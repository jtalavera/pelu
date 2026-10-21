import { expect, test } from "@playwright/test";

import { expectCrossTenantForbidden } from "../../fixtures/mt/probe";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

/** HU-67+ · Ficha de la cliente enriquecida — tenant isolation of the new client endpoints. */
const world = getMtWorld();

test("HU-67 AC13 · B no puede leer el resumen de una cliente de A", async ({ request }) => {
  const summaryPath = `/api/clients/${world.tenantA.clientIds[0]}/summary`;

  // Positive control: A's own token reads it (the route exists and the client is A's).
  const tokenA = await mtLoginToken(request, world.tenantA);
  const own = await request.get(`${process.env.MT_API_BASE}${summaryPath}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  expect(own.status(), await own.text()).toBe(200);

  const tokenB = await mtLoginToken(request, world.tenantB);
  await expectCrossTenantForbidden(request, tokenB, summaryPath);
});
