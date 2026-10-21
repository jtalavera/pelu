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

test("HU-68 AC14 · B no puede leer ni editar la ficha técnica de una cliente de A", async ({
  request,
}) => {
  const sheetPath = `/api/clients/${world.tenantA.clientIds[0]}/technical-sheet`;
  const tokenA = await mtLoginToken(request, world.tenantA);
  const own = await request.get(`${process.env.MT_API_BASE}${sheetPath}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  expect(own.status(), await own.text()).toBe(200);
  const before = await own.json();

  const tokenB = await mtLoginToken(request, world.tenantB);
  await expectCrossTenantForbidden(request, tokenB, sheetPath);
  const put = await request.put(`${process.env.MT_API_BASE}${sheetPath}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: { notes: "MT intrusion", colorFormula: "MT intrusion" },
  });
  expect([403, 404]).toContain(put.status());

  // A's sheet is untouched.
  const after = await request.get(`${process.env.MT_API_BASE}${sheetPath}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  expect(await after.json()).toEqual(before);
});
