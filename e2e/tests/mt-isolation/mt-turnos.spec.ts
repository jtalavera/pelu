import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  API_BASE,
  apiGetJson,
  apiPutJson,
  authHeaders,
  calendarVisibleWeekSlotIso,
  createAppointmentApi,
  instantToOffsetIso,
} from "../../fixtures/api";
import { loginAs } from "../../fixtures/auth";
import {
  expectCrossTenantForbidden,
  expectScopedList,
  expectUnchanged,
  snapshotTenant,
} from "../../fixtures/mt/probe";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";
import {
  bookingAppointmentDialog,
  ensureCalendarShowsClientCard,
  fillAppointmentDateIso,
  fillAppointmentTime,
  pickSearchableOption,
} from "../../fixtures/ui";

/**
 * Task 5 — mt-turnos: calendar & appointment isolation.
 *
 * Four scenarios proving that scheduling in one tenant never bleeds into another:
 *  1. A books a turno via the calendar UI → its client card is absent from B's calendar, and B's
 *     "New appointment" pickers only offer B's professionals/services (a *shared-named* service
 *     still resolves to B's own id).
 *  2. Appointment list endpoints are tenant-scoped (cross-probe, both directions) + a cross-tenant
 *     GET /api/appointments/{id} is forbidden.
 *  3. The same wall-clock calendar slot can be booked in A and in B independently — no cross-tenant
 *     SLOT_TAKEN / 409.
 *  4. Editing and cancelling appointments in A leaves a before/after snapshot of B byte-identical.
 *
 * All raw HTTP goes to `API_BASE` (= the :8081 mt backend — the mt config points
 * `PLAYWRIGHT_API_BASE_URL` there). Every assertion is "contains / excludes THIS id", never an
 * absolute count. A failing isolation assertion here is a suspected product bug — reported, not
 * weakened.
 *
 * Re-run note: scenarios 1 and 3 use the brief-mandated `calendarVisibleWeekSlotIso(...)` slots for
 * a fixed professional. On a *reused* mt backend (`reuseExistingServer` locally) a second run can
 * 409 (APPOINTMENT_OVERLAP) on the same prof+slot — restart the mt backend (fresh H2) between local
 * iterations, as `fixtures/mt/world.ts` documents. CI always boots a fresh H2.
 */

const world = getMtWorld();

