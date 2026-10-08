import { expect, test } from "@playwright/test";

import { loginAs, loginAsPlatformAdmin } from "../../fixtures/auth";
import {
  createProduct,
  outbox,
  pelu,
  peluLogin,
  peluOk,
  platformToken,
  proxyMode,
  stockItemByName,
  stockSession,
  waitForOutboxDrained,
} from "../../fixtures/stock/api";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-67 · Panel de integración (Cambio 10).

test.describe.configure({ mode: "serial" });

test.describe("HU-67 · Panel de integración con Stock", () => {
  test.afterEach(async () => {
    await proxyMode("up");
  });

  test("un envío fallido se ve con salón, tipo, intentos y error; Reintentar lo entrega", async ({ page }) => {
    const world = getStockWorld();
    const platform = await platformToken();
    const admin = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    await waitForOutboxDrained(platform, world.s2.id);
    const name = `Secador reintento ${Date.now()}`;
    // A non-retryable answer (400) makes the event FAILED right away.
    await proxyMode("fail400", 1);
    await createProduct(admin, world.s2.categoryId, name);
    await expect.poll(async () => (await outbox(platform, world.s2.id, "FAILED")).length, { timeout: 30_000 }).toBe(1);
    const failed = (await outbox(platform, world.s2.id, "FAILED"))[0];

    // Dashboard counter.
    await loginAsPlatformAdmin(page);
    await expect(page.getByTestId("platform-dashboard-stock-failed")).toContainText("Failed deliveries to Stock: 1");

    await page.goto("/platform/stock");
    const row = page.getByTestId(`stock-outbox-row-${failed.id}`);
    await expect(row).toContainText(world.s2.name);
    await expect(row).toContainText("Product");
    await expect(row).toContainText("Failed");
    await expect(row).toContainText("HTTP_400");

    // The panel says exactly what happened to the delivery, in plain words.
    await expect(page.getByTestId(`stock-outbox-latest-${failed.id}`)).toContainText(
      "Stock rejected the data that was sent",
    );
    await page.getByTestId(`stock-outbox-details-${failed.id}`).click();
    const history = page.getByTestId(`stock-outbox-history-${failed.id}`);
    await expect(history.getByText("Queued to be sent to Stock.")).toBeVisible();
    await expect(history.getByText(/Attempt 1 failed: Stock rejected the data that was sent/)).toBeVisible();
    await expect(history.getByText(/holds back this salon's later deliveries/)).toBeVisible();
    await expect(history.getByText(/Technical detail: HTTP_400/)).toBeVisible();

    await page.getByTestId(`stock-outbox-retry-${failed.id}`).click();

    await waitForOutboxDrained(platform, world.s2.id);
    const stockToken = await stockSession(world.s2.id);
    expect(await stockItemByName(stockToken, name)).toBeDefined();

    // Retried and delivered: the stored history keeps every step, in order.
    const delivered = (await outbox(platform, world.s2.id, "DONE")).find((e) => e.id === failed.id);
    expect(delivered?.messages.map((m) => m.code)).toEqual([
      "ENQUEUED",
      "ATTEMPT_STARTED",
      "ATTEMPT_FAILED_NOT_RETRYABLE",
      "RETRY_REQUESTED_AFTER_FAILURE",
      "ATTEMPT_STARTED",
      "DELIVERED",
    ]);
  });

  test("un envío que espera detrás de otro dice cuál es; y los reintentos automáticos quedan en su historial", async ({
    page,
  }) => {
    const world = getStockWorld();
    const platform = await platformToken();
    const admin = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    await waitForOutboxDrained(platform, world.s2.id);
    const stamp = Date.now();
    await proxyMode("fail400", 1);
    await createProduct(admin, world.s2.categoryId, `Cabeza ${stamp}`);
    await expect.poll(async () => (await outbox(platform, world.s2.id, "FAILED")).length, { timeout: 30_000 }).toBe(1);
    const head = (await outbox(platform, world.s2.id, "FAILED"))[0];
    await createProduct(admin, world.s2.categoryId, `Cola ${stamp}`);
    await expect
      .poll(async () => (await outbox(platform, world.s2.id, "PENDING")).length, { timeout: 15_000 })
      .toBe(1);
    const behind = (await outbox(platform, world.s2.id, "PENDING"))[0];
    expect(behind.blockedByEventId).toBe(head.id);
    expect(behind.attemptCount).toBe(0);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/stock");
    await expect(page.getByTestId(`stock-outbox-blocked-${behind.id}`)).toContainText(
      `Waiting for delivery #${head.id}`,
    );
    // A delivery that was never attempted has nothing to retry or discard.
    await expect(page.getByTestId(`stock-outbox-retry-${behind.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`stock-outbox-discard-${behind.id}`)).toHaveCount(0);

    // Free the queue; the waiting delivery is then sent and says so.
    await page.getByTestId(`stock-outbox-retry-${head.id}`).click();
    await waitForOutboxDrained(platform, world.s2.id);
    const done = (await outbox(platform, world.s2.id, "DONE")).find((e) => e.id === behind.id);
    expect(done?.messages.map((m) => m.code)).toEqual(["ENQUEUED", "ATTEMPT_STARTED", "DELIVERED"]);
  });

  test("con Stock caído cada intento fallido queda explicado y, al volver, el envío se entrega solo", async ({ page }) => {
    const world = getStockWorld();
    const platform = await platformToken();
    const admin = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    await waitForOutboxDrained(platform, world.s2.id);
    await proxyMode("down");
    await createProduct(admin, world.s2.categoryId, `Reintento solo ${Date.now()}`);
    await expect
      .poll(
        async () =>
          (await outbox(platform, world.s2.id)).some((e) =>
            e.messages.some((m) => m.code === "ATTEMPT_FAILED_RETRY_SCHEDULED"),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const waiting = (await outbox(platform, world.s2.id)).find((e) =>
      e.messages.some((m) => m.code === "ATTEMPT_FAILED_RETRY_SCHEDULED"),
    )!;
    const retryMsg = waiting.messages.find((m) => m.code === "ATTEMPT_FAILED_RETRY_SCHEDULED")!;
    expect(retryMsg.level).toBe("WARN");
    expect(retryMsg.params).toMatchObject({ attempt: 1, reason: "SERVER_ERROR" });
    expect(typeof retryMsg.params.nextAttemptAt).toBe("string");

    // Stock is back before the automatic retries run out (they would end in FAILED).
    await proxyMode("up");
    await waitForOutboxDrained(platform, world.s2.id, 60_000);
    const delivered = (await outbox(platform, world.s2.id, "DONE")).find((e) => e.id === waiting.id)!;
    expect(delivered.messages.at(-1)?.code).toBe("DELIVERED");
    expect(delivered.messages.filter((m) => m.code === "ATTEMPT_STARTED").length).toBeGreaterThanOrEqual(2);

    // The history in the panel keeps the failed attempt and the final delivery.
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/stock");
    await page.locator("#stock-outbox-status").selectOption("DONE");
    await page.getByTestId(`stock-outbox-details-${waiting.id}`).click();
    const history = page.getByTestId(`stock-outbox-history-${waiting.id}`);
    await expect(
      history.getByText(/Attempt 1 of \d+ failed: Stock had an internal error\. Femme will try again on /),
    ).toBeVisible();
    await expect(history.getByText(/Delivered to Stock on attempt \d+\./)).toBeVisible();
  });

  test("una sincronización de catálogo completo nueva reemplaza a la anterior que seguía esperando", async () => {
    const world = getStockWorld();
    const platform = await platformToken();
    await waitForOutboxDrained(platform, world.s2.id);
    await proxyMode("down");
    await peluOk(`/api/platform/tenants/${world.s2.id}/stock/catalog-sync`, { method: "POST", token: platform });
    await expect
      .poll(async () => (await outbox(platform, world.s2.id)).some((e) => e.attemptCount > 0), { timeout: 30_000 })
      .toBe(true);
    const older = (await outbox(platform, world.s2.id)).find((e) => e.eventType === "CATALOG_FULL_SYNC")!;
    await peluOk(`/api/platform/tenants/${world.s2.id}/stock/catalog-sync`, { method: "POST", token: platform });
    await proxyMode("up");
    await waitForOutboxDrained(platform, world.s2.id, 60_000);

    const discarded = (await outbox(platform, world.s2.id, "DISCARDED")).find((e) => e.id === older.id)!;
    const last = discarded.messages.at(-1)!;
    expect(last.code).toBe("SUPERSEDED");
    const newer = (await outbox(platform, world.s2.id, "DONE")).find(
      (e) => e.eventType === "CATALOG_FULL_SYNC" && e.id > older.id,
    )!;
    expect(last.params.byEventId).toBe(newer.id);
    expect(newer.messages.at(-1)?.code).toBe("DELIVERED");
  });

  test("Descartar un fallido destraba la cola del salón", async ({ page }) => {
    const world = getStockWorld();
    const platform = await platformToken();
    const admin = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    await waitForOutboxDrained(platform, world.s2.id);
    const stamp = Date.now();
    await proxyMode("fail400", 1);
    await createProduct(admin, world.s2.categoryId, `Descartado ${stamp}`);
    await expect.poll(async () => (await outbox(platform, world.s2.id, "FAILED")).length, { timeout: 30_000 }).toBe(1);
    // While FAILED, later events of the salon wait behind it.
    await createProduct(admin, world.s2.categoryId, `Detrás ${stamp}`);
    await new Promise((r) => setTimeout(r, 4000));
    const stockToken = await stockSession(world.s2.id);
    expect(await stockItemByName(stockToken, `Detrás ${stamp}`)).toBeUndefined();

    const failed = (await outbox(platform, world.s2.id, "FAILED"))[0];
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/stock");
    await page.getByTestId(`stock-outbox-discard-${failed.id}`).click();
    await waitForOutboxDrained(platform, world.s2.id);
    await expect.poll(async () => !!(await stockItemByName(stockToken, `Detrás ${stamp}`)), { timeout: 30_000 }).toBe(true);
    expect(await stockItemByName(stockToken, `Descartado ${stamp}`)).toBeUndefined();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("stock-outbox-empty")).toBeVisible({ timeout: 15_000 });
  });

  test("solo el administrador de plataforma accede al panel", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    expect((await pelu("/api/platform/stock/outbox", { token: admin })).status).toBe(403);
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    await page.goto("/platform/stock");
    await expect(page.getByTestId("stock-outbox-table")).toHaveCount(0);
  });
});
