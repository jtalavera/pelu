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

test("HU-69 AC13 · los cumpleaños del dashboard de B no incluyen clientes de A", async ({
  request,
}) => {
  const tokenA = await mtLoginToken(request, world.tenantA);
  const tokenB = await mtLoginToken(request, world.tenantB);
  const now = new Date();
  // A client of A with a birthday today: shows for A, never for B.
  const name = `MT Cumple A ${Date.now()}`;
  const created = await request.post(`${process.env.MT_API_BASE}/api/clients`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: {
      fullName: name,
      birthdayDay: Number(
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", day: "2-digit" }).format(now),
      ),
      birthdayMonth: Number(
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", month: "2-digit" }).format(now),
      ),
    },
  });
  expect(created.status(), await created.text()).toBe(200);

  const forA = await request.get(`${process.env.MT_API_BASE}/api/dashboard/birthdays`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  expect(JSON.stringify(await forA.json())).toContain(name.toUpperCase());
  const forB = await request.get(`${process.env.MT_API_BASE}/api/dashboard/birthdays`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  expect(forB.status()).toBe(200);
  expect(JSON.stringify(await forB.json())).not.toContain(name.toUpperCase());
});