/** hu-07's helper: a RegExp that matches `s` as a literal substring. */
function rxExact(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** id → fullName map from a bare-array list endpoint (`/api/professionals`, `/api/clients`). */
async function fullNameMap(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<Map<number, string>> {
  const rows = await apiGetJson<Array<{ id: number; fullName: string }>>(request, token, path);
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

/** `Instant.parse`-compatible bounds wide enough to capture every appointment row. */
const WIDE_FROM = "2000-01-01T00:00:00Z";
const WIDE_TO = "2100-01-01T00:00:00Z";
/**
 * DEVIATION from the brief's `GET /api/appointments/history?page=0&size=100`: `/history` requires a
 * `clientId` param (it is the single-client, ≤6-month, paged history — verified in Task 3). The
 * whole-tenant list is `GET /api/appointments?from=&to=` (bare array — see
 * `AppointmentController.list`, `@GetMapping` with required `from`/`to` `Instant.parse` strings),
 * the same endpoint `snapshotTenant` uses.
 */
const allAppointmentsPath = `/api/appointments?from=${WIDE_FROM}&to=${WIDE_TO}`;

/**
 * Run-unique seed. The mt backend is reused across local runs (`reuseExistingServer`), and
 * appointments cannot be deleted — so a fixed prof+slot would 409 (APPOINTMENT_OVERLAP) on the
 * second run. Every appointment this spec creates is anchored to `RUN_SEED` so re-runs never
 * collide (global constraint: "use unique identifiers for any created data").
 */
const RUN_SEED = Date.now();

/**
 * A far-future, run-unique ISO instant for the pure-API scenarios (2-4), which do not need the slot
 * to be visible on the calendar grid. `dayBucket` spreads sibling appointments onto different days
 * so same-run creates never overlap; the hour/minute are `RUN_SEED`-derived so cross-run creates
 * land on a different slot.
 */
function uniqueApiSlotIso(dayBucket: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 30 + dayBucket + (RUN_SEED % 120));
  d.setHours(8 + (RUN_SEED % 10), (RUN_SEED % 6) * 10, 0, 0);
  return instantToOffsetIso(d);
}

/**
 * A calendar-visible slot (scenario 1 needs the booking to render on the weekly grid) that is
 * currently free for `professionalId` in `token`'s tenant. Walks whole-hour slots 8:00-20:00 and
 * returns the first whose absolute instant is not already booked — so a reused mt backend with
 * leftovers from earlier runs can't 409 the UI booking.
 */
async function freeVisibleSlotIso(
  request: APIRequestContext,
  token: string,
  professionalId: number,
): Promise<string> {
  const rows = await apiGetJson<Array<{ professionalId: number; startAt: string }>>(
    request,
    token,
    allAppointmentsPath,
  );
  const taken = new Set(
    rows.filter((r) => r.professionalId === professionalId).map((r) => new Date(r.startAt).getTime()),
  );
  for (let hour = 8; hour <= 20; hour++) {
    const iso = calendarVisibleWeekSlotIso(hour, 0);
    if (!taken.has(new Date(iso).getTime())) {
      return iso;
    }
  }
  throw new Error(`freeVisibleSlotIso: no free 8-20h slot for professional ${professionalId}`);
}

test.describe("mt-turnos · calendar & appointment isolation", () => {
  // Scenario 1 -----------------------------------------------------------------------------------
  test("UI: a turno booked in A is absent in B, and B's pickers are tenant-scoped", async ({
    browser,
    request,
  }) => {
    test.setTimeout(240_000); // two full browser logins + calendar week sweeps + two dialog flows

    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);

    const aProfNames = await fullNameMap(request, tokenA, "/api/professionals");
    const bProfNames = await fullNameMap(request, tokenB, "/api/professionals");
    const aClientNames = await fullNameMap(request, tokenA, "/api/clients");
    const aServices = await apiGetJson<Array<{ id: number; name: string }>>(
      request,
      tokenA,
      "/api/services",
    );
    const bServices = await apiGetJson<Array<{ id: number; name: string }>>(
      request,
      tokenB,
      "/api/services",
    );

    const aProfId = world.tenantA.professionalIds[0];
    const aServiceId = world.tenantA.catalog.serviceIds[0];
    const aClientId = world.tenantA.clientIds[0];
    const aClientName = aClientNames.get(aClientId)!;
    const aProfName = aProfNames.get(aProfId)!;
    const aServiceName = aServices.find((s) => s.id === aServiceId)!.name;

    const aSlot = await freeVisibleSlotIso(request, tokenA, aProfId);
    const aSlotDay = aSlot.slice(0, 10);
    const aSlotTime = aSlot.slice(11, 16);

    // --- T-A admin books a turno through the calendar UI ---
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    try {
      await loginAs(pageA, world.tenantA.adminEmail, world.tenantA.adminPassword);
      await pageA.goto("/app/calendar");
      await pageA.getByRole("button", { name: "New appointment" }).first().click();
      const dlgA = bookingAppointmentDialog(pageA);
      await fillAppointmentDateIso(dlgA, aSlotDay);
      await fillAppointmentTime(dlgA, aSlotTime);
      await pickSearchableOption(pageA, "Professional", aProfName.slice(0, 9), rxExact(aProfName));
      await pickSearchableOption(pageA, "Service", aServiceName.slice(0, 12), rxExact(aServiceName));
      await pickSearchableOption(pageA, "Client", aClientName.slice(0, 12), rxExact(aClientName));

      const [createRes] = await Promise.all([
        pageA.waitForResponse(
          (r) =>
            /\/api\/appointments\/?$/.test(new URL(r.url()).pathname) &&
            r.request().method() === "POST",
          { timeout: 20_000 },
        ),
        dlgA.getByRole("button", { name: "Save" }).click(),
      ]);
      expect(createRes.status(), await createRes.text()).toBe(201);
      const created = (await createRes.json()) as { id: number };
      expect(created.id).toBeGreaterThan(0);

      // Sanity: A really does see its own new card somewhere on its grid.
      await ensureCalendarShowsClientCard(pageA, rxExact(aClientName), {
        maxAheadWeeks: 4,
        maxBackWeeks: 2,
      });
    } finally {
      await ctxA.close();
    }

    // --- T-B admin: the A client's card must NOT appear anywhere on B's calendar ---
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    try {
      await loginAs(pageB, world.tenantB.adminEmail, world.tenantB.adminPassword);
      await pageB.goto("/app/calendar");
      await pageB.waitForResponse(
        (r) =>
          r.request().method() === "GET" &&
          new URL(r.url()).pathname === "/api/appointments",
        { timeout: 25_000 },
      );

      const aCardInB = pageB.getByRole("button", { name: rxExact(aClientName) });
      await expect(aCardInB).toHaveCount(0);
      // Sweep forward a couple of weeks — the booked slot may sit in a later week than B's default view.
      for (let i = 0; i < 2; i++) {
        await Promise.all([
          pageB.waitForResponse(
            (r) =>
              r.request().method() === "GET" &&
              new URL(r.url()).pathname === "/api/appointments",
            { timeout: 25_000 },
          ),
          pageB.getByRole("button", { name: "Next week", exact: true }).click(),
        ]);
        await expect(aCardInB).toHaveCount(0);
      }

      // --- B's "New appointment" pickers only offer B's own catalog ---
      // The shared-named service ("MT Corte de Dama" exists in BOTH tenants) must resolve to B's id.
      const sharedServiceName = world.tenantB.catalog.serviceNames[0];
      const bSharedService = bServices.find((s) => s.name === sharedServiceName)!;
      expect(world.tenantA.catalog.serviceNames).toContain(sharedServiceName); // it really is shared
      const bProfId = world.tenantB.professionalIds[0];
      const bProfName = bProfNames.get(bProfId)!;
      // Resolved BEFORE the dialog opens: it is a raw API call, and interleaving it with the open
      // modal buys nothing.
      const bSlot = await freeVisibleSlotIso(request, tokenB, bProfId);

      await pageB.getByRole("button", { name: "New appointment" }).first().click();
      const dlgB = bookingAppointmentDialog(pageB);
      await fillAppointmentDateIso(dlgB, bSlot.slice(0, 10));
      await fillAppointmentTime(dlgB, bSlot.slice(11, 16));

      // Open the professional picker, inspect the whole (unfiltered) listbox, then pick B's own
      // professional straight out of it. Selecting a row is how a `SearchableSelect` closes — do NOT
      // press Escape here: `SearchableSelect`'s Escape handler calls `preventDefault()` but never
      // `stopPropagation()`, so the key bubbles to the Modal and closes the whole booking dialog.
      const profCombo = pageB.getByRole("combobox", { name: "Professional", exact: true });
      await profCombo.click();
      const profListbox = pageB.getByRole("listbox", { name: "Professional", exact: true });
      for (const id of world.tenantB.professionalIds) {
        await expect(
          profListbox.getByRole("button", { name: bProfNames.get(id)!, exact: true }),
        ).toBeVisible();
      }
      for (const id of world.tenantA.professionalIds) {
        await expect(
          profListbox.getByRole("button", { name: aProfNames.get(id)!, exact: true }),
        ).toHaveCount(0);
      }
      await profListbox.getByRole("button", { name: bProfName, exact: true }).first().click();

      // Same inspection for the service picker, filtered to the *shared* name: only B's copy is
      // offered, and it is the row we then select.
      const svcCombo = pageB.getByRole("combobox", { name: "Service", exact: true });
      await svcCombo.click();
      await svcCombo.fill("");
      await svcCombo.fill(sharedServiceName.slice(0, 12));
      const svcListbox = pageB.getByRole("listbox", { name: "Service", exact: true });
      await expect(
        svcListbox.getByRole("button", { name: rxExact(sharedServiceName) }),
      ).toHaveCount(1);
      await svcListbox.getByRole("button", { name: rxExact(sharedServiceName) }).first().click();

      const [postReq] = await Promise.all([
        pageB.waitForRequest(
          (r) =>
            /\/api\/appointments\/?$/.test(new URL(r.url()).pathname) && r.method() === "POST",
          { timeout: 20_000 },
        ),
        dlgB.getByRole("button", { name: "Save" }).click(),
      ]);
      const body = postReq.postDataJSON() as { serviceId: number; professionalId: number };
      expect(world.tenantB.catalog.serviceIds).toContain(body.serviceId);
      expect(world.tenantA.catalog.serviceIds).not.toContain(body.serviceId);
      expect(body.serviceId).toBe(bSharedService.id);
      expect(world.tenantB.professionalIds).toContain(body.professionalId);
      expect(world.tenantA.professionalIds).not.toContain(body.professionalId);
    } finally {
      await ctxB.close();
    }
  });

  // Scenario 2 -----------------------------------------------------------------------------------
  test("API cross-probe: appointment lists are tenant-scoped both ways", async ({ request }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);

    const a = await createAppointmentApi(request, tokenA, {
      clientId: world.tenantA.clientIds[0],
      professionalId: world.tenantA.professionalIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      startAt: uniqueApiSlotIso(1),
    });
    const b = await createAppointmentApi(request, tokenB, {
      clientId: world.tenantB.clientIds[0],
      professionalId: world.tenantB.professionalIds[0],
      serviceId: world.tenantB.catalog.serviceIds[0],
      startAt: uniqueApiSlotIso(2),
    });
    expect(a.id).not.toBe(b.id);

    // B's whole-tenant list has B's new appointment and never A's; A's is the mirror image.
    await expectScopedList(request, tokenB, allAppointmentsPath, {
      includesIds: [b.id],
      excludesIds: [a.id],
      idField: "id",
    });
    await expectScopedList(request, tokenA, allAppointmentsPath, {
      includesIds: [a.id],
      excludesIds: [b.id],
      idField: "id",
    });

    // A single foreign appointment is not even individually addressable across the tenant boundary.
    // (Brief correction: probe GET /api/appointments/{id}, which is tenant-scoped, not /history.)
    await expectCrossTenantForbidden(request, tokenB, `/api/appointments/${a.id}`);
    await expectCrossTenantForbidden(request, tokenA, `/api/appointments/${b.id}`);
  });

  // Scenario 3 (anchor) ------------------------------------------------------------------------
  test("same calendar slot in A and B both succeed independently", async ({ request }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    // One run-unique slot, booked in BOTH tenants — the "same wall-clock slot" under test.
    // (Brief writes `calendarVisibleWeekSlotIso(14, 0)`; swapped for a run-unique instant so the
    // reused mt backend doesn't 409 this on a second local run — the cross-tenant point is
    // unchanged: identical `startAt` string handed to A and to B.)
    const slot = uniqueApiSlotIso(0);

    const a = await createAppointmentApi(request, tokenA, {
      clientId: world.tenantA.clientIds[0],
      professionalId: world.tenantA.professionalIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      startAt: slot,
    });
    // No cross-tenant SLOT_TAKEN/409: `createAppointmentApi` throws on any non-2xx, so a 409 here
    // fails the test outright rather than being silently swallowed.
    const b = await createAppointmentApi(request, tokenB, {
      clientId: world.tenantB.clientIds[0],
      professionalId: world.tenantB.professionalIds[0],
      serviceId: world.tenantB.catalog.serviceIds[0],
      startAt: slot,
    });

    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe("PENDING");
    expect(b.status).toBe("PENDING");

    // And each tenant only lists its own side of that shared slot.
    await expectScopedList(request, tokenA, allAppointmentsPath, {
      includesIds: [a.id],
      excludesIds: [b.id],
    });
    await expectScopedList(request, tokenB, allAppointmentsPath, {
      includesIds: [b.id],
      excludesIds: [a.id],
    });
  });

  // Scenario 4 -----------------------------------------------------------------------------------
  test("edit/cancel in A leaves a before/after snapshot of B byte-identical", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);

    // Isolation proof: fingerprint B, mutate A hard, re-fingerprint B, assert nothing moved.
    const before = await snapshotTenant(request, tokenB);

    const aClientId = world.tenantA.clientIds[0];
    const aProfId = world.tenantA.professionalIds[0];
    const aServiceId = world.tenantA.catalog.serviceIds[0];

    const toReschedule = await createAppointmentApi(request, tokenA, {
      clientId: aClientId,
      professionalId: aProfId,
      serviceId: aServiceId,
      startAt: uniqueApiSlotIso(4),
    });
    const toCancel = await createAppointmentApi(request, tokenA, {
      clientId: aClientId,
      professionalId: aProfId,
      serviceId: aServiceId,
      startAt: uniqueApiSlotIso(6),
    });

    // Reschedule the first — PUT /api/appointments/{id}, body shape = AppointmentUpdateRequest
    // (clientId, professionalId, serviceId, startAt), same fields as create (see
    // AppointmentController.update / hu-09).
    await apiPutJson(request, tokenA, `/api/appointments/${toReschedule.id}`, {
      clientId: aClientId,
      professionalId: aProfId,
      serviceId: aServiceId,
      startAt: uniqueApiSlotIso(8),
    });

    // Cancel the second — PATCH /api/appointments/{id}/status, body = AppointmentStatusUpdateRequest
    // { status, cancelReason? }; status value "CANCELLED" (same as the hu-08 UI #status-select).
    const cancelRes = await request.patch(
      `${API_BASE}/api/appointments/${toCancel.id}/status`,
      { headers: authHeaders(tokenA), data: { status: "CANCELLED" } },
    );
    expect(cancelRes.ok(), await cancelRes.text()).toBeTruthy();

    const after = await snapshotTenant(request, tokenB);
    expectUnchanged(before, after);
  });
});
